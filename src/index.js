const TradingBotServer = require('./server/app');
const config = require('./config/config');


// Создание и запуск сервера

// Создание и запуск сервера

const server = new TradingBotServer();
let telegram = null;

// Обработка необработанных исключений — не выходим, продолжаем работу
process.on('uncaughtException', (error) => {
  console.error('❌ Необработанное исключение (продолжаем работу):', error.message);
  console.error(error.stack);
  // Не выходим — бот восстановится на следующем цикле
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Необработанное отклонение промиса (продолжаем работу):', reason?.message || reason);
  // Не выходим — продолжаем работу
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Получен сигнал SIGINT, завершение работы...');
  server.bot.stop();
  if (telegram) telegram.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Получен сигнал SIGTERM, завершение работы...');
  server.bot.stop();
  if (telegram) telegram.stop();
  process.exit(0);
});

// Запуск сервера
// Запуск сервера и торгового бота
async function main() {
  try {
    server.start();
    // Инициализация Telegram-бота (уведомления + команды)
    // Telegram работает в том же процессе, что и торговый бот.
    // Это гарантирует получение уведомлений об открытии/закрытии позиций.
    console.log('🔧 Инициализация Telegram-бота...');
    try {
      const TelegramNotifier = require('./services/telegramBot');
      telegram = new TelegramNotifier(server.bot);
      const initialized = await telegram.init();
      if (initialized) {
        server.bot.telegram = telegram;
        console.log('✅ Telegram-бот инициализирован и привязан к торговому боту');
      } else {
        console.log('⚠️ Telegram-бот не инициализирован (проверьте TELEGRAM_BOT_TOKEN)');
      }
    } catch (telegramError) {
      console.error('❌ Ошибка инициализации Telegram:', telegramError.message);
      console.log('⚠️ Продолжаем без Telegram-бота');
    }
    console.log('Автоматический запуск торгового бота...');
    const result = await server.bot.start();
    if (result.success) {
      console.log('Торговый бот автоматически запущен');
      if (telegram && telegram.isInitialized) {
        try {
          await telegram.notifyBotStarted(server.bot.getStatus().statistics);
          console.log('✅ Уведомление о запуске отправлено в Telegram');
        } catch (notifyError) {
          console.error('❌ Ошибка отправки уведомления:', notifyError.message);
        }
      }
    } else {
      console.error('❌ Ошибка автоматического запуска бота:', result.error);
    }
  } catch (error) {
    console.error('Ошибка запуска:', error);
    process.exit(1);
  }
}

main();

// ========== WATCHDOG: мониторинг здоровья бота ==========
setInterval(() => {
  if (!server.bot) return;

  // Проверяем, работает ли интервал анализа
  if (server.bot.isRunning && !server.bot.analysisInterval) {
    console.log('⚠️ Watchdog: analysisInterval отсутствует, перезапускаем анализ...');
    server.bot.startAnalysis();
  }

  // Проверяем интервал обновления позиций
  if (server.bot.isRunning && !server.bot.positionsUpdateInterval) {
    console.log('⚠️ Watchdog: positionsUpdateInterval отсутствует, перезапускаем...');
    server.bot.startPositionsUpdate();
  }

  // Проверяем Telegram
  if (telegram && !telegram.isInitialized) {
    console.log('⚠️ Watchdog: Telegram не инициализирован, пробуем переинициализировать...');
    telegram.init().then(ok => {
      if (ok) {
        server.bot.telegram = telegram;
        console.log('✅ Watchdog: Telegram восстановлен');
      }
    }).catch(e => console.error('❌ Watchdog: ошибка восстановления Telegram:', e.message));
  }
}, 30000); // Проверка каждые 30 секунд

console.log('🐕 Watchdog активен (проверка каждые 30 секунд)');