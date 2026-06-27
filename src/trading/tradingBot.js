const BybitAPI = require('../services/bybitApi');
const BreakoutStrategy = require('../strategies/breakoutStrategy');
const PositionManager = require('./positionManager');
const config = require('../config/config');

class TradingBot {
  constructor() {
    this.api = new BybitAPI();
    this.strategy = new BreakoutStrategy();
    this.positionManager = new PositionManager();
    this.isRunning = false;
    this.analysisInterval = null;
    this.loadingStatus = '';
    this.loadingProgress = null;
    this.lastSignals = [];
    this.positionsUpdateInterval = null;

    this.marketData = new Map();
    this.lastAnalysis = new Map();
    this.lastSignals = [];
    this.positionsUpdateInterval = null;

    this.activeSymbols = [];
    this.symbolsUpdateInterval = null;

    this.numberOfPositions = config.numberOfPositions;
    this.minVolume = config.minVolume;
    this.topSymbolsCount = config.topSymbolsCount;
    this.useDynamicSymbols = config.useDynamicSymbols;
  }

  async start() {
    if (this.isRunning) {
      return { success: false, error: 'Бот уже запущен' };
    }
    try {
      console.log('🚀 Запуск торгового бота...');
      this.loadingStatus = 'Загрузка списка символов...';

      this.loadingStatus = 'Загрузка рыночных данных...';

      await this.initializeSymbols();
      await this.initializeMarketData();
      this.loadingStatus = '';
      this.loadingProgress = null;

      this.isRunning = true;
      this.startAnalysis();
      this.startPositionsUpdate();

      if (this.useDynamicSymbols) {
        this.symbolsUpdateInterval = setInterval(async () => {
          await this.updateSymbols();
        }, 60 * 60 * 1000);
      }

      console.log('✅ Торговый бот запущен успешно');
      return { success: true, message: 'Бот запущен' };
    } catch (error) {
      console.error('❌ Ошибка запуска бота:', error);
      return { success: false, error: error.message };
    }
  }

  stop() {
    if (!this.isRunning) {
      return { success: false, error: 'Бот не запущен' };
    }
    try {
      console.log('🛑 Остановка торгового бота...');
      this.isRunning = false;
      if (this.analysisInterval) {
        clearInterval(this.analysisInterval);
        this.analysisInterval = null;
      }
      if (this.symbolsUpdateInterval) {
        clearInterval(this.symbolsUpdateInterval);
        this.symbolsUpdateInterval = null;
      }
      console.log('✅ Торговый бот остановлен');
      return { success: true, message: 'Бот остановлен' };
    } catch (error) {
      console.error('❌ Ошибка остановки бота:', error);
      return { success: false, error: error.message };
    }
  }

  async initializeSymbols() {
    if (this.useDynamicSymbols) {
      console.log('🔄 Загрузка динамического списка символов с Bybit...');
      await this.updateSymbols();
    } else {
      console.log('📋 Используется статический список символов из конфига');
      this.activeSymbols = config.symbols;
    }
    console.log(`📊 Торговых символов: ${this.activeSymbols.length}`);
    if (this.activeSymbols.length > 0) {
      console.log('📈 Первые 10:', this.activeSymbols.slice(0, 10).join(', '));
    }
  }

  async updateSymbols() {
    console.log('🔄 Обновление списка символов...');
    try {
      const allSymbols = await this.api.getActiveLinearSymbols();
      if (!allSymbols || allSymbols.length === 0) {
        console.warn('⚠️ Не удалось получить список символов, оставляем старый');
        return;
      }
      const volumes = await this.api.getTickersVolume(allSymbols);
      if (!volumes) {
        console.warn('⚠️ Не удалось получить объёмы, оставляем старый');
        return;
      }
      const filtered = allSymbols
        .filter(sym => (volumes[sym] || 0) >= this.minVolume)
        .sort((a, b) => (volumes[b] || 0) - (volumes[a] || 0))
;

      if (filtered.length === 0) {
        console.warn('⚠️ Нет символов, удовлетворяющих условиям, оставляем старый');
        return;
      }
      this.activeSymbols = filtered;
      console.log(`✅ Список символов обновлён: ${this.activeSymbols.length} символов`);
      console.log('📊 Топ-10 по объёму:', this.activeSymbols.slice(0, 10).join(', '));
    } catch (error) {
      console.error('❌ Ошибка обновления символов:', error);
    }
  }

