'use strict';

const assert = require('assert');
const Watchlist = require(
  '../indicators/binanceFuturesTopVolumeWatchlist'
);

const NOW = Date.UTC(2026, 7, 1, 15, 40, 0);
const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function contract(symbol, options) {
  options = options || {};
  return {
    symbol,
    contractType: options.contractType || 'PERPETUAL',
    quoteAsset: options.quoteAsset || 'USDT',
    status: options.status || 'TRADING',
  };
}

function ticker(symbol, quoteVolume) {
  return { symbol, quoteVolume: String(quoteVolume) };
}

test('USDC symbols are excluded explicitly', () => {
  const symbols = Watchlist.tradableSymbols({
    symbols: [
      contract('BTCUSDT'),
      contract('BTCUSDC'),
    ],
  });
  assert.deepStrictEqual(symbols, ['BTCUSDT']);
});

test('non perpetual contracts are excluded', () => {
  const symbols = Watchlist.tradableSymbols({
    symbols: [
      contract('BTCUSDT'),
      contract('ETHUSDT', { contractType: 'CURRENT_QUARTER' }),
    ],
  });
  assert.deepStrictEqual(symbols, ['BTCUSDT']);
});

test('non trading and non USDT contracts are excluded', () => {
  const symbols = Watchlist.tradableSymbols({
    symbols: [
      contract('BTCUSDT'),
      contract('HALTEDUSDT', { status: 'SETTLING' }),
      contract('BTCUSD', { quoteAsset: 'USD' }),
    ],
  });
  assert.deepStrictEqual(symbols, ['BTCUSDT']);
});

test('TradFi contracts participate without baseAsset classification', () => {
  const exchangeInfo = {
    symbols: [
      { ...contract('BTCUSDT'), baseAsset: 'BTC' },
      { ...contract('MUUSDT'), baseAsset: 'MU' },
      { ...contract('SNDKUSDT'), baseAsset: 'SNDK' },
      { ...contract('NVDAUSDT'), baseAsset: 'NVDA' },
    ],
  };
  assert.deepStrictEqual(
    Watchlist.rankedSymbols(exchangeInfo, [
      ticker('BTCUSDT', 1000),
      ticker('MUUSDT', 4000),
      ticker('SNDKUSDT', 3000),
      ticker('NVDAUSDT', 2000),
    ], 20),
    ['MUUSDT', 'SNDKUSDT', 'NVDAUSDT', 'BTCUSDT']
  );
});

test('Crypto and TradFi use one quoteVolume ranking pool', () => {
  const exchangeInfo = {
    symbols: [
      contract('BTCUSDT'),
      contract('ETHUSDT'),
      contract('MUUSDT'),
      contract('SNDKUSDT'),
    ],
  };
  const result = Watchlist.buildWatchlist(exchangeInfo, [
    ticker('BTCUSDT', 5000),
    ticker('MUUSDT', 7000),
    ticker('ETHUSDT', 6000),
    ticker('SNDKUSDT', 8000),
  ], { currentTime: NOW });
  assert.deepStrictEqual(result.symbols, [
    'SNDKUSDT',
    'MUUSDT',
    'ETHUSDT',
    'BTCUSDT',
  ]);
  assert.deepStrictEqual(result.ranking, [
    { symbol: 'SNDKUSDT', quoteVolume: '8000' },
    { symbol: 'MUUSDT', quoteVolume: '7000' },
    { symbol: 'ETHUSDT', quoteVolume: '6000' },
    { symbol: 'BTCUSDT', quoteVolume: '5000' },
  ]);
});

test('quote volume sorts descending with deterministic ties', () => {
  const exchangeInfo = {
    symbols: [
      contract('BTCUSDT'),
      contract('ETHUSDT'),
      contract('SOLUSDT'),
    ],
  };
  const btcTicker = ticker('BTCUSDT', 1000);
  btcTicker.volume = '999999999999';
  btcTicker.lastPrice = '999999';
  const symbols = Watchlist.rankedSymbols(exchangeInfo, [
    btcTicker,
    ticker('SOLUSDT', 2000),
    ticker('ETHUSDT', 2000),
  ], 20);
  assert.deepStrictEqual(symbols, [
    'ETHUSDT',
    'SOLUSDT',
    'BTCUSDT',
  ]);
});

