'use strict';

const assert = require('assert');
const HtfContext = require('../indicators/htfContextAnalyzer');
const HtfBiasV3 = require('../indicators/ictHtfBiasEngineV3');
const DecisionGate = require('../indicators/ictDecisionGate');
const HumanSummary = require(
  '../formatters/ictAnalystHumanSummary'
);
const ChineseFormatter = require(
  '../formatters/ictAnalystChineseFormatter'
);
const WatchlistReport = require(
  '../indicators/ictWatchlistAnalystReport'
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
    const center = 90000 +
      Math.sin(index / 83) * 2400 +
      Math.sin(index / 17) * 420;
    const bullish = index % 5 !== 0;
    const open = center + (bullish ? -45 : 45);
    const close = center + (bullish ? 55 : -55);
    return {
      openTime: START + index * FIVE_MINUTES,
      closeTime: START + (index + 1) * FIVE_MINUTES - 1,
      open,
      high: Math.max(open, close) + 75,
      low: Math.min(open, close) - 75,
      close,
      volume: 1,
    };
  });
}

function fixture() {
  const allFiveMinuteBars = createFiveMinuteBars(2880);
  const ltf5mKlines = allFiveMinuteBars.slice(0, 2400);
  return {
    symbol: 'BTCUSDT',
    ltf5mKlines,
    h4Klines: HtfContext.aggregateClosedKlines(
      ltf5mKlines,
      HtfContext.FOUR_HOURS
    ),
    futureH4Klines: HtfContext.aggregateClosedKlines(
      allFiveMinuteBars,
      HtfContext.FOUR_HOURS
    ),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutGate(current) {
  const value = clone(current);
  delete value.decisionGate;
  return value;
}

test('Watchlist Report exposes the complete dailyBias shadow field', () => {
  const input = fixture();
  const report = WatchlistReport.analyze(input);
  const dailyBias = report.current.fourHourAnalysis.dailyBias;

  assert.ok(dailyBias);
  assert.deepStrictEqual(Object.keys(dailyBias), [
    'marketBias',
    'legacyBias',
    'transitionDirection',
    'structureState',
    'drawOnLiquidity',
    'location',
    'htfLocationReadiness',
    'reasons',
  ]);
  assert.ok([
    'BULLISH',
    'BEARISH',
    'NEUTRAL',
  ].includes(dailyBias.marketBias));
});

test('legacy fourHourAnalysis.bias remains exactly V3 output', () => {
  const input = fixture();
  const report = WatchlistReport.analyze(input);
  const h4 = HtfBiasV3.analyze({
    h4Klines: input.h4Klines,
  });
  const expected = WatchlistReport.latestStateAtOrBefore(
    h4.states,
    input.ltf5mKlines[
      input.ltf5mKlines.length - 1
    ].closeTime
  );

  assert.strictEqual(
    report.current.fourHourAnalysis.bias,
    expected.narrative.bias
  );
});

test('Decision Gate uses dailyBias while legacy bias stays available', () => {
  const input = fixture();
  const report = WatchlistReport.analyze(input);
  const expected = DecisionGate.analyze({
    current: withoutGate(report.current),
    previousGateState: null,
  });

  assert.deepStrictEqual(
    report.current.decisionGate,
    expected
  );
  assert.strictEqual(
    report.current.decisionGate.sourceState.h4Bias,
    report.current.fourHourAnalysis.dailyBias.marketBias
  );
});

test('Report Human Summary and Formatter use the same Decision Gate input', () => {
  const input = fixture();
  const report = WatchlistReport.analyze(input);
  const formatterInput = ChineseFormatter.dashboardInput(
    report.current
  );
  const expected = HumanSummary.summarizeTraderContext(
    formatterInput
  );

  assert.strictEqual(report.current.humanSummary, expected);
  assert.ok(report.current.humanSummary.includes(
    '【Decision Gate】'
  ));
  assert.ok(report.current.humanSummary.includes(
    '方向：\n' + (
      report.current.decisionGate.direction || 'NONE'
    )
  ));
  assert.ok(
    ChineseFormatter.format(report).includes(expected)
  );
});

test('dailyBias uses the last closed H4 state, not future H4 data', () => {
  const input = fixture();
  const prefix = WatchlistReport.analyze(input);
  const withFutureH4 = WatchlistReport.analyze({
    ...input,
    h4Klines: input.futureH4Klines,
  });

  assert.deepStrictEqual(
    withFutureH4.current.fourHourAnalysis.dailyBias,
    prefix.current.fourHourAnalysis.dailyBias
  );
  assert.strictEqual(
    withFutureH4.current.fourHourAnalysis.bias,
    prefix.current.fourHourAnalysis.bias
  );
});

test('retained snapshots receive their own causal dailyBias state', () => {
  const input = fixture();
  const report = WatchlistReport.analyze({
    ...input,
    retainSnapshots: true,
  });

  assert.ok(report.snapshots.length > 0);
  assert.ok(report.snapshots.every((snapshot) => (
    snapshot.fourHourAnalysis.dailyBias &&
    typeof snapshot.fourHourAnalysis.dailyBias.marketBias ===
      'string'
  )));
  assert.deepStrictEqual(
    report.snapshots[report.snapshots.length - 1]
      .fourHourAnalysis.dailyBias,
    report.current.fourHourAnalysis.dailyBias
  );
});

test('Report integration never mutates H4 or 5m inputs', () => {
  const input = fixture();
  const before = JSON.stringify(input);

  WatchlistReport.analyze(input);

  assert.strictEqual(JSON.stringify(input), before);
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
