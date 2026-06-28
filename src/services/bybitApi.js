const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/config');

class BybitAPI {
  constructor() {
    this.baseUrl = config.bybit.baseUrl;
    this.apiKey = config.bybit.apiKey;
    this.secretKey = config.bybit.secretKey;
    this.recvWindow = '20000';
    this.serverTimeOffset = 0;
    this.lastTimeCheck = 0;
  }

  // ----- Получение времени сервера (кеширование на 10 секунд) -----
  async getServerTime() {
    const now = Date.now();
    if (this.lastTimeCheck && (now - this.lastTimeCheck) < 10000) {
      return now + this.serverTimeOffset;
    }
    try {
      const response = await axios.get(`${this.baseUrl}/v5/market/time`);
      if (response.data.retCode === 0) {
        const serverTime = parseInt(response.data.result.timeSecond) * 1000;
        this.serverTimeOffset = serverTime - Date.now();
        this.lastTimeCheck = Date.now();
        return serverTime;
      }
      return Date.now();
    } catch (error) {
      console.warn('⚠️ Не удалось получить время сервера, используем локальное');
      return Date.now();
    }
  }

  // ----- Генерация подписи (универсальная) -----
  async generateSignature(params, isPost = false) {
    const timestamp = await this.getServerTime();
    let signString = timestamp + this.apiKey + this.recvWindow;

    if (isPost) {
      const sortedKeys = Object.keys(params).sort();
      const jsonObj = {};
      sortedKeys.forEach(key => { jsonObj[key] = params[key]; });
      const jsonString = JSON.stringify(jsonObj);
      signString += jsonString;
    } else {
      const sortedKeys = Object.keys(params).sort();
      const queryString = sortedKeys.map(key => `${key}=${params[key]}`).join('&');
      signString += queryString;
    }

    const signature = crypto.createHmac('sha256', this.secretKey).update(signString).digest('hex');
    return { timestamp: timestamp.toString(), signature };
  }

  // ----- Публичные методы (без подписи) -----

