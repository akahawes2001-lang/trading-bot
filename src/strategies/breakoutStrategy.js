const { SMA, RSI, MACD } = require('technicalindicators');
const config = require('../config/config');

class BreakoutStrategy {
  constructor() {
    this.confirmationCandles = config.strategy.breakoutConfirmationCandles;
    this.supportResistancePeriod = config.strategy.supportResistancePeriod;
    this.minVolumeThreshold = config.strategy.minVolumeThreshold;
  }

  // Поиск уровней поддержки и сопротивления
  findSupportResistanceLevels(candles, period = 20) {
    const levels = {
      support: [],
      resistance: []
    };

    for (let i = period; i < candles.length - period; i++) {
      const current = candles[i];
      const leftCandles = candles.slice(i - period, i);
      const rightCandles = candles.slice(i + 1, i + period + 1);

      // Проверка на уровень поддержки
      const isSupport = this.isSupportLevel(current, leftCandles, rightCandles);
      if (isSupport) {
        levels.support.push({
          price: current.low,
          timestamp: current.timestamp,
          strength: this.calculateLevelStrength(current, leftCandles, rightCandles, 'support')
        });
      }

      // Проверка на уровень сопротивления
      const isResistance = this.isResistanceLevel(current, leftCandles, rightCandles);
      if (isResistance) {
        levels.resistance.push({
          price: current.high,
          timestamp: current.timestamp,
          strength: this.calculateLevelStrength(current, leftCandles, rightCandles, 'resistance')
        });
      }
    }

    // Фильтрация и группировка близких уровней
    return this.filterAndGroupLevels(levels);
  }

  // Проверка на уровень поддержки
  isSupportLevel(current, leftCandles, rightCandles) {
    const leftMin = Math.min(...leftCandles.map(c => c.low));
    const rightMin = Math.min(...rightCandles.map(c => c.low));
    
    return current.low <= leftMin && current.low <= rightMin;
  }

  // Проверка на уровень сопротивления
  isResistanceLevel(current, leftCandles, rightCandles) {
    const leftMax = Math.max(...leftCandles.map(c => c.high));
    const rightMax = Math.max(...rightCandles.map(c => c.high));
    
    return current.high >= leftMax && current.high >= rightMax;
  }

  // Расчет силы уровня
  calculateLevelStrength(current, leftCandles, rightCandles, type) {
    let touches = 0;
    const tolerance = 0.001; // 0.1% толерантность

    const checkCandles = [...leftCandles, ...rightCandles];
    const levelPrice = type === 'support' ? current.low : current.high;

    checkCandles.forEach(candle => {
      const candlePrice = type === 'support' ? candle.low : candle.high;
      if (Math.abs(candlePrice - levelPrice) / levelPrice <= tolerance) {
        touches++;
      }
    });

    return touches;
  }

  // Фильтрация и группировка уровней
  filterAndGroupLevels(levels) {
    const tolerance = 0.005; // 0.5% толерантность для группировки

    // Группировка уровней поддержки
    const groupedSupport = this.groupLevels(levels.support, tolerance);
    const groupedResistance = this.groupLevels(levels.resistance, tolerance);

    return {
      support: groupedSupport.sort((a, b) => b.strength - a.strength).slice(0, 5),
      resistance: groupedResistance.sort((a, b) => b.strength - a.strength).slice(0, 5)
    };
  }

  // Группировка близких уровней
  groupLevels(levelArray, tolerance) {
    const groups = [];

    levelArray.forEach(level => {
      let addedToGroup = false;

      for (let group of groups) {
        const avgPrice = group.reduce((sum, l) => sum + l.price, 0) / group.length;
        if (Math.abs(level.price - avgPrice) / avgPrice <= tolerance) {
          group.push(level);
          addedToGroup = true;
          break;
        }
      }

      if (!addedToGroup) {
        groups.push([level]);
      }
    });

    return groups.map(group => ({
      price: group.reduce((sum, l) => sum + l.price, 0) / group.length,
      strength: group.reduce((sum, l) => sum + l.strength, 0),
      touches: group.length,
      timestamps: group.map(l => l.timestamp)
    }));
  }

