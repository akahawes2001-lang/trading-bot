require('dotenv').config();

const TelegramApi = require('node-telegram-bot-api');
const TelegramBot = TelegramApi.TelegramBot || TelegramApi;
const http = require('http');
const fs = require('fs');
const pathModule = require('path');

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const apiBase = `http://127.0.0.1:${process.env.PORT || 3000}/api`;
const stdoutLogPath = pathModule.resolve(__dirname, '../../bot_stdout.log');

if (!token || !chatId) {
  console.error('TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы');
  process.exit(1);
}

function isAllowed(msg) {
  return msg && msg.chat && msg.chat.id && msg.chat.id.toString() === chatId.toString();
}

async function apiGet(path) {
  return apiRequest('GET', path);
}

async function apiPost(path, body = {}) {
  return apiRequest('POST', path, body);
}

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: Number(process.env.PORT || 3000),
      path: `/api${path}`,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : undefined,
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Некорректный JSON от API: ${error.message}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout локального API'));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function send(bot, text, options = {}) {
  try {
    await bot.sendMessage(chatId, text, options);
  } catch (error) {
    console.error('Telegram send error:', error.message);
    await bot.sendMessage(chatId, text.replace(/[*_`\[]/g, ''));
  }
}

function mainKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💰 Баланс', callback_data: 'balance' },
          { text: '📋 Позиции', callback_data: 'positions' }
        ],
        [
          { text: '📊 Статус', callback_data: 'status' },
          { text: '🏆 Рейтинг', callback_data: 'rating' }
        ],
        [
          { text: '🔍 Анализ рынка', callback_data: 'analyze' },
          { text: '📈 Сделки', callback_data: 'trades' }
        ],
        [
          { text: '🔄 Перезапуск Telegram', callback_data: 'restart_telegram' }
        ]
      ]
    }
  };
}

function readTradingLog() {
  try {
    return fs.readFileSync(stdoutLogPath, 'utf8').split(/\r?\n/);
  } catch (error) {
    return [];
  }
}

function getFallbackState() {
  const lines = readTradingLog();
  const positions = new Map();
  const trades = [];
  let balance = 100;
  let initialBalance = 100;
  let isRunning = lines.some((line) => line.includes('Торговый бот автоматически запущен') || line.includes('Торговый бот запущен успешно'));
  let pendingOpen = null;

  for (const line of lines) {
    const balanceMatch = line.match(/Начальный баланс:\s*\$(\d+(?:\.\d+)?)/);
    if (balanceMatch) {
      initialBalance = Number(balanceMatch[1]);
      balance = initialBalance;
    }

    const signalMatch = line.match(/Сигнал\s+(BUY|SELL)\s+для\s+([^\s]+)\s+по цене\s+(\d+(?:\.\d+)?)/);
    if (signalMatch) {
      pendingOpen = {
        type: signalMatch[1] === 'BUY' ? 'LONG' : 'SHORT',
        symbol: signalMatch[2],
        entryPrice: Number(signalMatch[3])
      };
    }

    const openMatch = line.match(/Позиция\s+(LONG|SHORT)\s+открыта по\s+([^\s]+).*симуляция/);
    if (openMatch) {
      pendingOpen = {
        ...(pendingOpen || {}),
        type: openMatch[1],
        symbol: openMatch[2]
      };
    }

    const sizeMatch = line.match(/Размер позиции:\s+(\d+(?:\.\d+)?)\s+\(USDT\)/);
    if (sizeMatch && pendingOpen && pendingOpen.symbol) {
      positions.set(pendingOpen.symbol, {
        symbol: pendingOpen.symbol,
        type: pendingOpen.type || 'N/A',
        entryPrice: pendingOpen.entryPrice || 0,
        size: Number(sizeMatch[1])
      });
      pendingOpen = null;
    }

    const closeMatch = line.match(/📊\s+([^:]+):\s+([^,]+),\s+PnL:\s+(-?\d+(?:\.\d+)?)/);
    if (closeMatch) {
      const symbol = closeMatch[1].trim();
      const reason = closeMatch[2].trim();
      const pnl = Number(closeMatch[3]);
      const existing = positions.get(symbol) || { symbol, type: 'N/A', size: 0 };
      trades.unshift({ symbol, type: existing.type, closeReason: reason, pnl });
      positions.delete(symbol);
      balance += pnl;
    }
  }

  const activePositions = Array.from(positions.values());
  const used = activePositions.reduce((sum, p) => sum + (p.size || 0), 0);
  return {
    isRunning,
    statistics: {
      totalBalance: balance,
      availableBalance: balance - used,
      activePositions: activePositions.length,
      maxPositions: 10
    },
    activePositions,
    trades,
    symbolsCount: 0
  };
}

async function handleStatus(bot) {
  let data;
  let source = 'API';
  try {
    const result = await apiGet('/bot/status');
    data = result.data;
  } catch (error) {
    data = getFallbackState();
    source = 'лог';
  }
  const s = data.statistics || {};
  await send(bot,
    `📊 Статус QTrader (${source})\n\n` +
    `• Trading-бот: ${data.isRunning ? 'запущен' : 'остановлен'}\n` +
    `• Баланс: $${(s.totalBalance || 0).toFixed(2)}\n` +
    `• Доступно: $${(s.availableBalance || 0).toFixed(2)}\n` +
    `• Позиции: ${s.activePositions || 0} / ${s.maxPositions || 0}\n` +
    `• Символов: ${(data.symbols || []).length}`,
    mainKeyboard()
  );
}

async function handleBalance(bot) {
  let s;
  let source = 'API';
  try {
    const result = await apiGet('/bot/status');
    s = result.data.statistics || {};
  } catch (error) {
    s = getFallbackState().statistics;
    source = 'лог';
  }
  await send(bot,
    `💰 Баланс (${source})\n\n` +
    `• Общий: $${(s.totalBalance || 0).toFixed(2)}\n` +
    `• Доступно: $${(s.availableBalance || 0).toFixed(2)}\n` +
    `• Активных позиций: ${s.activePositions || 0} / ${s.maxPositions || 0}`,
    mainKeyboard()
  );
}

async function handleRating(bot) {
  let s;
  let source = 'API';
  try {
    const result = await apiGet('/statistics');
    s = result.data || {};
  } catch (error) {
    s = getFallbackState().statistics;
    source = 'лог';
  }
  const total = s.totalBalance || 0;
  const initial = s.initialBalance || 100;
  const change = total - initial;
  const changePercent = initial > 0 ? ((change / initial) * 100).toFixed(2) : '0.00';
  const sign = change >= 0 ? '+' : '';

  await send(bot,
    `🏆 Рейтинг (${source})\n\n` +
    `• Начальный баланс: ${initial.toFixed(2)}\n` +
    `• Текущий баланс: ${total.toFixed(2)}\n` +
    `• Изменение: ${sign}${change.toFixed(2)} (${sign}${changePercent}%)\n` +
    `• Всего сделок: ${s.totalTrades || 0}\n` +
    `• Успешных: ${s.winTrades || 0}\n` +
    `• Убыточных: ${s.lossTrades || 0}\n` +
    `• Win rate: ${s.winRate ? s.winRate.toFixed(1) : '0.0'}%\n` +
    `• Активных позиций: ${s.activePositions || 0} / ${s.maxPositions || 0}`,
    mainKeyboard()
  );
}

async function handlePositions(bot) {
  let positions;
  let source = 'API';
  try {
    const result = await apiGet('/bot/status');
    positions = result.data.activePositions || [];
  } catch (error) {
    positions = getFallbackState().activePositions || [];
    source = 'лог';
  }
  if (positions.length === 0) {
    await send(bot, '📋 Активных позиций нет', mainKeyboard());
    return;
  }

  let text = `📋 Активные позиции (${positions.length}, ${source})\n\n`;
  for (const p of positions) {
    const pnl = p.pnl || 0;
    const sign = pnl >= 0 ? '+' : '';
    text += `${p.type === 'LONG' ? '🟢' : '🔴'} ${p.symbol} [${p.type}]\n`;
    text += `• Вход: $${(p.entryPrice || 0).toFixed(4)}\n`;
    text += `• Текущая: $${(p.currentPrice || p.entryPrice || 0).toFixed(4)}\n`;
    text += `• Размер: $${(p.size || 0).toFixed(2)}\n`;
    text += `• PnL: ${sign}${pnl.toFixed(2)}\n`;
    if (p.stopLoss) text += `• SL: $${p.stopLoss.toFixed(4)}\n`;
    if (p.takeProfit) text += `• TP: $${p.takeProfit.toFixed(4)}\n`;
    text += `• Закрыть: /close ${p.symbol}\n\n`;
  }

  await send(bot, text, mainKeyboard());
}

async function handleTrades(bot) {
  let trades;
  let source = 'API';
  try {
    const result = await apiGet('/trades?limit=10');
    trades = result.data || [];
  } catch (error) {
    trades = getFallbackState().trades.slice(0, 10);
    source = 'лог';
  }
  if (trades.length === 0) {
    await send(bot, '📈 История закрытых сделок пока пуста', mainKeyboard());
    return;
  }

  let text = `📈 Последние закрытые сделки (${source})\n\n`;
  for (const t of trades) {
    const pnl = t.pnl || 0;
    const sign = pnl >= 0 ? '+' : '';
    text += `${pnl >= 0 ? '🟢' : '🔴'} ${t.symbol} [${t.type}]\n`;
    text += `• Причина: ${t.closeReason || 'N/A'}\n`;
    text += `• PnL: ${sign}${pnl.toFixed(2)}\n\n`;
  }
  await send(bot, text, mainKeyboard());
}

async function handleClose(bot, symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) {
    await send(bot, 'Укажите символ: /close BTCUSDT');
    return;
  }

  const result = await apiPost('/positions/close', { symbol: normalized });
  if (result.success) {
    const p = result.position || {};
    const pnl = p.pnl || 0;
    const sign = pnl >= 0 ? '+' : '';
    await send(bot,
      `✅ Позиция закрыта: ${normalized}\n\n` +
      `• Причина: ${p.closeReason || 'MANUAL'}\n` +
      `• PnL: ${sign}${pnl.toFixed(2)}`,
      mainKeyboard()
    );
  } else {
    await send(bot, `❌ Не удалось закрыть ${normalized}: ${result.error || 'неизвестная ошибка'}`, mainKeyboard());
  }
}

async function handleStartTrading(bot) {
  const result = await apiPost('/bot/start');
  await send(bot, result.success
    ? '✅ Trading-бот запущен. Активные сделки и история остаются в основном процессе.'
    : `ℹ️ Trading-бот не запущен: ${result.error || 'неизвестная причина'}`,
    mainKeyboard()
  );
}

async function handleStopTrading(bot) {
  const result = await apiPost('/bot/stop');
  await send(bot, result.success
    ? '⏹ Trading-бот остановлен. Это остановит анализ и обновление позиций.'
    : `ℹ️ Trading-бот не остановлен: ${result.error || 'неизвестная причина'}`,
    mainKeyboard()
  );
}

async function handleAnalyze(bot) {
  await send(bot, '🔍 Запускаю ручной анализ рынка через trading API...', mainKeyboard());
  const result = await apiPost('/bot/forceAnalyze');
  const status = await apiGet('/bot/status');
  const signals = status.data && status.data.lastSignals ? status.data.lastSignals : [];
  const last = signals[signals.length - 1];

  let text = '✅ Ручной анализ завершён.\n';
  if (result.result && result.result.skipped) {
    text += `\nПричина пропуска: ${result.result.reason}`;
  } else if (last) {
    text += `\nПоследний сигнал: ${last.type} ${last.symbol}\n` +
      `Цена: $${(last.currentPrice || 0).toFixed(4)}\n` +
      `Сила: ${(last.strength || 0).toFixed(2)}`;
  } else {
    text += '\nНовых сигналов нет.';
  }
  await send(bot, text, mainKeyboard());
}

async function restartTelegramPolling(bot) {
  await send(bot, '🔄 Перезапускаю только Telegram polling. Trading-бот и сделки не трогаю...', mainKeyboard());
  await bot.stopPolling();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await bot.startPolling();
  await send(bot, '✅ Telegram polling перезапущен. Trading-бот продолжает работать без перерыва.', mainKeyboard());
}

async function safeRun(bot, msg, fn) {
  if (!isAllowed(msg)) return;
  try {
    await fn();
  } catch (error) {
    console.error('Command error:', error.message);
    await send(bot, `❌ Ошибка команды: ${error.message}`, mainKeyboard());
  }
}

async function main() {
  const bot = new TelegramBot(token, { polling: true });
  let isShuttingDown = false;

  bot.on('polling_error', (error) => {
    console.error('Telegram polling error:', error.message || error);
  });

  bot.onText(/\/start|\/menu|\/help/, (msg) => safeRun(bot, msg, async () => {
    await send(bot,
      '✅ Telegram-команды QTrader активны\n\n' +
      'Доступно:\n' +
      '• /status - статус бота\n' +
      '• /balance - баланс\n' +
      '• /positions - открытые позиции\n' +
      '• /trades - последние закрытые сделки\n' +
      '• /close SYMBOL - закрыть позицию вручную\n' +
      '• /analyze - ручной анализ рынка\n' +
      '• /restart_telegram - перезапуск только Telegram polling\n' +
      '• /start_bot и /stop_bot - запуск/остановка trading-бота через API\n\n' +
      'Telegram запущен отдельным процессом. Его можно перезапускать без остановки trading-бота.',
      mainKeyboard()
    );
  }));

  bot.onText(/\/status/, (msg) => safeRun(bot, msg, () => handleStatus(bot)));
  bot.onText(/\/balance/, (msg) => safeRun(bot, msg, () => handleBalance(bot)));
  bot.onText(/\/rating/, (msg) => safeRun(bot, msg, () => handleRating(bot)));
  bot.onText(/\/positions/, (msg) => safeRun(bot, msg, () => handlePositions(bot)));
  bot.onText(/\/trades/, (msg) => safeRun(bot, msg, () => handleTrades(bot)));
  bot.onText(/\/close\s+(.+)/, (msg, match) => safeRun(bot, msg, () => handleClose(bot, match[1])));
  bot.onText(/\/start_bot/, (msg) => safeRun(bot, msg, () => handleStartTrading(bot)));
  bot.onText(/\/stop_bot/, (msg) => safeRun(bot, msg, () => handleStopTrading(bot)));
  bot.onText(/\/analyze/, (msg) => safeRun(bot, msg, () => handleAnalyze(bot)));
  bot.onText(/\/restart_telegram/, (msg) => safeRun(bot, msg, () => restartTelegramPolling(bot)));

  bot.on('callback_query', async (query) => {
    const msg = query.message;
    if (!isAllowed(msg)) return;
    try {
      await bot.answerCallbackQuery(query.id);
      if (query.data === 'status') await handleStatus(bot);
      if (query.data === 'balance') await handleBalance(bot);
      if (query.data === 'positions') await handlePositions(bot);
      if (query.data === 'rating') await handleRating(bot);
      if (query.data === 'trades') await handleTrades(bot);
      if (query.data === 'analyze') await handleAnalyze(bot);
      if (query.data === 'restart_telegram') await restartTelegramPolling(bot);
    } catch (error) {
      console.error('Callback error:', error.message);
      await send(bot, `❌ Ошибка: ${error.message}`, mainKeyboard());
    }
  });

  console.log('Telegram command bridge started');

  let ready = false;
  for (let i = 0; i < 12; i += 1) {
    try {
      const status = await apiGet('/bot/status');
      ready = !!status;
      break;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  if (!ready) {
    console.warn('API trading-бота пока недоступен, bridge продолжит попытки через команды');
  }

  await send(bot, '✅ Telegram-команды перезапущены отдельным процессом. Trading-бот не трогал.', mainKeyboard());

  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`${signal}: stopping Telegram command bridge only`);
    try {
      await bot.stopPolling();
    } catch (error) {
      console.error('Telegram stopPolling error:', error.message);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Telegram command bridge fatal:', error.message);
  process.exit(1);
});