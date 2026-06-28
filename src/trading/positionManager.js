// src/trading/positionManager.js

const config = require('../config/config');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.resolve(__dirname, '../../data/position_state.json');

class PositionManager {
  constructor() {
    this.riskPercent = config.demo.riskPercent;
    this.maxPositions = config.demo.maxPositions;
    this.numberOfPositions = config.numberOfPositions || 10;
    this.positions = new Map();
    this.tradeHistory = [];
    this.initialBalance = config.demo.balance;

    const restored = this._loadState();
    if (restored) {
      console.log('Состояние восстановлено: баланс=' + this.balance.toFixed(2) + ', сделок в истории=' + this.tradeHistory.length);
    } else {
      this.balance = config.demo.balance;
      console.log('Новое состояние: начальный баланс=' + this.balance.toFixed(2));
    }
  }

  // ========== СОХРАНЕНИЕ / ЗАГРУЗКА СОСТОЯНИЯ ==========
  _statePath() {
    return STATE_FILE;
  }

  _saveState() {
    try {
      const dir = path.dirname(this._statePath());
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify({
        balance: this.balance,
        tradeHistory: this.tradeHistory,
        initialBalance: this.initialBalance,
        savedAt: Date.now()
      }, null, 2);
      fs.writeFileSync(this._statePath(), data, 'utf8');
    } catch (error) {
      console.error('Ошибка сохранения состояния:', error.message);
    }
  }

  _loadState() {
    try {
      const filePath = this._statePath();
      if (!fs.existsSync(filePath)) return false;
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return false;
      this.balance = typeof data.balance === 'number' ? data.balance : config.demo.balance;
      this.tradeHistory = Array.isArray(data.tradeHistory) ? data.tradeHistory : [];
      this.initialBalance = typeof data.initialBalance === 'number' ? data.initialBalance : config.demo.balance;
      return true;
    } catch (error) {
      console.warn('Не удалось загрузить состояние:', error.message);
      return false;
    }
  }

  // ========== НОВЫЙ МЕТОД: добавление позиции после реального ордера ==========
  addPosition(positionData) {
    // positionData: { symbol, side, entryPrice, size, orderId, timestamp }
    // Проверяем лимит
    if (this.positions.size >= this.maxPositions) {
      console.error(`❌ Невозможно добавить позицию: достигнут лимит (${this.maxPositions})`);
      return { success: false, error: 'Достигнут лимит позиций' };
    }
    if (this.positions.has(positionData.symbol)) {
      console.error(`❌ Позиция по ${positionData.symbol} уже существует`);
      return { success: false, error: 'Позиция по данному символу уже существует' };
    }

    const position = {
      id: this.generatePositionId(),
      symbol: positionData.symbol,
      type: positionData.side === 'BUY' ? 'LONG' : 'SHORT',
      entryPrice: positionData.entryPrice,
      currentPrice: positionData.entryPrice,

      size: positionData.size,          // размер в USDT (как доля от баланса)
      orderId: positionData.orderId || null,
      entryTime: positionData.timestamp || Date.now(),
      status: 'OPEN',
      pnl: 0,
      pnlPercent: 0,
      // Для реальных ордеров стоп-лосс и тейк-профит можно не задавать, но можно добавить позже
      stopLoss: null,
      takeProfit: null,
      closeReason: null,
      exitPrice: null,
      exitTime: null
    };

    this.positions.set(positionData.symbol, position);
    // В демо-режиме при реальных ордерах мы не изменяем баланс (он виртуальный на бирже),
    // но для симуляции статистики можно уменьшить локальный баланс
    // Чтобы не путать, оставим баланс без изменений, потому что он используется только для симуляции.
    // Но для согласованности в симуляции мы будем использовать отдельную логику.
    // Для реальных ордеров мы не трогаем balance, т.к. он виртуальный на бирже.

    this.tradeHistory.push({
      action: 'OPEN',
      position: { ...position },
      timestamp: Date.now()
    });
      this._saveState();

    console.log(`✅ Позиция добавлена в менеджер: ${position.type} ${position.symbol}`);
    return { success: true, position, message: `Позиция добавлена` };
  }

