'use strict';

const assert = require('assert');
const HtfContext = require('../indicators/htfContextAnalyzer');
const Report = require('../indicators/ictHtfAnalystReport');

let testsPassed = 0;

function test(name, callback) {
  try {
    callback();
    testsPassed += 1;
    console.log('PASS:', name);
  } catch (error) {
    console.error('FAIL:', name);
    throw error;
  }
}

const FIVE_MINUTES = 5 * 60 * 1000;
const START = Date.UTC(2023, 0, 1);

function createBars(length) {
  return Array.from({ length }, (_, index) => {
    const center =
      20000 +
      Math.sin(index / 80) * 900 +
      Math.sin(index / 17) * 180;
    const bullish = index % 5 !== 0;
    const open = center + (bullish ? -30 : 30);
    const close = center + (bullish ? 35 : -35);
    return {
      openTime: START + index * FIVE_MINUTES,
      closeTime: START + (index + 1) * FIVE_MINUTES - 1,
      open,
      high: Math.max(open, close) + 45,
      low: Math.min(open, close) - 45,
      close,
      volume: 1,
    };
  });
}

function analyzeBars(fiveMinuteBars, retainSnapshots) {
  return Report.analyze({
    symbol: 'BTCUSDT',
    ltf5mKlines: fiveMinuteBars,
    h1Klines: HtfContext.aggregateClosedKlines(
      fiveMinuteBars,
      HtfContext.ONE_HOUR
    ),
    h4Klines: HtfContext.aggregateClosedKlines(
      fiveMinuteBars,
      HtfContext.FOUR_HOURS
    ),
    retainSnapshots,
  });
}

test('report contains required 4H, 1H and 5m sections', () => {
  const report = analyzeBars(createBars(1200), false);
  const current = report.current;

  assert.strictEqual(report.symbol, 'BTCUSDT');
  assert.ok(Array.isArray(
    current.fourHourAnalysis.confirmedSwingSequence
  ));
  assert.ok(Object.prototype.hasOwnProperty.call(
    current.fourHourAnalysis,
    'currentStructure'
  ));
  assert.ok(current.fourHourAnalysis.dealingRange);
  assert.ok(Object.prototype.hasOwnProperty.call(
    current.fourHourAnalysis,
    'premiumDiscount'
  ));
  assert.ok(current.fourHourAnalysis.externalLiquidity);
  assert.ok(Object.prototype.hasOwnProperty.call(
    current.fourHourAnalysis,
    'primaryDraw'
  ));
  assert.ok(Object.prototype.hasOwnProperty.call(
    current.fourHourAnalysis,
    'bias'
  ));

  assert.ok(Array.isArray(
    current.oneHourAnalysis.confirmedSwingSequence
  ));
  assert.ok(current.oneHourAnalysis.deliveryDirection);
  assert.ok(current.oneHourAnalysis.deliveryState);
  assert.ok(current.oneHourAnalysis.relationToH4);

  assert.ok(current.fiveMinuteObservation.currentConfirmed);
  assert.ok(current.fiveMinuteObservation.latestConfirmed);
  assert.ok(
    current.fiveMinuteObservation.potentialObservation
  );
  assert.strictEqual(typeof current.humanSummary, 'string');
  assert.ok(current.humanSummary.length > 0);
});

test('potential observation is informational and HTF aligned', () => {
  const bullish = Report.potentialObservation(
    { bias: 'BULLISH' },
    { relationToH4: 'RETRACEMENT' },
    {
      direction: 'BULLISH',
      sweep: { side: 'SELL_SIDE' },
      time: 100,
      availableIndex: 10,
    },
    { direction: 'BULLISH' }
  );
  assert.strictEqual(
    bullish.state,
    'POTENTIAL_LONG_OBSERVATION'
  );
  assert.strictEqual(bullish.side, 'LONG');
  assert.strictEqual(bullish.informationalOnly, true);

  const counter = Report.potentialObservation(
    { bias: 'BEARISH' },
    { relationToH4: 'ALIGNED' },
    {
      direction: 'BULLISH',
      sweep: { side: 'SELL_SIDE' },
      time: 100,
      availableIndex: 10,
    },
    { direction: 'BULLISH' }
  );
  assert.strictEqual(counter.state, 'NONE');
});

function collectKeys(value, result) {
  result = result || [];
  if (!value || typeof value !== 'object') return result;
  for (const [key, child] of Object.entries(value)) {
    result.push(key.toLowerCase());
    collectKeys(child, result);
  }
  return result;
}

test('current analyst report contains no execution fields', () => {
  const report = analyzeBars(createBars(1200), false);
  const keys = new Set(collectKeys(report.current));
  for (const forbidden of [
    'entryprice',
    'stop',
    'target',
    'positionsize',
    'order',
  ]) {
    assert.strictEqual(keys.has(forbidden), false);
  }
  assert.strictEqual(report.protocol.generatesEntryPrice, false);
  assert.strictEqual(report.protocol.generatesOrder, false);
});

test('published swing and event indexes are causal', () => {
  const report = analyzeBars(createBars(1200), false);
  const current = report.current;
  for (const swing of [
    ...current.fourHourAnalysis.confirmedSwingSequence,
    ...current.oneHourAnalysis.confirmedSwingSequence,
  ]) {
    assert.ok(Number.isInteger(swing.availableIndex));
    assert.ok(swing.availableIndex >= swing.index);
  }
  const observation = current.fiveMinuteObservation;
  assert.ok(observation.availableIndex <= current.availableIndex);
  for (const sweep of observation.currentConfirmed
    .liquiditySweeps) {
    assert.ok(sweep.availableIndex <= current.availableIndex);
  }
  if (observation.currentConfirmed.mss) {
    assert.ok(
      observation.currentConfirmed.mss.availableIndex <=
      current.availableIndex
    );
  }
});

test('analyst snapshots remain prefix invariant', () => {
  const fullBars = createBars(1800);
  const prefixLength = 1440;
  const prefix = analyzeBars(
    fullBars.slice(0, prefixLength),
    false
  );
  const full = analyzeBars(fullBars, true);

  assert.strictEqual(full.snapshots.length, fullBars.length);
  assert.deepStrictEqual(
    full.snapshots[prefixLength - 1],
    prefix.current
  );
});

console.log('\n' + testsPassed + ' tests passed.');