  async getKlineData(symbol, interval = '15', limit = 200) {
    try {
      const response = await axios.get(`${this.baseUrl}/v5/market/kline`, {
        params: {
          category: 'linear',
          symbol: symbol,
          interval: interval,
          limit: limit
        }
      });
      if (response.data.retCode === 0) {
        return response.data.result.list.map(candle => ({
          timestamp: parseInt(candle[0]),
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[5])
        }));
      } else {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }
    } catch (error) {
      console.error('Ошибка получения данных свечей:', error.message);
      throw error;
    }
  }

  async getTickerPrice(symbol) {
    try {
      const response = await axios.get(`${this.baseUrl}/v5/market/tickers`, {
        params: {
          category: 'linear',
          symbol: symbol
        }
      });
      if (response.data.retCode === 0 && response.data.result.list.length > 0) {
        const ticker = response.data.result.list[0];
        return {
          symbol: ticker.symbol,
          price: parseFloat(ticker.lastPrice),
          volume24h: parseFloat(ticker.volume24h),
          change24h: parseFloat(ticker.price24hPcnt)
        };
      } else {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }
    } catch (error) {
      console.error('Ошибка получения текущей цены:', error.message);
      throw error;
    }
  }

  // ----- Получение информации об инструменте (лота, точности цены) -----
  async getInstrumentInfo(symbol) {
    try {
      const response = await axios.get(`${this.baseUrl}/v5/market/instruments-info`, {
        params: {
          category: 'linear',
          symbol: symbol
        }
      });
      if (response.data.retCode === 0 && response.data.result.list.length > 0) {
        const info = response.data.result.list[0];
        return {
          symbol: info.symbol,
          priceFilter: info.priceFilter,
          lotSizeFilter: info.lotSizeFilter,
          minOrderQty: parseFloat(info.lotSizeFilter?.minOrderQty || '0.001'),
          maxOrderQty: parseFloat(info.lotSizeFilter?.maxOrderQty || '1000000'),
          qtyStep: parseFloat(info.lotSizeFilter?.qtyStep || '0.001'),
          tickSize: parseFloat(info.priceFilter?.tickSize || '0.0001')
        };
      } else {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }
    } catch (error) {
      console.error(`❌ Ошибка получения информации об инструменте ${symbol}:`, error.message);
      throw error;
    }
  }

  // ----- Форматирование qty с учётом шага лота -----
  formatQty(qty, step) {
    if (!step || step <= 0) return qty.toString();
    const decimals = step.toString().includes('.')
      ? step.toString().split('.')[1].length
      : 0;
    const formatted = Math.floor(parseFloat(qty) / step) * step;
    return formatted.toFixed(decimals);
  }


  // ----- Отправка ордера с форматированием qty и подробным логированием -----
  async placeOrder(params) {
    try {
      // Форматируем qty с учётом шага лота инструмента
      let qtyStr;
      try {
        const instrumentInfo = await this.getInstrumentInfo(params.symbol);
        qtyStr = this.formatQty(params.qty, instrumentInfo.qtyStep);
      } catch (err) {
        console.warn(`⚠️ Не удалось получить информацию об инструменте ${params.symbol}, используем qty как есть`);
        qtyStr = params.qty.toString();
      }

      const orderParams = {
        category: 'linear',
        symbol: params.symbol,
        side: params.side,
        orderType: params.orderType || 'Market',
        qty: qtyStr,
        timeInForce: params.timeInForce || 'GTC',
        ...(params.price && { price: params.price.toString() }),
        ...(params.takeProfit && { takeProfit: params.takeProfit.toString() }),
        ...(params.stopLoss && { stopLoss: params.stopLoss.toString() }),
        ...(params.positionIdx !== undefined && { positionIdx: params.positionIdx })
      };

      const sortedKeys = Object.keys(orderParams).sort();
      const sortedObj = {};
      sortedKeys.forEach(key => { sortedObj[key] = orderParams[key]; });
      const jsonString = JSON.stringify(sortedObj);

      const timestamp = await this.getServerTime();
      const signString = timestamp + this.apiKey + this.recvWindow + jsonString;
      const signature = crypto.createHmac('sha256', this.secretKey).update(signString).digest('hex');
      const timestampStr = timestamp.toString();

      const url = `${this.baseUrl}/v5/order/create`;
      const headers = {
        'X-BAPI-API-KEY': this.apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-SIGN-TYPE': '2',
        'X-BAPI-TIMESTAMP': timestampStr,
        'X-BAPI-RECV-WINDOW': this.recvWindow,
        'Content-Type': 'application/json'
      };

      // Логируем детали запроса (без секретов)
      console.log('📤 URL:', url);
      console.log('📤 Тело запроса:', jsonString);
      console.log('📤 Заголовки (скрыт ключ):', { ...headers, 'X-BAPI-API-KEY': '***' });

      const response = await axios.post(url, jsonString, { headers });

      if (response.data.retCode === 0) {
        console.log(`✅ Ордер отправлен: ${params.side} ${params.symbol}`, response.data.result);
        return response.data.result;
      } else {
        console.error(`❌ Ошибка API Bybit при размещении ордера:`);
        console.error(`   Код: ${response.data.retCode}`);
        console.error(`   Сообщение: ${response.data.retMsg}`);
        console.error(`   Полный ответ:`, JSON.stringify(response.data, null, 2));
        throw new Error(`Bybit API Error: ${response.data.retMsg} (код ${response.data.retCode})`);
      }
    } catch (error) {
      console.error(`❌ Ошибка размещения ордера ${params.symbol}:`);
      if (error.response) {
        console.error(`   Статус: ${error.response.status}`);
        console.error(`   Данные ответа:`, JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        console.error(`   Запрос отправлен, но ответ не получен:`, error.request);
      } else {
        console.error(`   Сообщение:`, error.message);
      }
      return null;
    }
  }


  // ========== RETRY LOGIC для устойчивости к сбоям интернета ==========
  async _requestWithRetry(fn, retries = 3, delay = 2000) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const isNetworkError = !error.response ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENETUNREACH' ||
          error.code === 'ECONNABORTED' ||
          (error.message && (
            error.message.includes('timeout') ||
            error.message.includes('network') ||
            error.message.includes('Rate Limit') ||
            error.message.includes('socket')
          ));

        if (!isNetworkError || attempt === retries) {
          throw error;
        }

        const wait = delay * Math.pow(1.5, attempt - 1);
        console.log('🔄 Сетевая ошибка, попытка ' + attempt + '/' + retries + ' через ' + wait + 'ms: ' + (error.message || error));
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    }
    throw lastError;
  }

  // ----- Методы для динамического обновления символов (публичные) -----

  async getActiveLinearSymbols() {
    try {
      const response = await axios.get(`${this.baseUrl}/v5/market/instruments-info`, {
        params: {
          category: 'linear',
          limit: 1000
        }
      });
      if (response.data.retCode === 0) {
        const symbols = response.data.result.list
          .filter(item =>
            item.symbol.endsWith('USDT') &&
            item.status === 'Trading' &&
            !item.symbol.includes('USDC')
          )
          .map(item => item.symbol);
        return symbols;
      } else {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }
    } catch (error) {
      console.error('Ошибка получения списка символов:', error.message);
      return null;
    }
  }

  async getAllTickerPrices(symbols) {
    try {
      const response = await axios.get(`${this.baseUrl}/v5/market/tickers`, {
        params: {
          category: 'linear'
        }
      });
      if (response.data.retCode === 0) {
        const priceMap = {};
        response.data.result.list.forEach(item => {
          if (symbols.includes(item.symbol)) {
            priceMap[item.symbol] = {
              symbol: item.symbol,
              price: parseFloat(item.lastPrice),
              change24h: parseFloat(item.price24hPcnt) || 0,
              volume24h: parseFloat(item.volume24h) || 0,
              turnover24h: parseFloat(item.turnover24h) || 0
            };
          }
        });
        return priceMap;
      } else {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }
    } catch (error) {
      console.error('Ошибка получения всех тикеров:', error.message);
      return null;
    }
  }

  async getTickersVolume(symbols) {
    try {
      const response = await axios.get(`${this.baseUrl}/v5/market/tickers`, {
        params: {
          category: 'linear'
        }
      });
      if (response.data.retCode === 0) {
        const volumeMap = {};
        response.data.result.list.forEach(item => {
          if (symbols.includes(item.symbol)) {
            volumeMap[item.symbol] = parseFloat(item.turnover24h) || 0;
          }
        });
        return volumeMap;
      } else {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }
    } catch (error) {
      console.error('Ошибка получения объёмов:', error.message);
      return null;
    }
  }
}

module.exports = BybitAPI;