test('default output keeps only the Top 20 symbols', () => {
  const contracts = [];
  const tickers = [];
  for (let index = 1; index <= 25; index += 1) {
    const symbol = 'COIN' + String(index).padStart(2, '0') + 'USDT';
    contracts.push(contract(symbol));
    tickers.push(ticker(symbol, index * 100));
  }
  const result = Watchlist.buildWatchlist(
    { symbols: contracts },
    tickers,
    { currentTime: NOW }
  );
  assert.strictEqual(result.symbols.length, 20);
  assert.strictEqual(result.symbols[0], 'COIN25USDT');
  assert.strictEqual(result.symbols[19], 'COIN06USDT');
  assert.strictEqual(result.ranking.length, 20);
  assert.deepStrictEqual(result.ranking[0], {
    symbol: 'COIN25USDT',
    quoteVolume: '2500',
  });
  assert.strictEqual(
    result.source,
    'BINANCE_FUTURES_TOP_VOLUME'
  );
  assert.strictEqual(
    result.updatedAt,
    '2026-08-01T15:40:00.000Z'
  );
});

test('ranking never mutates Binance API inputs', () => {
  const exchangeInfo = {
    symbols: [contract('BTCUSDT'), contract('ETHUSDT')],
  };
  const tickers = [
    ticker('BTCUSDT', 1000),
    ticker('ETHUSDT', 2000),
  ];
  const beforeExchange = JSON.stringify(exchangeInfo);
  const beforeTickers = JSON.stringify(tickers);
  Watchlist.buildWatchlist(exchangeInfo, tickers, {
    currentTime: NOW,
  });
  assert.strictEqual(JSON.stringify(exchangeInfo), beforeExchange);
  assert.strictEqual(JSON.stringify(tickers), beforeTickers);
});

test('remote loader calls both Binance Futures endpoints', async () => {
  const urls = [];
  const result = await Watchlist.fetchRemote({
    currentTime: NOW,
    httpClient: {
      async get(url) {
        urls.push(url);
        if (url.endsWith('/fapi/v1/exchangeInfo')) {
          return { data: { symbols: [contract('BTCUSDT')] } };
        }
        return { data: [ticker('BTCUSDT', 1000)] };
      },
    },
  });
  assert.deepStrictEqual(urls.sort(), [
    'https://fapi.binance.com/fapi/v1/exchangeInfo',
    'https://fapi.binance.com/fapi/v1/ticker/24hr',
  ].sort());
  assert.deepStrictEqual(result.symbols, ['BTCUSDT']);
});

test('fresh six hour cache avoids repeated Binance requests', async () => {
  const cached = {
    symbols: ['BTCUSDT', 'ETHUSDT'],
    updatedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    source: Watchlist.SOURCE,
  };
  let requests = 0;
  const result = await Watchlist.load({
    currentTime: NOW,
    cache: Watchlist.createMemoryCache(cached),
    httpClient: {
      async get() {
        requests += 1;
        throw new Error('must not request while cache is fresh');
      },
    },
  });
  assert.deepStrictEqual(result, cached);
  assert.notStrictEqual(result.symbols, cached.symbols);
  assert.strictEqual(requests, 0);
});

test('fresh cache preserves optional ranking data', async () => {
  const cached = {
    symbols: ['SNDKUSDT', 'MUUSDT'],
    updatedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    source: Watchlist.SOURCE,
    ranking: [
      { symbol: 'SNDKUSDT', quoteVolume: '8000' },
      { symbol: 'MUUSDT', quoteVolume: '7000' },
    ],
  };
  const result = await Watchlist.load({
    currentTime: NOW,
    cache: Watchlist.createMemoryCache(cached),
    httpClient: {
      async get() {
        throw new Error('must not request while cache is fresh');
      },
    },
  });
  assert.deepStrictEqual(result, cached);
  assert.notStrictEqual(result.ranking, cached.ranking);
});

(async () => {
  for (const item of tests) {
    try {
      await item.callback();
      testsPassed += 1;
      console.log('PASS:', item.name);
    } catch (error) {
      console.error('FAIL:', item.name);
      throw error;
    }
  }
  console.log('\n' + testsPassed + ' tests passed.');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