  // ========== СИМУЛЯЦИОННОЕ ОТКРЫТИЕ (используется когда sendOrdersInDemo=false) ==========
  openPosition(symbol, signal, currentPrice) {
    // Проверка лимита
    if (this.positions.size >= this.maxPositions) {
      return { success: false, error: 'Достигнут лимит максимального количества позиций' };
    }
    if (this.positions.has(symbol)) {
      return { success: false, error: 'Позиция по данному символу уже существует' };
    }

    try {
      const positionType = signal.type === 'BUY' ? 'LONG' : 'SHORT';
      const entryPrice = currentPrice;

      // ---- НОВЫЙ РАСЧЁТ РАЗМЕРА: делим баланс на numberOfPositions ----
      const availableBalance = this.getAvailableBalance();
      // Если в сигнале передан size, используем его (для ручного ввода), иначе вычисляем
      // Фиксированный размер: начальный баланс / количество позиций
      const fixedSize = config.demo.balance / this.numberOfPositions;
      let positionSize = Math.min(fixedSize, availableBalance);
      // Ограничиваем доступным балансом
      

      if (positionSize <= 0) {
        return { success: false, error: 'Недостаточно средств для открытия позиции' };
      }

      // Стоп-лосс и тейк-профит (можно оставить как есть или переделать)
      const stopLossPercent = 0.02;
      const stopLoss = positionType === 'LONG'
        ? entryPrice * (1 - stopLossPercent)
        : entryPrice * (1 + stopLossPercent);

      const takeProfitPercent = 0.04;
      const takeProfit = positionType === 'LONG'
        ? entryPrice * (1 + takeProfitPercent)
        : entryPrice * (1 - takeProfitPercent);

      const position = {
        id: this.generatePositionId(),
        symbol: symbol,
        type: positionType,
        entryPrice: entryPrice,
        currentPrice: entryPrice,

        stopLoss: stopLoss,
        takeProfit: takeProfit,
        size: positionSize,
        entryTime: Date.now(),
        status: 'OPEN',
        signal: signal,
        pnl: 0,
        pnlPercent: 0,
        orderId: null,
        exitPrice: null,
        exitTime: null,
        closeReason: null
      };

      this.positions.set(symbol, position);
      // Обновляем баланс (только для симуляции)
      // УДАЛЕНО: this.balance -= positionSize; — двойной учёт средств

      this.tradeHistory.push({
        action: 'OPEN',
        position: { ...position },
        timestamp: Date.now()
      });
      this._saveState();

      return {
        success: true,
        position: position,
        message: `Позиция ${positionType} открыта по ${symbol} (симуляция)`
      };

    } catch (error) {
      console.error('Ошибка открытия позиции:', error);
      return { success: false, error: error.message };
    }
  }

  // ========== ЗАКРЫТИЕ ПОЗИЦИИ ==========
  closePosition(symbol, reason = 'MANUAL', currentPrice = null) {
    const position = this.positions.get(symbol);
    if (!position) {
      return { success: false, error: 'Позиция не найдена' };
    }
    if (position.status === 'CLOSED') {
      return { success: false, error: 'Позиция уже закрыта' };
    }

    try {
      // Для реальных ордеров мы не знаем точную цену закрытия, поэтому используем последнюю известную цену из маркет-данных
      // Но в этом методе мы не получаем текущую цену, поэтому для демо-симуляции используем getCurrentPrice
      const price = currentPrice || this.getCurrentPrice(symbol);
      const pnl = this.calculatePnL(position, price);

      // Обновляем баланс (только для симуляции)
      this.balance += pnl;

      position.status = 'CLOSED';
      position.exitPrice = price;
      position.exitTime = Date.now();
      position.pnl = pnl;
      position.pnlPercent = (pnl / position.size) * 100;
      position.closeReason = reason;

      this.tradeHistory.push({
        action: 'CLOSE',
        position: { ...position },
        timestamp: Date.now()
      });

      this.positions.delete(symbol);
      this._saveState();

      return {
        success: true,
        position: position,
        message: `Позиция по ${symbol} закрыта. PnL: ${pnl.toFixed(2)}`
      };

    } catch (error) {
      console.error('Ошибка закрытия позиции:', error);
      return { success: false, error: error.message };
    }
  }

