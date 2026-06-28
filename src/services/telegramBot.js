const TelegramApi = require('node-telegram-bot-api');
const TelegramBot = TelegramApi.TelegramBot || TelegramApi;

class TelegramNotifier {
  constructor(botInstance) {
    this.botInstance = botInstance;
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID;
    this.proxy = process.env.TELEGRAM_PROXY || process.env.https_proxy || process.env.HTTPS_PROXY || null;
    this.bot = null;
    this.isInitialized = false;
    this._reconnectTimer = null;
  }

  async init() {
    console.log('🔧 Инициализация Telegram-бота...');
    console.log(`   TOKEN: ${this.token ? 'установлен (скрыт)' : 'ОТСУТСТВУЕТ'}`);
    console.log(`   CHAT_ID: ${this.chatId || 'ОТСУТСТВУЕТ'}`);
    if (!this.token) {
      console.log('TELEGRAM_BOT_TOKEN not set, Telegram disabled');
      return false;
    }
    try {
      const botOptions = { polling: { interval: 2000, params: { timeout: 30 } } };
      if (this.proxy) {
        console.log('   PROXY: ' + this.proxy);
        try {
          const HttpsProxyAgent = require('https-proxy-agent');
          botOptions.request = { agent: HttpsProxyAgent(this.proxy) };
        } catch (e) {
          console.log('   proxy package not installed, trying env HTTP_PROXY...');
          process.env.HTTPS_PROXY = this.proxy;
        }
      }
      this.bot = new TelegramBot(this.token, botOptions);
      this.setupCallbacks();
      this.isInitialized = true;
      console.log('✅ Telegram бот инициализирован, isInitialized =', this.isInitialized);
      this.bot.on('message', (msg) => this.captureChatId(msg));
      if (!this.chatId) {
        await this.resolveChatIdFromUpdates();
      }
      if (this.chatId) {
        await this.sendMainMenu();
      } else {
        console.log('Telegram: waiting for first message to set chat ID');
      }
      console.log('Telegram bot initialized');
      return true;
    } catch (error) {
      console.error('Telegram init error:', error.message);
      return false;
    }
  }


