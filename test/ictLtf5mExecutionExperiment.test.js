'use strict';

const assert = require('assert');
const HtfV2 = require('../indicators/ictHtfBiasEngineV2');
const LtfEngine = require('../indicators/ictLtfExecutionEngine');
const Experiment = require(
  '../backtest/ictLtf5mExecutionExperiment'
);

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

function create5mBars(length) {
  const start = Date.UTC(2023, 0, 2);
  return Array.from({ length }, (_, index) => {
    const center =
      100 + Math.sin(index / 9) * 5 + Math.sin(index / 3);
    const open = center - 0.3;
    const close = center + 0.3;
    return {
      openTime: start + index * LtfEngine.FIVE_MINUTES,
      closeTime:
        start + (index + 1) * LtfEngine.FIVE_MINUTES - 1,
      open,
      high: Math.max(open, close) + 0.4,
      low: Math.min(open, close) - 0.4,
      close,
      volume: 1,
    };
  });
}

function aggregate(bars, size) {
  const result = [];
  for (let index = 0; index + size - 1 < bars.length; index += size) {
    const group = bars.slice(index, index + size);
    result.push({
      openTime: group[0].openTime,
      closeTime: group[group.length - 1].closeTime,
      open: group[0].open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: group[group.length - 1].close,
      volume: group.length,
    });
  }
  return result;
}

test('5m experiment reuses fixed LTF rules without trading output', () => {
  const m5 = create5mBars(12 * 24 * 8);
  const h1 = aggregate(m5, 12);
  const h4 = aggregate(m5, 48);
  const result = Experiment.analyze({
    h4Klines: h4,
    h1Klines: h1,
    ltf5mKlines: m5,
    horizons: [24],
    years: [2023],
  });

  assert.strictEqual(result.protocol.timeframe, '5m');
  assert.strictEqual(result.protocol.reads15m, false);
  assert.strictEqual(result.protocol.readsBaseline, false);
  assert.strictEqual(result.protocol.generatesEntryExit, false);
  assert.strictEqual(
    result.protocol.fixedParameters.parameterSearch,
    false
  );
  assert.strictEqual(
    result.source.intervalMilliseconds,
    LtfEngine.FIVE_MINUTES
  );
  assert.ok(Object.prototype.hasOwnProperty.call(
    result,
    'eventCounts'
  ));
  assert.ok(Object.prototype.hasOwnProperty.call(result, 'mss'));
});

test('5m experiment rejects non-5m input', () => {
  const m5 = create5mBars(96);
  const m15 = aggregate(m5, 3);
  const h1 = aggregate(m5, 12);
  const h4 = aggregate(m5, 48);

  assert.throws(() => Experiment.analyze({
    h4Klines: h4,
    h1Klines: h1,
    ltf5mKlines: m15,
  }), /5m/);
});

test('HTF engine constants remain unchanged by 5m experiment', () => {
  assert.strictEqual(HtfV2.FOUR_HOURS, 4 * 60 * 60 * 1000);
  assert.strictEqual(LtfEngine.DISPLACEMENT_BODY_RATIO, 0.65);
  assert.strictEqual(
    LtfEngine.RANGE_EXPANSION_MULTIPLIER,
    1.5
  );
});

console.log('\n' + testsPassed + ' tests passed.');