  async initializeMarketData() {
    console.log('📊 Инициализация рыночных данных...');
    const symbols = this.activeSymbols;
    if (!symbols || symbols.length === 0) {
      console.warn('⚠️ Нет символов для загрузки данных');
      return;
    }
    let loadedCount = 0;
    const totalToLoad = symbols.length;

    for (const symbol of symbols) {
        loadedCount++;
        this.loadingProgress = { current: loadedCount, total: totalToLoad, symbol };
      try {
        const candles = await this.api.getKlineData(symbol, '15', 200);
        this.marketData.set(symbol, {
          candles: candles,
          lastUpdate: Date.now()
        });
        console.log(`✅ Данные загружены для ${symbol}`);
      } catch (error) {
        console.error(`❌ Ошибка загрузки данных для ${symbol}:`, error.message);
      }
    }
  }

  startAnalysis() {
    this.analysisInterval = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        await this.performAnalysis(true);
      } catch (error) {
        console.error('❌ Ошибка анализа:', error);
      }
    }, 5 * 60 * 1000);
    this.performAnalysis(true);
  }

  async forcePerformAnalysis() {
    return this.performAnalysis(true);
  }

  async performAnalysis(force = false) {
    if (!force) {
      const availableBalance = this.positionManager.getAvailableBalance();
      if (availableBalance <= 0) {
        console.log('[Пропуск] Нет свободных средств');
        await this.updatePositions();
        return;
      }
    }
    console.log('🔍 Выполнение анализа рынка...');
    const symbols = this.activeSymbols;
    if (!symbols || symbols.length === 0) {
      console.log('⏳ Нет активных символов, ждём...');
      return;
    }
    const analysisResults = [];
    for (const symbol of symbols) {
      try {
        await this.updateMarketData(symbol);
        const marketData = this.marketData.get(symbol);
        if (!marketData || marketData.candles.length < 100) continue;
        const analysis = this.strategy.analyze(marketData.candles);
        if (analysis.error) {
          console.error(`❌ Ошибка анализа ${symbol}:`, analysis.error);
          continue;
        }
        this.lastAnalysis.set(symbol, analysis);
        analysisResults.push({ symbol, analysis });
        if (analysis.signal) {
          // Получаем актуальную цену с биржи вместо цены закрытия свечи
          let livePrice = analysis.currentPrice;
          try {
            const ticker = await this.api.getTickerPrice(symbol);
            if (ticker && ticker.price) {
              livePrice = ticker.price;
            }
          } catch (e) {
            console.warn(`⚠️ Не удалось получить live-цену для ${symbol}, используем цену свечи`);
          }
          await this.processSignal(symbol, analysis.signal, livePrice);
        }
      } catch (error) {
        console.error(`❌ Ошибка анализа ${symbol}:`, error);
      }
    }
    await this.updatePositions();
    console.log(`✅ Анализ завершен. Обработано символов: ${analysisResults.length}`);
    return analysisResults;
  }

  async updateMarketData(symbol) {
    try {
      const newCandles = await this.api.getKlineData(symbol, '15', 50);
      const currentData = this.marketData.get(symbol);
      if (currentData) {
        const allCandles = [...currentData.candles, ...newCandles];
        const uniqueCandles = this.removeDuplicateCandles(allCandles);
        const limitedCandles = uniqueCandles.slice(-200);
        this.marketData.set(symbol, {
          candles: limitedCandles,
          lastUpdate: Date.now()
        });
      }
    } catch (error) {
      console.error(`❌ Ошибка обновления данных ${symbol}:`, error);
    }
  }

  removeDuplicateCandles(candles) {
    const seen = new Set();
    return candles.filter(candle => {
      const key = candle.timestamp;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ===================== ИЗМЕНЁННЫЙ МЕТОД processSignal =====================
  async processSignal(symbol, signal, currentPrice) {
    console.log(`📈 Сигнал ${signal.type} для ${symbol} по цене ${currentPrice}`);
    // Сохраняем сигнал
    this.lastSignals.push({ ...signal, symbol, currentPrice });

    // Проверяем лимит позиций
    const activePositions = this.positionManager.getActivePositions();
    if (activePositions.length >= this.numberOfPositions) {
      console.log(`⛔ Достигнут лимит позиций (${this.numberOfPositions}), пропускаем ${symbol}`);
      return;
    }

    // Проверяем, есть ли уже позиция по этому символу
    const existing = this.positionManager.positions.get(symbol);
    if (existing) {
      console.log(`⚠️ Позиция по ${symbol} уже существует`);
      return;
    }

    try {
      // Определяем баланс
      const availableBal = this.positionManager.getAvailableBalance();
      let balance;
      if (config.botMode === 'demo') {
        balance = availableBal;
        console.log(`💵 Доступно: ${balance} USDT`);
      } else {
        const balanceData = await this.api.getBalance();
        balance = balanceData.totalEquity || 0;
        console.log(`💵 Реальный баланс: ${balance} USDT`);
      }

      const positionSizeUSDT = balance / this.numberOfPositions;
      const qty = positionSizeUSDT / currentPrice; // количество контрактов для рыночного ордера

      // Определяем, нужно ли отправлять реальный ордер
      const shouldSendRealOrder = (config.botMode === 'live') ||
        (config.botMode === 'demo' && config.sendOrdersInDemo);

      if (shouldSendRealOrder) {
        // Отправляем реальный ордер на Bybit (демо или реальный счёт)
        console.log(`📤 Отправка реального ордера на Bybit...`);
        const orderResult = await this.api.placeOrder({
          symbol: symbol,
          side: signal.type === 'BUY' ? 'Buy' : 'Sell',
          orderType: 'Market',
          qty: qty,
          positionIdx: 0
        });

        if (orderResult) {
          console.log(`✅ Ордер успешно размещён: ${signal.type} ${symbol} по рынку, qty=${qty.toFixed(4)}`);
          // Добавляем позицию в менеджер для отслеживания (чтобы бот знал о ней)
          this.positionManager.addPosition({
            symbol,
            side: signal.type,
            entryPrice: currentPrice,
            size: positionSizeUSDT,
            orderId: orderResult.orderId,
            timestamp: Date.now()
          });
        } else {
          console.log(`❌ Не удалось разместить ордер для ${symbol}`);
        }
      } else {
        // Симуляция (локальная)
        // азмер посчитает positionManager из доступного баланса
        const result = this.positionManager.openPosition(symbol, { ...signal, size: this.positionManager.balance / this.numberOfPositions }, currentPrice);
        if (result.success) {
          console.log(`✅ ${result.message}`);
          console.log(`💰 Размер позиции: ${result.position.size.toFixed(2)} (USDT)`);
          console.log(`🛑 Стоп-лосс: ${result.position.stopLoss?.toFixed(4) || 'не задан'}`);
          console.log(`🎯 Тейк-профит: ${result.position.takeProfit?.toFixed(4) || 'не задан'}`);
          if (this.telegram) this.telegram.notifyPositionOpened(result.position, signal);
        } else {
          console.log(`❌ Ошибка открытия позиции: ${result.error}`);
        }
      }
    } catch (error) {
      console.error(`❌ Ошибка обработки сигнала для ${symbol}:`, error);
    }
  }
  // ----- Запуск отдельного интервала обновления позиций (каждые 15 сек) -----
  startPositionsUpdate() {
    if (this.positionsUpdateInterval) {
      clearInterval(this.positionsUpdateInterval);
    }
    this.positionsUpdateInterval = setInterval(async () => {
      if (!this.isRunning) return;
      await this.updatePositions();
    }, 5 * 1000);
    console.log('⏱ Запущено обновление позиций каждые 15 секунд');
  }

  // ===================== КОНЕЦ ИЗМЕНЁННОГО МЕТОДА =====================

  async updatePositions() {
    try {
      // Получаем цены всех символов одним запросом
      const allPrices = await this.api.getAllTickerPrices(this.activeSymbols);
      // Check for null - if API returned null, use empty object
      if (allPrices === null) {
        console.warn('API getAllTickerPrices returned null, using empty marketData');
      }
      const marketData = allPrices || {};
      if (!allPrices) {
        for (const symbol of this.activeSymbols) {
          try {
            const ticker = await this.api.getTickerPrice(symbol);
            marketData[symbol] = ticker;
          } catch (error) {
            console.error(`❌ Ошибка получения цены ${symbol}:`, error);
          }
        }
      }      const closedPositions = this.positionManager.updatePositions(marketData);
      if (closedPositions.length > 0) {
        console.log(`🔒 Закрыто позиций: ${closedPositions.length}`);
        closedPositions.forEach(pos => {
          console.log(`📊 ${pos.symbol}: ${pos.closeReason}, PnL: ${pos.pnl.toFixed(2)}`);
          if (this.telegram) this.telegram.notifyPositionClosed(pos, pos.closeReason);
        });
      }
    } catch (error) {
      console.error('❌ Ошибка обновления позиций:', error);
    }
  }

  getStatus() {
    const statistics = this.positionManager.getStatistics();
    const activePositions = this.positionManager.getActivePositions();
    return {
      isRunning: this.isRunning,
      statistics: statistics,
      loadingStatus: this.loadingStatus || '',
      loadingProgress: this.loadingProgress || null,

      activePositions: activePositions,
      symbols: this.activeSymbols,
      lastAnalysis: Object.fromEntries(this.lastAnalysis),
      marketDataStatus: Array.from(this.marketData.entries()).map(([symbol, data]) => ({
        symbol,
        candlesCount: data.candles.length,
        lastUpdate: data.lastUpdate
      }))
    };
  }

  getSignals() {
    return this.lastSignals;
  }

  getAnalysis(symbol) {
    return this.lastAnalysis.get(symbol) || null;
  }

  async manualOpenPosition(symbol, type, size) {
    if (!this.isRunning) return { success: false, error: 'Бот не запущен' };
    try {
      const ticker = await this.api.getTickerPrice(symbol);
      const signal = {
        type: type === 'LONG' ? 'BUY' : 'SELL',
        level: ticker.price,
        currentPrice: ticker.price,
        strength: 1,
        volume: ticker.volume24h,
        timestamp: Date.now(),
        size: size || (config.demo.balance / this.numberOfPositions)
      };
      return this.positionManager.openPosition(symbol, signal, ticker.price);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async manualClosePosition(symbol) {
    try {
      const ticker = await this.api.getTickerPrice(symbol);
      const currentPrice = ticker ? ticker.price : null;
      return this.positionManager.closePosition(symbol, 'MANUAL', currentPrice);
    } catch (error) {
      console.error('Error getting price for ' + symbol + ':', error);
      return this.positionManager.closePosition(symbol, 'MANUAL');
    }
  }

  resetDemoBalance() {
    return this.positionManager.resetDemoBalance();
  }

  getTradeHistory(limit = 50) {
    return this.positionManager.getTradeHistory(limit);
  }
}

module.exports = TradingBot;