'use strict';

var fs = require('fs');
var path = require('path');
var axios = require('axios');

var SOURCE = 'BINANCE_FUTURES_TOP_VOLUME';
var DEFAULT_LIMIT = 20;
var DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
var BASE_URL = 'https://fapi.binance.com';
var EXCHANGE_INFO_PATH = '/fapi/v1/exchangeInfo';
var TICKER_24H_PATH = '/fapi/v1/ticker/24hr';
var DEFAULT_CACHE_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'binance-usdt-watchlist.json'
);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function validLimit(value) {
  return typeof value === 'number' &&
    isFinite(value) &&
    Math.floor(value) === value &&
    value > 0
    ? value
    : DEFAULT_LIMIT;
}

function normalizeTime(value) {
  var timestamp;
  if (value === undefined || value === null) return Date.now();
  if (value instanceof Date) timestamp = value.getTime();
  else if (typeof value === 'string') timestamp = Date.parse(value);
  else timestamp = value;
  if (typeof timestamp !== 'number' || !isFinite(timestamp)) {
    throw new Error('A valid Watchlist update time is required.');
  }
  return timestamp;
}

function tradableSymbols(exchangeInfo) {
  if (
    !exchangeInfo ||
    !Array.isArray(exchangeInfo.symbols)
  ) {
    throw new Error(
      'Binance Futures exchangeInfo has no symbols array.'
    );
  }
  return exchangeInfo.symbols.filter(function (item) {
    return Boolean(
      item &&
      typeof item.symbol === 'string' &&
      item.contractType === 'PERPETUAL' &&
      item.quoteAsset === 'USDT' &&
      item.status === 'TRADING' &&
      !item.symbol.endsWith('USDC')
    );
  }).map(function (item) {
    return item.symbol;
  });
}

function rankedSymbols(exchangeInfo, tickers, limit) {
  var tradable = {};
  var volumes = {};
  tradableSymbols(exchangeInfo).forEach(function (symbol) {
    tradable[symbol] = true;
  });
  if (!Array.isArray(tickers)) {
    throw new Error(
      'Binance Futures 24h ticker response must be an array.'
    );
  }
  tickers.forEach(function (ticker) {
    var volume;
    if (
      !ticker ||
      typeof ticker.symbol !== 'string' ||
      !tradable[ticker.symbol]
    ) {
      return;
    }
    volume = Number(ticker.quoteVolume);
    if (!isFinite(volume) || volume < 0) return;
    if (
      volumes[ticker.symbol] === undefined ||
      volume > volumes[ticker.symbol]
    ) {
      volumes[ticker.symbol] = volume;
    }
  });
  return Object.keys(volumes).sort(function (left, right) {
    return volumes[right] - volumes[left] ||
      left.localeCompare(right);
  }).slice(0, validLimit(limit));
}

function buildWatchlist(exchangeInfo, tickers, options) {
  options = options || {};
  var symbols = rankedSymbols(
    exchangeInfo,
    tickers,
    options.limit
  );
  var updatedAt = new Date(
    normalizeTime(options.currentTime)
  ).toISOString();
  if (symbols.length === 0) {
    throw new Error(
      'No tradable Binance USDT perpetual symbols have volume data.'
    );
  }
  return {
    symbols: symbols,
    updatedAt: updatedAt,
    source: SOURCE,
  };
}

function responseData(response) {
  return response &&
    Object.prototype.hasOwnProperty.call(response, 'data')
    ? response.data
    : response;
}

function fetchRemote(options) {
  options = options || {};
  var api = options.binanceApi;
  var httpClient = options.httpClient || axios;
  var exchangeInfoPromise;
  var tickerPromise;
  if (
    api &&
    typeof api.getExchangeInfo === 'function' &&
    typeof api.get24hTickers === 'function'
  ) {
    exchangeInfoPromise = api.getExchangeInfo();
    tickerPromise = api.get24hTickers();
  } else {
    if (!httpClient || typeof httpClient.get !== 'function') {
      return Promise.reject(new Error(
        'An axios-compatible Binance HTTP client is required.'
      ));
    }
    exchangeInfoPromise = httpClient.get(
      BASE_URL + EXCHANGE_INFO_PATH
    ).then(responseData);
    tickerPromise = httpClient.get(
      BASE_URL + TICKER_24H_PATH
    ).then(responseData);
  }
  return Promise.all([
    exchangeInfoPromise,
    tickerPromise,
  ]).then(function (values) {
    return buildWatchlist(values[0], values[1], options);
  });
}

