/**
 * test-bot.js — Временный скрипт для диагностики бота
 * Запуск: node test-bot.js
 */
require('dotenv').config();
const config = require('./src/config/config');

async function main() {
  console.log('=== QTrader Диагностика ===\n');
  
  // 1. Конфиг
  console.log('1. Конфигурация:');
  console.log('   botMode:', config.botMode);
  console.log('   balance:', config.demo.balance);
  console.log('   numPositions:', config.numberOfPositions);
  console.log('   minVolume:', config.minVolume);
  console.log('   topPositive:', config.topPositiveCount);
  console.log('   topNegative:', config.topNegativeCount);
  console.log('   maxSymbols:', config.maxSymbolsTotal);
  console.log('   TELEGRAM_TOKEN:', process.env.TELEGRAM_BOT_TOKEN ? 'OK' : 'MISSING');
  console.log('   TELEGRAM_CHAT_ID:', process.env.TELEGRAM_CHAT_ID || 'MISSING');
  
  // 2. PositionManager
  console.log('\n2. PositionManager:');
  const PositionManager = require('./src/trading/positionManager');
  const pm = new PositionManager();
  console.log('   balance:', pm.balance);
  console.log('   available:', pm.getAvailableBalance());
  console.log('   maxPositions:', pm.maxPositions);
  
  // 3. TradingBot
  console.log('\n3. TradingBot:');
  const TradingBot = require('./src/trading/tradingBot');
  const bot = new TradingBot();
  console.log('   isRunning:', bot.isRunning);
  console.log('   activeSymbols:', bot.activeSymbols.length);
  
  // 4. Symbols
  console.log('\n4. Инициализация символов...');
  try {
    await bot.initializeSymbols();
    console.log('   symbols:', bot.activeSymbols.length);
    if (bot.activeSymbols.length > 0) {
      console.log('   first 10:', bot.activeSymbols.slice(0, 10).join(', '));
    }
  } catch (e) {
    console.error('   ERROR:', e.message);
  }
  
  // 5. Market data
  console.log('\n5. Рыночные данные...');
  if (bot.activeSymbols.length > 0) {
    try {
      await bot.initializeMarketData();
      console.log('   loaded:', bot.marketData.size, 'symbols');
    } catch (e) {
      console.error('   ERROR:', e.message);
    }
  }
  
  // 6. Analysis
  console.log('\n6. Принудительный анализ...');
  try {
    const result = await bot.performAnalysis(true);
    const count = Array.isArray(result) ? result.length : 0;
    console.log('   processed:', count, 'symbols');
    if (count > 0) {
      const signals = result.filter(r => r.analysis && r.analysis.signal);
      console.log('   signals found:', signals.length);
    }
  } catch (e) {
    console.error('   ERROR:', e.message);
  }
  
  // 7. Positions
  console.log('\n7. Позиции:');
  const positions = bot.positionManager.getActivePositions();
  console.log('   active:', positions.length);
  console.log('   balance:', bot.positionManager.balance);
  console.log('   available:', bot.positionManager.getAvailableBalance());
  
  // 8. Test signal (если нет позиций)
  if (positions.length === 0 && bot.activeSymbols.length > 0) {
    console.log('\n8. Тестовый сигнал...');
    const sym = bot.activeSymbols[0];
    console.log('   Trying', sym);
    try {
      const ticker = await bot.api.getTickerPrice(sym);
      if (ticker && ticker.price) {
        const sig = { type: 'BUY', level: ticker.price, strength: 0.5 };
        const r = await bot.positionManager.openPosition(sym, sig, ticker.price);
        console.log('   result:', r.success ? 'OK' : 'FAIL', r.message || r.error);
        if (r.success) {
          console.log('   position:', r.position.type, r.position.symbol, 'size:', r.position.size);
        }
      }
    } catch (e) {
      console.error('   ERROR:', e.message);
    }
  }
  
  // 9. Stats
  console.log('\n9. Статистика:');
  const stats = bot.positionManager.getStatistics();
  console.log('   totalBalance:', stats.totalBalance);
  console.log('   availableBalance:', stats.availableBalance);
  console.log('   activePositions:', stats.activePositions);
  console.log('   totalTrades:', stats.totalTrades);
  
  console.log('\n=== Диагностика завершена ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