  // Проверка пробития уровня
  checkBreakout(candles, levels, direction = 'both') {
    if (candles.length < this.confirmationCandles) {
      return null;
    }

    const recentCandles = candles.slice(-this.confirmationCandles);
    const currentPrice = recentCandles[recentCandles.length - 1].close;
    const volume = recentCandles.reduce((sum, c) => sum + c.volume, 0) / recentCandles.length;

    // Проверка объема
    if (volume < this.minVolumeThreshold) {
      return null;
    }

    let breakoutSignal = null;

    // Проверка пробития сопротивления (бычий сигнал)
    if (direction === 'both' || direction === 'up') {
      for (let level of levels.resistance) {
        if (this.isBreakoutUp(recentCandles, level.price)) {
          breakoutSignal = {
            type: 'BUY',
            level: level.price,
            currentPrice: currentPrice,
            strength: level.strength,
            volume: volume,
            timestamp: Date.now()
          };
          break;
        }
      }
    }

    // Проверка пробития поддержки (медвежий сигнал)
    if (!breakoutSignal && (direction === 'both' || direction === 'down')) {
      for (let level of levels.support) {
        if (this.isBreakoutDown(recentCandles, level.price)) {
          breakoutSignal = {
            type: 'SELL',
            level: level.price,
            currentPrice: currentPrice,
            strength: level.strength,
            volume: volume,
            timestamp: Date.now()
          };
          break;
        }
      }
    }

    return breakoutSignal;
  }

  // Проверка пробития сопротивления
  isBreakoutUp(candles, resistanceLevel) {
    const tolerance = 0.002; // 0.2% толерантность

    // Проверяем, что цена пробила уровень
    const lastCandle = candles[candles.length - 1];
    if (lastCandle.close <= resistanceLevel * (1 + tolerance)) {
      return false;
    }

    // Проверяем подтверждение пробития
    const confirmationCandles = candles.slice(-2);
    const confirmedBreakout = confirmationCandles.every(candle => 
      candle.close > resistanceLevel * (1 - tolerance)
    );

    return confirmedBreakout;
  }

  // Проверка пробития поддержки
  isBreakoutDown(candles, supportLevel) {
    const tolerance = 0.002; // 0.2% толерантность

    // Проверяем, что цена пробила уровень
    const lastCandle = candles[candles.length - 1];
    if (lastCandle.close >= supportLevel * (1 - tolerance)) {
      return false;
    }

    // Проверяем подтверждение пробития
    const confirmationCandles = candles.slice(-2);
    const confirmedBreakout = confirmationCandles.every(candle => 
      candle.close < supportLevel * (1 + tolerance)
    );

    return confirmedBreakout;
  }

  // Расчет дополнительных индикаторов
  calculateIndicators(candles) {
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);

    // RSI
    const rsi = RSI.calculate({
      values: closes,
      period: 14
    });

    // SMA
    const sma20 = SMA.calculate({
      values: closes,
      period: 20
    });

    const sma50 = SMA.calculate({
      values: closes,
      period: 50
    });

    const sma200 = SMA.calculate({
      values: closes,
      period: 200
    });

