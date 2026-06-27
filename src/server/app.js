const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const TradingBot = require('../trading/tradingBot');
const config = require('../config/config');

class TradingBotServer {
  constructor() {
    this.app = express();
    this.bot = new TradingBot();
    this.setupMiddleware();
    this.setupRoutes();
  }

  // Настройка middleware
  setupMiddleware() {
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
          fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));
    this.app.use(cors());
    this.app.use(express.json());

    // Настройка MIME-типов для статических файлов
    const publicPath = path.join(__dirname, 'public');
    const express_static = express.static(publicPath, {
      setHeaders: (res, filePath, stat) => {
        if (filePath.endsWith('.js')) {
          res.set('Content-Type', 'application/javascript; charset=UTF-8');
        } else if (filePath.endsWith('.css')) {
          res.set('Content-Type', 'text/css; charset=UTF-8');
        } else if (filePath.endsWith('.html')) {
          res.set('Content-Type', 'text/html; charset=UTF-8');
        } else if (filePath.endsWith('.json')) {
          res.set('Content-Type', 'application/json; charset=UTF-8');
        }
      }
    });
    
    this.app.use(express_static);
  }

  // Настройка маршрутов
  setupRoutes() {
    // API маршруты должны быть первыми
    this.app.use('/api', this.createApiRoutes());
    this.app.use('/trader/api', this.createApiRoutes()); // Поддержка через /trader/
    
    // Явная настройка для статических файлов с правильными MIME-типами
    this.app.get('/app.js', (req, res) => {
      res.set('Content-Type', 'application/javascript; charset=UTF-8');
      res.sendFile(path.join(__dirname, 'public', 'app.js'));
    });

    this.app.get('*.js', (req, res, next) => {
      res.set('Content-Type', 'application/javascript; charset=UTF-8');
      next();
    });

    this.app.get('*.css', (req, res, next) => {
      res.set('Content-Type', 'text/css; charset=UTF-8');
      next();
    });
    
    // Главная страница
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
    
    this.app.get('/trader', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
    
    this.app.get('/trader/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
    
    // Fallback для всех остальных маршрутов (но не для статических файлов)
    this.app.get('*', (req, res, next) => {
      // Проверяем, не является ли это запросом к статическому файлу
      if (req.url.match(/\.(js|css|html|png|jpg|gif|ico)$/)) {
        return next(); // Пропускаем к обработчику статических файлов
      }
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  // Создание API маршрутов
  createApiRoutes() {
    const router = express.Router();

    // Управление ботом
    router.post('/bot/start', async (req, res) => {
      try {
        const result = await this.bot.start();
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    router.post('/bot/stop', (req, res) => {
      try {
        const result = this.bot.stop();
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    router.get('/bot/status', (req, res) => {
      try {
        const status = this.bot.getStatus();
        res.json({ success: true, data: status });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Анализ рынка
    router.get('/analysis/:symbol', (req, res) => {
      try {
        const { symbol } = req.params;
        const analysis = this.bot.getAnalysis(symbol);
        res.json({ success: true, data: analysis });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Управление позициями
    router.post('/positions/open', async (req, res) => {
      try {
        const { symbol, type, size } = req.body;
        const result = await this.bot.manualOpenPosition(symbol, type, size);
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    router.post('/positions/close', (req, res) => {
      try {
        const { symbol } = req.body;
        const result = this.bot.manualClosePosition(symbol);
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // История сделок
    router.get('/trades', (req, res) => {
      try {
        const { limit = 50 } = req.query;
        const history = this.bot.getTradeHistory(parseInt(limit));
        res.json({ success: true, data: history });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Демо-управление
    router.post('/demo/reset', (req, res) => {
      try {
        const result = this.bot.resetDemoBalance();
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Рыночные данные    router.get('/market/symbols', async (req, res) => {
      try {
        const symbols = this.bot.activeSymbols && this.bot.activeSymbols.length > 0
          ? this.bot.activeSymbols
          : config.symbols;
        // Сортируем по изменению цены за 24ч
        try {
          const tickers = await this.bot.api.getAllTickerPrices(symbols);
          if (tickers) {
            const sorted = symbols
              .map(s => ({ symbol: s, change24h: tickers[s]?.change24h || 0 }))
              .sort((a, b) => b.change24h - a.change24h)
              .map(s => s.symbol);
            return res.json({ success: true, data: sorted });
          }
        } catch (e) {
          // fallback
        }
        res.json({ success: true, data: symbols });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    router.get('/market/tickers', async (req, res) => {
      try {
        const symbols = this.bot.activeSymbols && this.bot.activeSymbols.length > 0
          ? this.bot.activeSymbols
          : config.symbols;
        const tickers = await this.bot.api.getAllTickerPrices(symbols);
        res.json({ success: true, data: tickers });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Статистика
    router.get('/statistics', (req, res) => {
      try {
        const status = this.bot.getStatus();
        res.json({ success: true, data: status.statistics });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    

    // Сигналы

    router.get('/signals', (req, res) => {

      try {

        const signals = this.bot.getSignals();

        res.json({ success: true, data: signals });

      } catch (error) {

        res.status(500).json({ success: false, error: error.message });

      }

    });


    return router;

    }


    // Запуск сервера

    start() {
    const port = config.server.port;
    
    this.app.listen(port, () => {
      console.log(`🌐 Веб-сервер запущен на порту ${port}`);
      console.log(`📊 Демо-режим: ${config.botMode === 'demo' ? 'Включен' : 'Выключен'}`);
      console.log(`💰 Начальный баланс: $${config.demo.balance}`);
      console.log(`📈 Символы для торговли: ${config.symbols.join(', ')}`);
      console.log(`🔗 Веб-интерфейс: http://localhost:${port}`);
    });
  }
}

module.exports = TradingBotServer; 