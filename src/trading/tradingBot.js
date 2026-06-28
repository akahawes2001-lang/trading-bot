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
    this.lastNoBalanceNotificationAt = 0;

    this.numberOfPositions = config.numberOfPositions;
    this.minVolume = config.minVolume;
    this.topSymbolsCount = config.topSymbolsCount;
    this.useDynamicSymbols = config.useDynamicSymbols;
    this.topPositiveCount = config.topPositiveCount;
    this.topNegativeCount = config.topNegativeCount;
    this.maxSymbolsTotal = config.maxSymbolsTotal;

    // Telegram-уведомления — устанавливается извне (index.js)
    this.telegram = null;
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
        console.log('🔄 Интервал анализа очищен');
      }
      if (this.symbolsUpdateInterval) {
        clearInterval(this.symbolsUpdateInterval);
        this.symbolsUpdateInterval = null;
      }
      if (this.positionsUpdateInterval) {
        clearInterval(this.positionsUpdateInterval);
        this.positionsUpdateInterval = null;
        console.log('🔄 Интервал обновления позиций очищен');
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

      const tickers = await this.api.getAllTickerPrices(allSymbols);
      if (!tickers) {
        console.warn('⚠️ Не удалось получить тикеры, оставляем старый');
        return;
      }

      const filtered = allSymbols.filter(sym => {
        const volume = tickers[sym]?.volume24h || 0;
        return volume >= this.minVolume;
      });

      if (filtered.length === 0) {
        console.warn('⚠️ Нет символов, удовлетворяющих объёму, оставляем старый');
        return;
      }

      const sortedByChange = filtered.sort((a, b) => {
        const changeA = tickers[a]?.change24h || 0;
        const changeB = tickers[b]?.change24h || 0;
        return changeB - changeA;
      });

      const topPositive = sortedByChange.slice(0, this.topPositiveCount);
      const topNegative = sortedByChange.slice(-this.topNegativeCount).reverse();

      // Объединяем, убираем дубликаты
      let selected = [...new Set([...topPositive, ...topNegative])];

      // Если объединённый список превышает лимит — обрезаем,
      // сохраняя самые волатильные (первые после сортировки по |change24h|)
      if (selected.length > this.maxSymbolsTotal) {
        // Сортируем выбранные по модулю изменения (волатильности)
        selected.sort((a, b) => {
          const absA = Math.abs(tickers[a]?.change24h || 0);
          const absB = Math.abs(tickers[b]?.change24h || 0);
          return absB - absA;
        });
        selected = selected.slice(0, this.maxSymbolsTotal);
        console.log(`⚠️ Лимит символов (${this.maxSymbolsTotal}), выбраны ${selected.length} самых волатильных`);
      }

      if (selected.length === 0) {
        console.warn('⚠️ Не удалось выбрать символы, оставляем старый');
        return;
      }

      this.activeSymbols = selected;
      console.log(`✅ Список символов обновлён: ${this.activeSymbols.length} символов (из них ${topPositive.length} выросших + ${topNegative.length} упавших, после слияния и дедупликации)`);
      console.log('📊 Всего отфильтровано по объёму:', filtered.length);
      console.log('📈 Топ выросших:', topPositive.join(', '));
      console.log('📉 Топ упавших:', topNegative.join(', '));
      if (this.activeSymbols.length > 10) {
        console.log('📋 Первые 10:', this.activeSymbols.slice(0, 10).join(', '));
      }
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
    console.log('⏱️ Запуск интервала анализа (каждые 5 минут)');
    console.log(`   isRunning=${this.isRunning}, analysisInterval=${this.analysisInterval}`);
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    this.analysisInterval = setInterval(async () => {
      console.log('⏰ Интервал анализа сработал! isRunning=' + this.isRunning);
      if (!this.isRunning) {
        console.log('⏸️ Интервал анализа пропущен: isRunning = false');
        return;
      }
      try {
        await this.performAnalysis(false);
      } catch (error) {
        console.error('❌ Ошибка в интервале анализа:', error);
      }
    }, 5 * 60 * 1000);
    console.log('✅ Интервал анализа установлен, id=' + (this.analysisInterval ? 'set' : 'null'));
    // Первый запуск сразу, но только при наличии свободного баланса
    console.log('🚀 Первый запуск performAnalysis()...');
    this.performAnalysis(false).catch(err => console.error('❌ Ошибка первого анализа:', err));
  }

  async forcePerformAnalysis() {
    return this.performAnalysis(true);
  }

  async performAnalysis(force = false) {
    console.log(`🔍 performAnalysis вызван, isRunning=${this.isRunning}`);
    const availableBalance = this.positionManager.getAvailableBalance();
    if (!force && availableBalance <= 0) {
      console.log('[Пропуск] Нет свободных средств');
      await this.notifyNoBalance();
      await this.updatePositions();
      return { skipped: true, reason: 'NO_BALANCE' };
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
      if (!newCandles || newCandles.length === 0) {
        console.warn(`⚠️ Нет новых свечей для ${symbol}`);
        return;
      }
      const currentData = this.marketData.get(symbol);
      if (currentData) {
        const allCandles = [...currentData.candles, ...newCandles];
        const uniqueCandles = this.removeDuplicateCandles(allCandles);
        const limitedCandles = uniqueCandles.slice(-200);
        this.marketData.set(symbol, {
          candles: limitedCandles,
          lastUpdate: Date.now()
        });
      } else {
        // Инициализация для нового символа
        this.marketData.set(symbol, {
          candles: newCandles,
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
          const addResult = this.positionManager.addPosition({
            symbol,
            side: signal.type,
            entryPrice: currentPrice,
            size: positionSizeUSDT,
            orderId: orderResult.orderId,
            timestamp: Date.now()
          });
          if (addResult.success) {
            console.log(`📤 Telegram: отправка уведомления об открытии позиции ${symbol}`);
            if (this.telegram) {
              try {
                await this.telegram.notifyPositionOpened(addResult.position, signal);
                console.log('✅ Уведомление об открытии отправлено');
              } catch (tgErr) {
                console.error('❌ Ошибка отправки уведомления об открытии:', tgErr.message);
              }
            } else {
              console.log('⚠️ Telegram не инициализирован, уведомление не отправлено');
            }
          }
        } else {
          console.log(`❌ Не удалось разместить ордер для ${symbol}`);
        }
      } else {
        // Симуляция (локальная)
        const availableForSize = this.positionManager.getAvailableBalance();
        console.log(`💵 Доступно для позиции: ${availableForSize.toFixed(2)} USDT, размер/позицию: ${(availableForSize / this.numberOfPositions).toFixed(2)} USDT`);
        const result = this.positionManager.openPosition(symbol, { ...signal, size: availableForSize / this.numberOfPositions }, currentPrice);
        if (result.success) {
          console.log(`✅ ${result.message}`);
          console.log(`💰 Размер позиции: ${result.position.size.toFixed(2)} (USDT)`);
          console.log(`🛑 Стоп-лосс: ${result.position.stopLoss?.toFixed(4) || 'не задан'}`);
          console.log(`🎯 Тейк-профит: ${result.position.takeProfit?.toFixed(4) || 'не задан'}`);
          console.log(`📤 Telegram: отправка уведомления об открытии позиции ${symbol} (симуляция)`);
          if (this.telegram) {
            try {
              await this.telegram.notifyPositionOpened(result.position, signal);
              console.log('✅ Уведомление об открытии отправлено');
            } catch (tgErr) {
              console.error('❌ Ошибка отправки уведомления об открытии:', tgErr.message);
            }
          } else {
            console.log('⚠️ Telegram не инициализирован, уведомление не отправлено');
          }
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
    console.log('⏱ Запущено обновление текущих цен открытых позиций каждые 5 секунд');
  }

  async notifyNoBalance() {
    const now = Date.now();
    if (now - this.lastNoBalanceNotificationAt < 5 * 60 * 1000) return;
    this.lastNoBalanceNotificationAt = now;
    if (this.telegram && this.telegram.notifyNoBalance) {
      await this.telegram.notifyNoBalance(this.positionManager.getStatistics());
    }
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
      }
      const closedPositions = this.positionManager.updatePositions(marketData);
      if (closedPositions.length > 0) {
        console.log(`🔒 Закрыто позиций: ${closedPositions.length}`);
        for (const pos of closedPositions) {
          console.log(`📊 ${pos.symbol}: ${pos.closeReason}, PnL: ${pos.pnl.toFixed(2)}`);
          if (this.telegram) {
            try {
              await this.telegram.notifyPositionClosed(pos, pos.closeReason);
              console.log(`✅ Уведомление о закрытии ${pos.symbol} отправлено`);
            } catch (tgErr) {
              console.error(`❌ Ошибка отправки уведомления о закрытии ${pos.symbol}:`, tgErr.message);
            }
          } else {
            console.log('⚠️ Telegram не инициализирован, уведомление о закрытии не отправлено');
          }
        }
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
    let result;
    try {
      const ticker = await this.api.getTickerPrice(symbol);
      const currentPrice = ticker ? ticker.price : null;
      result = this.positionManager.closePosition(symbol, 'MANUAL', currentPrice);
    } catch (error) {
      console.error('Error getting price for ' + symbol + ':', error);
      result = this.positionManager.closePosition(symbol, 'MANUAL');
    }
    if (result.success && this.telegram && this.telegram.notifyPositionClosed) {
      await this.telegram.notifyPositionClosed(result.position, result.position.closeReason || 'MANUAL');
    }
    return result;
  }

  resetDemoBalance() {
    return this.positionManager.resetDemoBalance();
  }

  getTradeHistory(limit = 50) {
    return this.positionManager.getTradeHistory(limit);
  }
}

module.exports = TradingBot;