    // MACD
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9
    });

    // Анализ тренда
    const trendAnalysis = this.analyzeTrend(closes, sma20, sma50, sma200);

    return {
      rsi: rsi[rsi.length - 1],
      sma20: sma20[sma20.length - 1],
      sma50: sma50[sma50.length - 1],
      sma200: sma200[sma200.length - 1],
      macd: macd[macd.length - 1],
      volume: volumes[volumes.length - 1],
      trend: trendAnalysis
    };
  }

  // Анализ тренда
  analyzeTrend(closes, sma20, sma50, sma200) {
    if (closes.length < 50) {
      return { direction: 'NEUTRAL', strength: 0, description: 'Недостаточно данных' };
    }

    const currentPrice = closes[closes.length - 1];
    const currentSma20 = sma20[sma20.length - 1];
    const currentSma50 = sma50[sma50.length - 1];
    const currentSma200 = sma200[sma200.length - 1];

    // Проверяем позицию цены относительно SMA
    const priceAboveSma20 = currentPrice > currentSma20;
    const priceAboveSma50 = currentPrice > currentSma50;
    const priceAboveSma200 = currentPrice > currentSma200;

    // Проверяем наклон SMA
    const sma20Slope = this.calculateSlope(sma20.slice(-5));
    const sma50Slope = this.calculateSlope(sma50.slice(-5));

    // Определяем направление тренда
    let direction = 'NEUTRAL';
    let strength = 0;
    let description = '';

    // Сильный восходящий тренд
    if (priceAboveSma20 && priceAboveSma50 && priceAboveSma200 && sma20Slope > 0 && sma50Slope > 0) {
      direction = 'STRONG_UP';
      strength = 3;
      description = 'Сильный восходящий тренд';
    }
    // Умеренный восходящий тренд
    else if (priceAboveSma20 && priceAboveSma50 && sma20Slope > 0) {
      direction = 'UP';
      strength = 2;
      description = 'Восходящий тренд';
    }
    // Слабый восходящий тренд
    else if (priceAboveSma20 && sma20Slope > 0) {
      direction = 'WEAK_UP';
      strength = 1;
      description = 'Слабый восходящий тренд';
    }
    // Сильный нисходящий тренд
    else if (!priceAboveSma20 && !priceAboveSma50 && !priceAboveSma200 && sma20Slope < 0 && sma50Slope < 0) {
      direction = 'STRONG_DOWN';
      strength = 3;
      description = 'Сильный нисходящий тренд';
    }
    // Умеренный нисходящий тренд
    else if (!priceAboveSma20 && !priceAboveSma50 && sma20Slope < 0) {
      direction = 'DOWN';
      strength = 2;
      description = 'Нисходящий тренд';
    }
    // Слабый нисходящий тренд
    else if (!priceAboveSma20 && sma20Slope < 0) {
      direction = 'WEAK_DOWN';
      strength = 1;
      description = 'Слабый нисходящий тренд';
    }
    // Боковой тренд
    else {
      direction = 'SIDEWAYS';
      strength = 0;
      description = 'Боковой тренд';
    }

    return {
      direction,
      strength,
      description,
      priceAboveSma20,
      priceAboveSma50,
      priceAboveSma200,
      sma20Slope,
      sma50Slope
    };
  }

  // Расчет наклона линии
  calculateSlope(values) {
    if (values.length < 2) return 0;
    
    const n = values.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }

  // Фильтрация сигналов по дополнительным индикаторам
  filterSignalByIndicators(signal, indicators) {
    if (!signal) return null;

    // Фильтр по RSI
    if (signal.type === 'BUY' && indicators.rsi > 70) {
      return null; // Перекупленность
    }
    if (signal.type === 'SELL' && indicators.rsi < 30) {
      return null; // Перепроданность
    }

    // Улучшенный фильтр по тренду
    const trend = indicators.trend;
    
    // Для покупок (LONG) - предпочитаем восходящий тренд
    if (signal.type === 'BUY') {
      // Блокируем покупки при сильном нисходящем тренде
      if (trend.direction === 'STRONG_DOWN' || trend.direction === 'DOWN') {
        return null;
      }
      
      // Ослабляем сигналы при слабом нисходящем тренде
      if (trend.direction === 'WEAK_DOWN') {
        signal.strength = Math.max(1, signal.strength - 1);
      }
      
      // Усиливаем сигналы при восходящем тренде
      if (trend.direction === 'STRONG_UP' || trend.direction === 'UP') {
        signal.strength += 1;
      }
    }
    
    // Для продаж (SHORT) - предпочитаем нисходящий тренд
    if (signal.type === 'SELL') {
      // Блокируем продажи при сильном восходящем тренде
      if (trend.direction === 'STRONG_UP' || trend.direction === 'UP') {
        return null;
      }
      
      // Ослабляем сигналы при слабом восходящем тренде
      if (trend.direction === 'WEAK_UP') {
        signal.strength = Math.max(1, signal.strength - 1);
      }
      
      // Усиливаем сигналы при нисходящем тренде
      if (trend.direction === 'STRONG_DOWN' || trend.direction === 'DOWN') {
        signal.strength += 1;
      }
    }

    // Фильтр по MACD
    if (signal.type === 'BUY' && indicators.macd.MACD < indicators.macd.signal) {
      return null; // Медвежий MACD
    }
    if (signal.type === 'SELL' && indicators.macd.MACD > indicators.macd.signal) {
      return null; // Бычий MACD
    }

    // Добавляем информацию о тренде к сигналу
    signal.trend = trend;
    
    return signal;
  }

  // Основной метод анализа
  analyze(candles) {
    if (candles.length < 100) {
      return { error: 'Недостаточно данных для анализа' };
    }

    try {
      // Находим уровни
      const levels = this.findSupportResistanceLevels(candles, this.supportResistancePeriod);
      
      // Проверяем пробития
      const breakoutSignal = this.checkBreakout(candles, levels);
      
      // Рассчитываем индикаторы
      const indicators = this.calculateIndicators(candles);
      
      // Фильтруем сигнал
      const filteredSignal = this.filterSignalByIndicators(breakoutSignal, indicators);

      return {
        levels: levels,
        signal: filteredSignal,
        indicators: indicators,
        currentPrice: candles[candles.length - 1].close,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Ошибка анализа:', error);
      return { error: error.message };
    }
  }
}

module.exports = BreakoutStrategy; 