  sendMainMenu() {
    if (!this.bot || !this.chatId) {
      console.log('⚠️ sendMainMenu пропущен: bot или chatId отсутствуют');
      return;
    }
    this.bot.sendMessage(this.chatId,
      '\u{1F916} \u041C\u0435\u043D\u044E \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F:\n\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435:',
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '\u25B6\uFE0F \u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0431\u043E\u0442\u0430', callback_data: 'start_bot' },
              { text: '\u23F9\uFE0F \u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0431\u043E\u0442\u0430', callback_data: 'stop_bot' }
            ],
            [
              { text: '\u{1F4B0} \u0411\u0430\u043B\u0430\u043D\u0441', callback_data: 'balance' },
              { text: '\u{1F4CA} \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430', callback_data: 'rating' }
            ],
            [
              { text: '\u{1F50D} \u041F\u043E\u0438\u0441\u043A \u0441\u0434\u0435\u043B\u043A\u0438', callback_data: 'analyze' },
              { text: '\u{1F4CB} \u041F\u043E\u0437\u0438\u0446\u0438\u0438', callback_data: 'positions' }
            ]
          ]
        }
      }
    );
  }

  captureChatId(msg) {
    if (!this.chatId && msg && msg.chat && msg.chat.id) {
      this.chatId = msg.chat.id.toString();
      console.log('Telegram chat ID set to:', this.chatId);
      this.sendMainMenu();
    }
  }

  async resolveChatIdFromUpdates() {
    if (!this.bot || this.chatId) return;
    try {
      const updates = await this.bot.getUpdates({ limit: 10, timeout: 0 });
      const latestMessageUpdate = [...updates].reverse().find((u) => u.message && u.message.chat && u.message.chat.id);
      if (latestMessageUpdate) {
        this.chatId = latestMessageUpdate.message.chat.id.toString();
        console.log('Telegram chat ID restored from updates:', this.chatId);
      }
    } catch (error) {
      console.warn('Telegram: не удалось автоматически получить chat ID:', error.message);
    }
  }

  async sendMessage(text) {
    console.log(`📤 sendMessage вызван, chatId=${this.chatId}, isInitialized=${this.isInitialized}`);
    if (!this.bot || !this.chatId) return false;
    try {
      await this.bot.sendMessage(this.chatId, text, { parse_mode: 'Markdown' });
      return true;
    } catch (error) {
      console.error('Telegram send error:', error.message);
      try {
        await this.bot.sendMessage(this.chatId, text.replace(/[*_`\[]/g, ''));
        return true;
      } catch (fallbackError) {
        console.error('Telegram fallback send error:', fallbackError.message);
        return false;
      }
    }
  }

  async sendWithMenu(text) {
    console.log(`📤 sendWithMenu вызван, chatId=${this.chatId}, isInitialized=${this.isInitialized}`);
    if (!this.bot || !this.chatId) return false;
    try {
      await this.bot.sendMessage(this.chatId, text, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '\u{1F3E0} \u0413\u043B\u0430\u0432\u043D\u043E\u0435 \u043C\u0435\u043D\u044E', callback_data: 'menu' }]
          ]
        }
      });
      return true;
    } catch (error) {
      console.error('Telegram send error:', error.message);
      return false;
    }
  }

  setupCallbacks() {
    if (!this.bot) return;

    this.bot.onText(/\/start/, (msg) => { this.captureChatId(msg); this.sendMainMenu(); });
    this.bot.onText(/\/menu/, (msg) => { this.captureChatId(msg); this.sendMainMenu(); });
    this.bot.onText(/\/start_bot/, () => this.handleStartBot());
    this.bot.onText(/\/stop_bot/, () => this.handleStopBot());
    this.bot.onText(/\/balance/, () => this.handleBalance());
    this.bot.onText(/\/rating/, () => this.handleRating());
    this.bot.onText(/\/analyze/, () => this.handleAnalyze());
    this.bot.onText(/\/positions/, () => this.handlePositions());
    this.bot.onText(/\/close (.+)/, (msg, match) => this.handleClosePosition(match[1]));

    // Авто-переподключение при ошибках polling
    this.bot.on('polling_error', (error) => {
      console.error('Telegram polling error:', error.message);
      if (error.code === 'EFATAL' || error.message.includes('timeout') || error.message.includes('ECONNRESET')) {
        // Планируем переподключение через 10 секунд
        if (!this._reconnectTimer) {
          console.log('Telegram: auto-reconnect scheduled in 10s...');
          this._reconnectTimer = setTimeout(async () => {
            this._reconnectTimer = null;
            console.log('Telegram: reconnecting...');
            try {
              await this.bot.stopPolling();
              await this.bot.startPolling();
              console.log('Telegram: reconnected successfully');
            } catch (e) {
              console.error('Telegram: reconnect failed, watchdog will retry:', e.message);
            }
          }, 10000);
        }
      }
    });

    this.bot.on('callback_query', async (query) => {
      const data = query.data;
      const chatId = query.message.chat.id;
      if (!this.chatId) {
        this.chatId = chatId.toString();
        console.log('Telegram chat ID via callback:', this.chatId);
      }
      await this.bot.answerCallbackQuery(query.id);
      switch (data) {
        case 'menu': await this.sendMainMenu(); break;
        case 'start_bot': await this.handleStartBot(); break;
        case 'stop_bot': await this.handleStopBot(); break;
        case 'balance': await this.handleBalance(); break;
        case 'rating': await this.handleRating(); break;
        case 'analyze': await this.handleAnalyze(); break;
        case 'positions': await this.handlePositions(); break;
        default:
          if (data.startsWith('close_')) {
            const sym = data.substring(6);
            await this.handleClosePosition(sym);
          }
          break;
      }
    });
  }

  async handleClosePosition(symbol) {
    console.log('handleClosePosition:', symbol);
    if (!this.botInstance) {
      await this.sendWithMenu('❌ Бот не инициализирован');
      return;
    }
    const result = await this.botInstance.manualClosePosition(symbol);
    if (result && result.success) {
      await this.sendWithMenu('✅ Позиция по ' + symbol + ' закрыта!\n\nБаланс освободился, бот будет искать новые сделки.');
    } else {
      await this.sendWithMenu('❌ Ошибка закрытия ' + symbol + ': ' + (result?.error || 'неизвестная'));
    }
  }

  async handleStartBot() {
    console.log('handleStartBot')
    if (!this.botInstance) {
      await this.sendWithMenu('❌ Бот не инициализирован');
      return;
    }
    const r = await this.botInstance.start();
    await this.sendWithMenu(r.success
      ? '\u2705 \u0411\u043E\u0442 \u0437\u0430\u043F\u0443\u0449\u0435\u043D!'
      : '\u274C \u041E\u0448\u0438\u0431\u043A\u0430: ' + r.error);
  }

  async handleStopBot() {
    console.log('handleStopBot')
    if (!this.botInstance) {
      await this.sendWithMenu('❌ Бот не инициализирован');
      return;
    }
    const r = this.botInstance.stop();
    await this.sendWithMenu(r.success
      ? '\u23F9 \u0411\u043E\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D'
      : '\u274C \u041E\u0448\u0438\u0431\u043A\u0430: ' + r.error);
  }

  async handleBalance() {
    console.log('handleBalance')
    if (!this.botInstance) {
      await this.sendWithMenu('❌ Бот не инициализирован');
      return;
    }
    const s = this.botInstance.getStatus().statistics;
    await this.sendWithMenu(
      '\u{1F4B0} *\u0411\u0430\u043B\u0430\u043D\u0441*\n\n' +
      '\u2022 \u041E\u0431\u0449\u0438\u0439: *$' + (s.totalBalance || 0).toFixed(2) + '*\n' +
      '\u2022 \u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E: *$' + (s.availableBalance || 0).toFixed(2) + '*\n' +
      '\u2022 \u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0445: ' + (s.activePositions || 0) + ' / ' + (s.maxPositions || 0)
    );
  }

  async handleRating() {
    console.log('handleRating')
    if (!this.botInstance) {
      await this.sendWithMenu('❌ Бот не инициализирован');
      return;
    }
    const s = this.botInstance.getStatus().statistics;
    const pnl = s.totalPnL || 0;
    const emoji = pnl >= 0 ? '\u{1F7E2}' : '\u{1F534}';
    await this.sendWithMenu(
      emoji + ' *\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430*\n\n' +
      '\u2022 \u0421\u0434\u0435\u043B\u043E\u043A: ' + (s.totalTrades || 0) + '\n' +
      '\u2022 \u0412\u044B\u0438\u0433\u0440\u044B\u0448\u043D\u044B\u0445: ' + (s.winningTrades || 0) + '\n' +
      '\u2022 Win Rate: *' + (s.winRate || 0).toFixed(1) + '%*\n' +
      '\u2022 PnL: *' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + '*\n' +
      '\u2022 \u0411\u0430\u043B\u0430\u043D\u0441: $' + (s.totalBalance || 0).toFixed(2)
    );
  }

  async handleAnalyze() {
    console.log('handleAnalyze')
    if (!this.botInstance) {
      await this.sendWithMenu('\u274C \u0411\u043E\u0442 \u043D\u0435 \u0438\u043D\u0438\u0446\u0438\u0430\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D');
      return;
    }
    await this.sendMessage('\u{1F50D} \u0410\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u0443\u044E \u0440\u044B\u043D\u043E\u043A...');
    try {
      await this.botInstance.forcePerformAnalysis();
      const signals = this.botInstance.getSignals();
      if (signals && signals.length > 0) {
        const sig = signals[signals.length - 1];
        const isBuy = sig.type === 'BUY';
        const emoji = isBuy ? '\u{1F7E2}' : '\u{1F534}';
        const typeName = isBuy ? 'LONG (\u043F\u043E\u043A\u0443\u043F\u043A\u0430)' : 'SHORT (\u043F\u0440\u043E\u0434\u0430\u0436\u0430)';
        let msg = emoji + ' *\u0421\u0438\u0433\u043D\u0430\u043B \u043D\u0430\u0439\u0434\u0435\u043D!*\n\n' +
          '\u2022 \u0421\u0438\u043C\u0432\u043E\u043B: ' + sig.symbol + '\n' +
          '\u2022 \u0422\u0438\u043F: ' + typeName + '\n' +
          '\u2022 \u0426\u0435\u043D\u0430: *$' + (sig.currentPrice || sig.level || 0).toFixed(4) + '*\n' +
          '\u2022 \u0421\u0438\u043B\u0430: ' + (sig.strength || 'N/A');
        await this.sendMessage(msg);
        const av = this.botInstance.getStatus().statistics.availableBalance || 0;
        if (av > 0) {
          await this.sendMessage('\u{1F4B0} \u0415\u0441\u0442\u044C \u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0430 ($' + av.toFixed(2) + '), \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u044E...');
          try {
            await this.botInstance.processSignal(sig.symbol, sig, sig.currentPrice);
            const up = this.botInstance.getStatus().statistics;
            await this.sendWithMenu('\u2705 *\u041E\u0442\u043A\u0440\u044B\u0442\u043E!*\n\n' +
              '\u2022 ' + sig.symbol + ' ' + typeName + '\n' +
              '\u2022 \u0426\u0435\u043D\u0430: $' + (sig.currentPrice || 0).toFixed(4) + '\n' +
              '\u2022 \u041E\u0441\u0442\u0430\u0442\u043E\u043A: $' + (up.availableBalance || 0).toFixed(2));
          } catch (err) {
            await this.sendWithMenu('\u274C \u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u044F: ' + err.message);
          }
        } else {
          await this.sendWithMenu('\u26A0\uFE0F *\u041D\u0435\u0442 \u0441\u0440\u0435\u0434\u0441\u0442\u0432*\n\n\u0421\u0438\u0433\u043D\u0430\u043B \u043D\u0430\u0439\u0434\u0435\u043D, \u043D\u043E \u043D\u0435\u0442 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u0441\u0440\u0435\u0434\u0441\u0442\u0432.');
        }
      } else {
        await this.sendWithMenu('\u{1F4CA} \u0421\u0438\u0433\u043D\u0430\u043B\u043E\u0432 \u043D\u0435\u0442.');
      }
    } catch (e) {
      await this.sendWithMenu('\u274C \u041E\u0448\u0438\u0431\u043A\u0430: ' + e.message);
    }
  }

  async handlePositions() {
    console.log('handlePositions')
    if (!this.botInstance) {
      await this.sendWithMenu('\u274C \u0411\u043E\u0442 \u043D\u0435 \u0438\u043D\u0438\u0446\u0438\u0430\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D');
      return;
    }
    const positions = this.botInstance.getStatus().activePositions;
    if (!positions || positions.length === 0) {
      await this.sendWithMenu('\u{1F4CB} \u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u043F\u043E\u0437\u0438\u0446\u0438\u0439');
      return;
    }
    let msg = '\u{1F4CB} \u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u043F\u043E\u0437\u0438\u0446\u0438\u0438 (' + positions.length + '):\n\n';
    positions.forEach((p) => {
      const e = p.type === 'LONG' ? '\u{1F7E2}' : '\u{1F534}';
      const pe = (p.pnl || 0) >= 0 ? '\u{1F7E2}' : '\u{1F534}';
      msg += e + ' *' + p.symbol + '* [' + p.type + ']\n';
      msg += '  \u2022 \u0412\u0445\u043E\u0434: $' + (p.entryPrice || 0).toFixed(4) + '\n';
      msg += '  \u2022 \u0422\u0435\u043A\u0443\u0449\u0430\u044F: $' + (p.currentPrice || p.entryPrice || 0).toFixed(4) + '\n';
      msg += '  \u2022 \u0420\u0430\u0437\u043C\u0435\u0440: $' + (p.size || 0).toFixed(2) + '\n';
      msg += '  \u2022 PnL: ' + pe + ' ' + ((p.pnl || 0) >= 0 ? '+' : '') + (p.pnl || 0).toFixed(2) + '\n';
      if (p.stopLoss) msg += '  \u2022 SL: $' + p.stopLoss.toFixed(4) + '\n';
      if (p.takeProfit) msg += '  \u2022 TP: $' + p.takeProfit.toFixed(4) + '\n';
      msg += '\n';
    });
    await this.sendWithMenu(msg);
  }

  async notifyPositionOpened(position, signal) {
    console.log('notifyPositionOpened:', position.symbol, position.type);
    if (!this.isInitialized) return;
    if (!this.chatId) return;
    const emoji = position.type === 'LONG' ? '\u{1F7E2}' : '\u{1F534}';
    const st = this.botInstance ? this.botInstance.getStatus().statistics : null;
    let m = emoji + ' *\u041F\u043E\u0437\u0438\u0446\u0438\u044F \u041E\u0422\u041A\u0420\u042B\u0422\u0410*\n\n' +
      '\u2022 \u0421\u0438\u043C\u0432\u043E\u043B: ' + position.symbol + '\n' +
      '\u2022 \u0422\u0438\u043F: ' + position.type + '\n' +
      '\u2022 \u0420\u0430\u0437\u043C\u0435\u0440: *$' + (position.size || 0).toFixed(2) + '*\n' +
      '\u2022 \u0426\u0435\u043D\u0430 \u0432\u0445\u043E\u0434\u0430: $' + (position.entryPrice || 0).toFixed(4) + '\n';
    if (position.stopLoss) m += '\u2022 \u0421\u0442\u043E\u043F-\u043B\u043E\u0441\u0441: $' + position.stopLoss.toFixed(4) + '\n';
    if (position.takeProfit) m += '\u2022 \u0422\u0435\u0439\u043A-\u043F\u0440\u043E\u0444\u0438\u0442: $' + position.takeProfit.toFixed(4) + '\n';
    if (signal && signal.currentPrice) m += '\u2022 \u0426\u0435\u043D\u0430 \u0441\u0438\u0433\u043D\u0430\u043B\u0430: $' + signal.currentPrice.toFixed(4) + '\n';
    if (st) m += '\u2022 \u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E: $' + (st.availableBalance || 0).toFixed(2) + '\n';
    await this.sendMessage(m);
  }

  async notifyPositionClosed(position, reason) {
    console.log('notifyPositionClosed:', position.symbol, reason);
    if (!this.isInitialized) return;
    if (!this.chatId) return;
    const isProfit = (position.pnl || 0) >= 0;
    const emoji = isProfit ? '\u{1F7E2}' : '\u{1F534}';
    const st = this.botInstance ? this.botInstance.getStatus().statistics : null;
    let m = emoji + ' *\u041F\u043E\u0437\u0438\u0446\u0438\u044F \u0417\u0410\u041A\u0420\u042B\u0422\u0410*\n\n' +
      '\u2022 \u0421\u0438\u043C\u0432\u043E\u043B: ' + position.symbol + '\n' +
      '\u2022 \u0422\u0438\u043F: ' + position.type + '\n' +
      '\u2022 \u0426\u0435\u043D\u0430 \u0432\u0445\u043E\u0434\u0430: $' + (position.entryPrice || 0).toFixed(4) + '\n' +
      '\u2022 \u0426\u0435\u043D\u0430 \u0432\u044B\u0445\u043E\u0434\u0430: $' + (position.exitPrice || 0).toFixed(4) + '\n' +
      '\u2022 \u0420\u0430\u0437\u043C\u0435\u0440: $' + (position.size || 0).toFixed(2) + '\n' +
      '\u2022 PnL: *' + (isProfit ? '+' : '') + (position.pnl || 0).toFixed(2) + '*\n' +
      '\u2022 \u041F\u0440\u0438\u0447\u0438\u043D\u0430: ' + (reason || 'N/A') + '\n';
    if (st) m += '\u2022 \u0411\u0430\u043B\u0430\u043D\u0441: $' + (st.totalBalance || 0).toFixed(2) + '\n';
    await this.sendMessage(m);
  }

  async notifyBotStarted(statistics) {
    if (!this.isInitialized || !this.chatId) return false;
    const s = statistics || (this.botInstance ? this.botInstance.getStatus().statistics : {});
    return this.sendMessage(
      '✅ *Бот запущен*\n\n' +
      '• Telegram-бот активен\n' +
      '• Торговый бот активен\n' +
      '• Анализ рынка: каждые 5 минут\n' +
      '• Обновление цен открытых позиций: каждые 5 секунд\n' +
      '• Стартовый бюджет: *$' + (s.totalBalance || 0).toFixed(2) + '*\n' +
      '• Доступно: *$' + (s.availableBalance || 0).toFixed(2) + '*'
    );
  }

  async notifyNoBalance(statistics) {
    if (!this.isInitialized || !this.chatId) return false;
    const s = statistics || (this.botInstance ? this.botInstance.getStatus().statistics : {});
    return this.sendMessage(
      '⚠️ *Нет свободного баланса*\n\n' +
      'Анализ рынка временно пропущен, новые сделки не открываются.\n' +
      '• Общий баланс: *$' + (s.totalBalance || 0).toFixed(2) + '*\n' +
      '• Доступно: *$' + (s.availableBalance || 0).toFixed(2) + '*\n' +
      '• Активных позиций: ' + (s.activePositions || 0) + ' / ' + (s.maxPositions || 0)
    );
  }

  stop() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.bot) {
      try { this.bot.stopPolling(); } catch (e) {}
    }
  }
}

module.exports = TelegramNotifier;

