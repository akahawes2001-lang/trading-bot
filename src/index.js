const TradingBotServer = require('./server/app');
const config = require('./config/config');
const TelegramNotifier = require('./services/telegramBot');


// Создание и запуск сервера

// Создание и запуск сервера

const server = new TradingBotServer();
const telegram = new TelegramNotifier(server.bot);
server.bot.telegram = telegram;

// Обработка необработанных исключений
process.on('uncaughtException', (error) => {
  console.error('❌ Необработанное исключение:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Необработанное отклонение промиса:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Получен сигнал SIGINT, завершение работы...');
  server.bot.stop();
  telegram.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Получен сигнал SIGTERM, завершение работы...');
  server.bot.stop();
  process.exit(0);
});

// Запуск сервера
// Запуск сервера и торгового бота
async function main() {
  try {
    server.start();
    // Автоматический запуск торгового бота после запуска сервера
    // Инициализация Telegram
    await telegram.init();
    console.log('Автоматический запуск торгового бота...');
    const result = await server.bot.start();
    if (result.success) {
      console.log('Торговый бот автоматически запущен');
    } else {
      console.error('Ошибка автоматического запуска бота:', result.error);
    }
  } catch (error) {
    console.error('Ошибка запуска:', error);
    process.exit(1);
  }
}

main(); 