  // ========== ОБНОВЛЕНИЕ ПОЗИЦИЙ (проверка стоп-лоссов и тейк-профитов) ==========
  updatePositions(marketData) {
    const closedPositions = [];

    for (const [symbol, position] of this.positions) {
      if (position.status !== 'OPEN') continue;

      const ticker = marketData[symbol];
      if (!ticker) continue;

      const currentPrice = ticker.price;

      // Обновляем PnL
      position.pnl = this.calculatePnL(position, currentPrice);
      position.pnlPercent = (position.pnl / position.size) * 100;
      position.currentPrice = currentPrice;


      // Проверка стоп-лосса
      if (position.stopLoss && this.checkStopLoss(position, currentPrice)) {
        const result = this.closePosition(symbol, 'STOP_LOSS', currentPrice);
        if (result.success) {
          closedPositions.push(result.position);
        }
        continue;
      }

      // Проверка тейк-профита
      if (position.takeProfit && this.checkTakeProfit(position, currentPrice)) {
        const result = this.closePosition(symbol, 'TAKE_PROFIT', currentPrice);
        if (result.success) {
          closedPositions.push(result.position);
        }
        continue;
      }
    }

    return closedPositions;
  }

  // ========== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ==========
  checkStopLoss(position, currentPrice) {
    if (position.type === 'LONG') {
      return currentPrice <= position.stopLoss;
    } else {
      return currentPrice >= position.stopLoss;
    }
  }

  checkTakeProfit(position, currentPrice) {
    if (position.type === 'LONG') {
      return currentPrice >= position.takeProfit;
    } else {
      return currentPrice <= position.takeProfit;
    }
  }

  calculatePnL(position, currentPrice) {
    // Количество монет = размер позиции в USDT / цена входа
    const quantity = position.size / position.entryPrice;
    if (position.type === 'LONG') {
      return (currentPrice - position.entryPrice) * quantity;
    } else {
      return (position.entryPrice - currentPrice) * quantity;
    }
  }

  getAvailableBalance() {
    // Суммируем размер всех открытых позиций
    const usedBalance = Array.from(this.positions.values())
      .filter(p => p.status === 'OPEN')
      .reduce((sum, p) => sum + p.size, 0);
    return this.balance - usedBalance;
  }

  // Для демо-симуляции получения цены (используется только при закрытии без реальных данных)
  getCurrentPrice(symbol) {
    // В реальной реализации здесь должен быть запрос к API или получение из marketData
    // Для демо оставляем как есть
    const basePrice = 100;
    const variation = (Math.random() - 0.5) * 0.1;
    return basePrice * (1 + variation);
  }

  generatePositionId() {
    return `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ========== ПОЛУЧЕНИЕ СТАТИСТИКИ ==========
  getStatistics() {
    const totalTrades = this.tradeHistory.filter(t => t.action === 'CLOSE').length;
    const winningTrades = this.tradeHistory.filter(t =>
      t.action === 'CLOSE' && t.position.pnl > 0
    ).length;

    const totalPnL = this.tradeHistory
      .filter(t => t.action === 'CLOSE')
      .reduce((sum, t) => sum + t.position.pnl, 0);

    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    return {
      totalBalance: this.balance,
      availableBalance: this.getAvailableBalance(),
      activePositions: this.positions.size,
      maxPositions: this.maxPositions,
      totalTrades: totalTrades,
      winningTrades: winningTrades,
      winRate: winRate,
      totalPnL: totalPnL,
      totalPnLPercent: this.initialBalance > 0 ? ((this.balance - this.initialBalance) / this.initialBalance) * 100 : 0
    };
  }

  getActivePositions() {
    return Array.from(this.positions.values()).filter(p => p.status === 'OPEN');
  }

  getTradeHistory(limit = 50) {
    return this.tradeHistory
      .filter(t => t.action === 'CLOSE')
      .slice(-limit)
      .reverse()
      .map(t => ({
        symbol: t.position.symbol,
        type: t.position.type,
        entryPrice: t.position.entryPrice,
        exitPrice: t.position.exitPrice,
        entryTime: t.position.entryTime,
        exitTime: t.position.exitTime,
        size: t.position.size,
        pnl: t.position.pnl,
        pnlPercent: t.position.pnlPercent,
        closeReason: t.position.closeReason
      }));
  }

  resetDemoBalance() {
    this.balance = config.demo.balance;
    this.initialBalance = config.demo.balance;
    this.positions.clear();
    this.tradeHistory = [];
  this._saveState();
    return { success: true, message: 'Демо-баланс сброшен' };
  }
}

module.exports = PositionManager;