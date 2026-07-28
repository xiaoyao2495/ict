'use strict';

const assert = require('assert');
const HtfContext = require('../indicators/htfContextAnalyzer');
const WatchlistLoader = require('../config/watchlistLoader');
const WatchlistAnalyst = require(
  '../scripts/runWatchlistAnalyst'
);

const FIVE_MINUTES = 5 * 60 * 1000;
const START = Date.UTC(2026, 0, 1);
const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function createFiveMinuteBars(length) {
  return Array.from({ length }, (_, index) => {
    const center =
      90000 +
      Math.sin(index / 75) * 2200 +
      Math.sin(index / 15) * 350;
    const open = center + (index % 4 === 0 ? 60 : -50);
    const close = center + (index % 4 === 0 ? -50 : 60);
    return {
      openTime: START + index * FIVE_MINUTES,
      closeTime: START + (index + 1) * FIVE_MINUTES - 1,
      open,
      high: Math.max(open, close) + 80,
      low: Math.min(open, close) - 80,
      close,
      volume: 1,
    };
  });
}

function unfinishedAfter(last, duration) {
  return {
    openTime: last.openTime + duration,
    closeTime: last.closeTime + duration,
    open: last.close,
    high: last.close + 100,
    low: last.close - 100,
    close: last.close + 10,
    volume: 1,
  };
}

function fixture() {
  const fiveMinute = createFiveMinuteBars(2400);
  const oneHour = HtfContext.aggregateClosedKlines(
    fiveMinute,
    HtfContext.ONE_HOUR
  );
  const fourHour = HtfContext.aggregateClosedKlines(
    fiveMinute,
    HtfContext.FOUR_HOURS
  );
  const currentTime =
    fiveMinute[fiveMinute.length - 1].closeTime + 1;
  return {
    currentTime,
    complete: {
      '4h': fourHour,
      '1h': oneHour,
      '5m': fiveMinute,
    },
    responses: {
      '4h': fourHour.concat(unfinishedAfter(
        fourHour[fourHour.length - 1],
        HtfContext.FOUR_HOURS
      )),
      '1h': oneHour.concat(unfinishedAfter(
        oneHour[oneHour.length - 1],
        HtfContext.ONE_HOUR
      )),
      '5m': fiveMinute.concat(unfinishedAfter(
        fiveMinute[fiveMinute.length - 1],
        FIVE_MINUTES
      )),
    },
  };
}

test('default watchlist is readable by the shared loader', () => {
  const watchlist = WatchlistLoader.loadWatchlist();
  assert.ok(watchlist.symbols.includes('BTCUSDT'));
});

test('getKline uses generic symbol interval and closed bars only', async () => {
  const data = fixture();
  const calls = [];
  const closed = await WatchlistAnalyst.getKline(
    'ETHUSDT',
    '1h',
    {
      currentTime: data.currentTime,
      marketData: {
        async getKline(symbol, interval) {
          calls.push({ symbol, interval });
          return data.responses[interval];
        },
      },
    }
  );

  assert.deepStrictEqual(calls, [{
    symbol: 'ETHUSDT',
    interval: '1h',
  }]);
  assert.strictEqual(
    closed.length,
    data.complete['1h'].length
  );
  assert.ok(closed.every(
    (kline) => kline.closeTime < data.currentTime
  ));
});

test('multiple symbols remain isolated and produce Chinese output', async () => {
  const data = fixture();
  const symbols = [
    'BTCUSDT',
    'ETHUSDT',
    'SKHYUSDT',
    'NOTEXISTUSDT',
  ];
  const marketCalls = [];
  const output = [];
  let watchlistLoads = 0;
  let tradeCalls = 0;
  const result = await WatchlistAnalyst.run({
    currentTime: data.currentTime,
    watchlistLoader: {
      loadWatchlist() {
        watchlistLoads += 1;
        return { symbols };
      },
    },
    symbolAvailabilityChecker: {
      async checkSymbols(inputSymbols) {
        assert.deepStrictEqual(inputSymbols, symbols);
        return {
          validSymbols: [
            'BTCUSDT',
            'ETHUSDT',
            'SKHYUSDT',
          ],
          invalidSymbols: ['NOTEXISTUSDT'],
          checkFailed: false,
          error: null,
        };
      },
    },
    marketData: {
      async getKline(symbol, interval) {
        marketCalls.push({ symbol, interval });
        if (symbol === 'SKHYUSDT') {
          throw new Error('symbol unavailable');
        }
        return data.responses[interval];
      },
      async placeOrder() {
        tradeCalls += 1;
        throw new Error('trade interface must not be called');
      },
    },
    output(message) {
      output.push(message);
    },
  });

  assert.strictEqual(watchlistLoads, 1);
  assert.deepStrictEqual(result.symbols, symbols);
  assert.deepStrictEqual(
    result.availability.invalidSymbols,
    ['NOTEXISTUSDT']
  );
  assert.strictEqual(result.results.length, 3);
  assert.deepStrictEqual(
    result.results.map((item) => item.status),
    ['SUCCESS', 'SUCCESS', 'FAILED']
  );
  assert.strictEqual(result.results[2].stage, 'DATA');
  assert.strictEqual(tradeCalls, 0);
  assert.strictEqual(output.length, 1);
  assert.strictEqual(output[0], result.message);

  for (const symbol of [
    'BTCUSDT',
    'ETHUSDT',
    'SKHYUSDT',
  ]) {
    assert.ok(marketCalls.some(
      (call) => call.symbol === symbol
    ));
    assert.ok(result.message.includes(
      '===== ' + symbol + ' ====='
    ));
  }
  assert.strictEqual(
    marketCalls.some(
      (call) => call.symbol === 'NOTEXISTUSDT'
    ),
    false
  );
  for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
    assert.deepStrictEqual(
      marketCalls
        .filter((call) => call.symbol === symbol)
        .map((call) => call.interval)
        .sort(),
      ['1h', '4h', '5m']
    );
  }

  assert.ok(result.message.startsWith(
    '检测---ICT Watchlist'
  ));
  assert.ok(result.message.includes('检测'));
  assert.ok(result.message.includes(
    '时间：2026-01-09 16:00:00'
  ));
  assert.strictEqual(
    (result.message.match(/【ICT市场分析】/g) || []).length,
    2
  );
  assert.ok(result.message.includes(
    '===== SKHYUSDT =====\n\n数据获取失败'
  ));
  assert.ok(result.message.includes('有效交易对：'));
  assert.ok(result.message.includes(
    'NOTEXISTUSDT（Binance不存在）'
  ));
  assert.strictEqual(
    result.results[0].report.symbol,
    'BTCUSDT'
  );
  assert.strictEqual(
    result.results[1].report.symbol,
    'ETHUSDT'
  );
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
