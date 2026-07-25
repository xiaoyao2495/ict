'use strict';

const assert = require('assert');
const HtfContext = require('../indicators/htfContextAnalyzer');
const AnalystReport = require(
  '../indicators/ictHtfAnalystReport'
);
const Validation = require(
  '../backtest/ictHtfAnalystValidation'
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

const FIVE_MINUTES = 5 * 60 * 1000;
const START = Date.UTC(2023, 0, 1);

function createBars(length) {
  return Array.from({ length }, (_, index) => {
    const center =
      20000 +
      Math.sin(index / 70) * 1000 +
      Math.sin(index / 13) * 220;
    const open = center + (index % 4 === 0 ? 40 : -35);
    const close = center + (index % 4 === 0 ? -35 : 40);
    return {
      openTime: START + index * FIVE_MINUTES,
      closeTime: START + (index + 1) * FIVE_MINUTES - 1,
      open,
      high: Math.max(open, close) + 50,
      low: Math.min(open, close) - 50,
      close,
      volume: 1,
    };
  });
}

function inputOf(fiveMinuteBars) {
  return {
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
  };
}

test('Analyst Report visitor observes snapshots without retaining them', () => {
  const input = inputOf(createBars(600));
  let visited = 0;
  const report = AnalystReport.analyze({
    ...input,
    retainSnapshots: false,
    onSnapshot() {
      visited += 1;
    },
  });

  assert.strictEqual(visited, input.ltf5mKlines.length);
  assert.strictEqual(report.snapshots.length, 0);
  assert.strictEqual(
    report.current.index,
    input.ltf5mKlines.length - 1
  );
});

test('event extraction remains prefix invariant', () => {
  const bars = createBars(1800);
  const prefixLength = 1440;
  const prefix = Validation.extractAnalystEvents(
    inputOf(bars.slice(0, prefixLength))
  );
  const full = Validation.extractAnalystEvents(inputOf(bars));

  for (const key of Object.keys(prefix)) {
    assert.deepStrictEqual(
      full[key].filter(
        (event) => event.availableIndex < prefixLength
      ),
      prefix[key]
    );
  }
});

test('direction validation calculates accuracy, MFE and MAE', () => {
  const bars = createBars(700);
  bars[0].close = 100;
  bars[48].close = 110;
  bars[48].high = 112;
  bars[20].low = 95;
  const outcome = Validation.evaluateDirectional({
    index: 0,
    referencePrice: 100,
    direction: 'BULLISH',
  }, bars, 4);

  assert.strictEqual(outcome.directionCorrect, true);
  assert.strictEqual(outcome.directionalReturn, 10);
  assert.ok(outcome.mfe >= 12);
  assert.ok(outcome.mae >= 5);
});

test('Primary Draw hit uses future bars after the event only', () => {
  const bars = createBars(900);
  bars[0].high = 130;
  for (let index = 1; index < 288; index += 1) {
    bars[index].high = Math.min(bars[index].high, 119);
  }
  bars[288].high = 121;
  const event = {
    index: 0,
    draw: {
      side: 'BUY_SIDE',
      type: 'PDH',
      price: 120,
    },
  };

  assert.strictEqual(
    Validation.evaluatePrimaryDraw(event, bars, 24).hit,
    true
  );
  assert.strictEqual(
    Validation.evaluatePrimaryDraw(event, bars, 4).hit,
    false
  );
});

test('Primary Draw types normalize 4H swings without parameter search', () => {
  assert.strictEqual(
    Validation.normalizePrimaryDrawType('H4_SWING_HIGH'),
    'H4_SWING'
  );
  assert.strictEqual(
    Validation.normalizePrimaryDrawType('H4_SWING_LOW'),
    'H4_SWING'
  );
  assert.strictEqual(
    Validation.normalizePrimaryDrawType('PWH'),
    'PWH'
  );
  assert.strictEqual(
    Validation.normalizePrimaryDrawType('EQUAL_HIGH'),
    null
  );
});

test('validation output is informational and has no equity curve', () => {
  const report = Validation.analyze({
    ...inputOf(createBars(1200)),
    years: [2023],
  });

  assert.strictEqual(report.protocol.readsTrades, false);
  assert.strictEqual(report.protocol.generatesTrade, false);
  assert.strictEqual(
    report.protocol.generatesEquityCurve,
    false
  );
  assert.strictEqual(report.protocol.parameterSearch, false);
  assert.strictEqual(report.events, null);
  assert.ok(report.h4BiasValidation);
  assert.ok(report.primaryDrawValidation);
  assert.ok(report.h1DeliveryValidation);
  assert.ok(report.observationValidation);
});

console.log('\n' + testsPassed + ' tests passed.');