function normalizeCached(value) {
  if (
    !value ||
    value.source !== SOURCE ||
    typeof value.updatedAt !== 'string' ||
    !Array.isArray(value.symbols) ||
    value.symbols.length === 0 ||
    value.symbols.some(function (symbol) {
      return typeof symbol !== 'string' || !symbol;
    })
  ) {
    return null;
  }
  return {
    symbols: value.symbols.slice(),
    updatedAt: value.updatedAt,
    source: SOURCE,
  };
}

function createFileCache(filePath) {
  var resolvedPath = path.resolve(
    filePath || DEFAULT_CACHE_PATH
  );
  return {
    filePath: resolvedPath,
    load: function () {
      return new Promise(function (resolve, reject) {
        fs.readFile(resolvedPath, 'utf8', function (error, body) {
          if (error && error.code === 'ENOENT') {
            resolve(null);
            return;
          }
          if (error) {
            reject(error);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (parseError) {
            reject(parseError);
          }
        });
      });
    },
    save: function (value) {
      return new Promise(function (resolve, reject) {
        fs.mkdir(
          path.dirname(resolvedPath),
          { recursive: true },
          function (directoryError) {
            if (directoryError) {
              reject(directoryError);
              return;
            }
            fs.writeFile(
              resolvedPath,
              JSON.stringify(value, null, 2) + '\n',
              'utf8',
              function (writeError) {
                if (writeError) reject(writeError);
                else resolve();
              }
            );
          }
        );
      });
    },
  };
}

function createMemoryCache(initialValue) {
  var value = initialValue === undefined
    ? null
    : clone(initialValue);
  return {
    load: function () {
      return Promise.resolve(clone(value));
    },
    save: function (nextValue) {
      value = clone(nextValue);
      return Promise.resolve();
    },
  };
}

function cacheIsFresh(value, currentTime, ttlMs) {
  var cached = normalizeCached(value);
  var updatedAt;
  var age;
  if (!cached) return false;
  updatedAt = Date.parse(cached.updatedAt);
  if (!isFinite(updatedAt)) return false;
  age = currentTime - updatedAt;
  return age >= 0 && age <= ttlMs;
}

function load(options) {
  options = options || {};
  var currentTime = normalizeTime(options.currentTime);
  var ttlMs = typeof options.cacheTtlMs === 'number' &&
    isFinite(options.cacheTtlMs) &&
    options.cacheTtlMs >= 0
    ? options.cacheTtlMs
    : DEFAULT_CACHE_TTL_MS;
  var cache = options.cache || createFileCache(
    options.cachePath
  );
  var cachedValue;
  return Promise.resolve(cache.load()).catch(function () {
    return null;
  }).then(function (cached) {
    cachedValue = normalizeCached(cached);
    if (
      options.forceRefresh !== true &&
      cacheIsFresh(cachedValue, currentTime, ttlMs)
    ) {
      return clone(cachedValue);
    }
    return fetchRemote({
      binanceApi: options.binanceApi,
      httpClient: options.httpClient,
      currentTime: currentTime,
      limit: options.limit,
    }).then(function (watchlist) {
      return Promise.resolve(cache.save(watchlist)).then(function () {
        return clone(watchlist);
      });
    }).catch(function (error) {
      if (cachedValue) return clone(cachedValue);
      throw error;
    });
  });
}

module.exports = {
  BASE_URL: BASE_URL,
  DEFAULT_CACHE_PATH: DEFAULT_CACHE_PATH,
  DEFAULT_CACHE_TTL_MS: DEFAULT_CACHE_TTL_MS,
  DEFAULT_LIMIT: DEFAULT_LIMIT,
  EXCHANGE_INFO_PATH: EXCHANGE_INFO_PATH,
  SOURCE: SOURCE,
  TICKER_24H_PATH: TICKER_24H_PATH,
  buildWatchlist: buildWatchlist,
  cacheIsFresh: cacheIsFresh,
  createFileCache: createFileCache,
  createMemoryCache: createMemoryCache,
  fetchRemote: fetchRemote,
  load: load,
  normalizeCached: normalizeCached,
  rankedSymbols: rankedSymbols,
  tradableSymbols: tradableSymbols,
};
