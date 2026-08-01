'use strict';

const assert = require('assert');
const HtfContext = require('../indicators/htfContextAnalyzer');
const DecisionGate = require('../indicators/ictDecisionGate');
const WatchlistReport = require(
  '../indicators/ictWatchlistAnalystReport'
);
const ChineseFormatter = require(
  '../formatters/ictAnalystChineseFormatter'
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

function reportInput(overrides) {
  const ltf5mKlines = createFiveMinuteBars(2400);
  return {
    symbol: 'BTCUSDT',
    h4Klines: HtfContext.aggregateClosedKlines(
      ltf5mKlines,
      HtfContext.FOUR_HOURS
    ),
    ltf5mKlines,
    retainSnapshots: false,
    ...(overrides || {}),
  };
}

function withoutDecisionGate(current) {
  const value = JSON.parse(JSON.stringify(current));
  delete value.decisionGate;
  return value;
}

test('Watchlist report contains the complete Decision Gate output', () => {
  const report = WatchlistReport.analyze(reportInput());
  assert.deepStrictEqual(
    Object.keys(report.current.decisionGate),
    [
      'state',
      'direction',
      'activeOpportunity',
      'progress',
      'sourceState',
      'blockers',
      'reasonCode',
      'transition',
      'informationalOnly',
    ]
  );
  assert.strictEqual(
    report.protocol.decisionGateIsStateAuthority,
    true
  );
});

test('Watchlist passes current and previous state through Decision Gate', () => {
  const input = reportInput();
  const first = WatchlistReport.analyze(input);
  const second = WatchlistReport.analyze({
    ...input,
    previousGateState: first.current.decisionGate,
  });
  const expected = DecisionGate.analyze({
    current: withoutDecisionGate(second.current),
    previousGateState: first.current.decisionGate,
  });

  assert.deepStrictEqual(second.current.decisionGate, expected);
  assert.strictEqual(
    second.current.decisionGate.transition.from,
    first.current.decisionGate.state
  );
});

test('Decision Gate integration preserves existing report fields', () => {
  const current = WatchlistReport.analyze(
    reportInput()
  ).current;

  assert.ok(current.fourHourAnalysis);
  assert.ok(current.structurePhase);
  assert.ok(current.htfAlignment);
  assert.ok(current.opportunity);
  assert.ok(current.fiveMinuteObservation);
  assert.ok(Object.prototype.hasOwnProperty.call(
    current.fiveMinuteObservation.currentConfirmed,
    'confirmation'
  ));
  assert.ok(current.alignment);
  assert.strictEqual(typeof current.setupStage, 'string');
  assert.strictEqual(typeof current.humanSummary, 'string');
});

test('formatter remains compatible with reports without Decision Gate', () => {
  const report = WatchlistReport.analyze(reportInput());
  const legacyReport = JSON.parse(JSON.stringify(report));
  delete legacyReport.current.decisionGate;
  const legacyFormatted = ChineseFormatter.format(legacyReport);

  assert.ok(legacyFormatted.includes('【交易监控面板】'));
  assert.ok(legacyFormatted.includes('【交易机会】'));
  assert.strictEqual(
    legacyFormatted.includes('【Decision Gate】'),
    false
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
