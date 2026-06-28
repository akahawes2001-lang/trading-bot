require('dotenv').config();

const config = {
  // Режим работы: demo или live
  botMode: process.env.BOT_MODE || 'demo',

  // Демо-настройки
  demo: {
    balance: parseFloat(process.env.DEMO_BALANCE) || 100,
    riskPercent: parseFloat(process.env.RISK_PERCENT) || 2,   // переопределяется
    maxPositions: parseInt(process.env.MAX_POSITIONS) || 3    // переопределяется
  },

  // API Bybit
  bybit: {
    apiKey: process.env.BYBIT_API_KEY,
    secretKey: process.env.BYBIT_SECRET_KEY,
    testnet: process.env.BYBIT_TESTNET === 'true',
    baseUrl: process.env.BYBIT_TESTNET === 'true'
      ? 'https://api-testnet.bybit.com'
      : 'https://api.bybit.com',
    wsUrl: process.env.BYBIT_TESTNET === 'true'
      ? 'wss://stream-testnet.bybit.com'
      : 'wss://stream.bybit.com'
  },

  // Настройки стратегии
  strategy: {
    breakoutConfirmationCandles: parseInt(process.env.BREAKOUT_CONFIRMATION_CANDLES) || 3,
    supportResistancePeriod: parseInt(process.env.SUPPORT_RESISTANCE_PERIOD) || 20,
    minVolumeThreshold: parseFloat(process.env.MIN_VOLUME_THRESHOLD) || 1000000
  },

  // Управление капиталом и динамические символы
  numberOfPositions: parseInt(process.env.NUMBER_OF_POSITIONS) || 10,
  minVolume: parseFloat(process.env.MIN_VOLUME) || 1000000,
  topSymbolsCount: parseInt(process.env.TOP_SYMBOLS_COUNT) || 20,
  useDynamicSymbols: process.env.USE_DYNAMIC_SYMBOLS !== 'false',
  topPositiveCount: parseInt(process.env.TOP_POSITIVE_COUNT) || 20,
  topNegativeCount: parseInt(process.env.TOP_NEGATIVE_COUNT) || 20,
  maxSymbolsTotal: parseInt(process.env.MAX_SYMBOLS_TOTAL) || 50,

  // НОВЫЙ ПАРАМЕТР: отправлять реальные ордера даже в демо-режиме
  sendOrdersInDemo: process.env.DEMO_SEND_REAL_ORDERS === 'true',

  // Статический список (если useDynamicSymbols = false)
  symbols: (process.env.TRADING_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,ADAUSDT,DOTUSDT').split(','),

  // Сервер
  server: {
    port: parseInt(process.env.PORT) || 3000,
    env: process.env.NODE_ENV || 'development'
  }
};

// Переопределяем riskPercent и maxPositions через numberOfPositions
if (config.numberOfPositions > 0) {
  config.demo.riskPercent = 100 / config.numberOfPositions;
  config.demo.maxPositions = config.numberOfPositions;
}

module.exports = config;