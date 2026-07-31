'use strict';

const assert = require('assert');
const HtfContext = require('../indicators/htfContextAnalyzer');
const HtfBiasV3 = require('../indicators/ictHtfBiasEngineV3');
const HtfStructurePhase = require(
  '../indicators/ictHtfStructurePhaseEngine'
);
const WatchlistReport = require(
  '../indicators/ictWatchlistAnalystReport'
);
const WatchlistLoader = require('../config/watchlistLoader');
const NotificationFilter = require(
  '../notifications/ictWatchlistNotificationFilter'
);
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
      '5m': fiveMinute,
    },
    responses: {
      '4h': fourHour.concat(unfinishedAfter(
        fourHour[fourHour.length - 1],
        HtfContext.FOUR_HOURS
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

test('watchlist structure phase is UNDETERMINED without events', () => {
  const data = fixture();
  const phase = WatchlistReport.analyzeStructurePhase(
    data.complete['4h'].slice(0, 4)
  );

  assert.strictEqual(
    phase.current.structurePhase,
    HtfStructurePhase.PHASES.UNDETERMINED
  );
});

test('getKline uses generic symbol interval and closed bars only', async () => {
  const data = fixture();
  const calls = [];
  const closed = await WatchlistAnalyst.getKline(
    'ETHUSDT',
    '5m',
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
    interval: '5m',
  }]);
  assert.strictEqual(
    closed.length,
    data.complete['5m'].length
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
      ['4h', '5m']
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
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      result.results[0].report.current,
      'fifteenMinuteAnalysis'
    ),
    false
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      result.results[0].report.current,
      'oneHourAnalysis'
    ),
    false
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      result.results[0].report.source,
      'm15Klines'
    ),
    false
  );
  assert.strictEqual(
    result.results[0].formatted.includes('15分钟'),
    false
  );
  assert.ok(result.results[0].formatted.includes(
    '2. 【5分钟确认】'
  ));
  assert.ok(
    result.results[0].report.current.positionContext
  );
  assert.ok(Object.prototype.hasOwnProperty.call(
    result.results[0].report.current.positionContext,
    'positionZone'
  ));
  assert.ok(Object.prototype.hasOwnProperty.call(
    result.results[0].report.current.positionContext,
    'nearestLiquidity'
  ));
  assert.ok(result.results[0].formatted.includes(
    '【当前位置】'
  ));
  assert.strictEqual(
    result.results[0].report.current.positionContext
      .context.includes('不适合追单'),
    false
  );
  for (const heading of [
    '【当前市场环境】',
    '【交易机会观察】',
    '【已完成事件】',
    '【下一步等待路径】',
    '【等待原因】',
  ]) {
    assert.ok(
      result.results[0].report.current.humanSummary
        .includes(heading)
    );
    assert.ok(
      result.results[0].formatted.includes(heading)
    );
  }
  assert.strictEqual(
    typeof result.results[0].report.current.setupStage,
    'string'
  );
  assert.ok(Array.isArray(
    result.results[0].report.current.missingConditions
  ));
  assert.ok([
    'CONFIRMED_BULLISH',
    'CONFIRMED_BEARISH',
    'WAITING',
  ].includes(
    result.results[0].report.current
      .fiveMinuteConfirmationStatus
  ));
  assert.strictEqual(
    typeof result.results[0].report.current.nextScenario,
    'string'
  );
  assert.ok(
    result.results[0].report.current.opportunity
  );
  assert.ok([
    'WAITING',
    'WATCH_ZONE',
  ].includes(
    result.results[0].report.current.opportunity.status
  ));

  const report = result.results[0].report;
  const structurePhase = report.current.structurePhase;
  assert.ok(structurePhase);
  assert.ok(Object.values(
    HtfStructurePhase.PHASES
  ).includes(structurePhase.state));
  assert.strictEqual(
    structurePhase.state,
    structurePhase.structurePhase
  );
  assert.ok(report.current.humanSummary.includes(
    '【4小时结构阶段】'
  ));
  assert.ok(result.results[0].formatted.includes(
    '【4小时结构阶段】'
  ));

  const directBias = HtfBiasV3.analyze({
    h4Klines: data.complete['4h'],
  });
  assert.strictEqual(
    report.current.fourHourAnalysis.bias,
    directBias.states[
      directBias.states.length - 1
    ].narrative.bias
  );

  const withoutStructurePhase = JSON.parse(
    JSON.stringify(report)
  );
  delete withoutStructurePhase.current.structurePhase;
  assert.deepStrictEqual(
    NotificationFilter.extractSymbolState(report),
    NotificationFilter.extractSymbolState(
      withoutStructurePhase
    )
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
