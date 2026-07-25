'use strict';

const assert = require('assert');
const PdArray = require('../indicators/ictHtfPdArrayEngine');
const LtfExecution = require(
  '../indicators/ictLtfExecutionEngine'
);
const Validation = require(
  '../backtest/ictLtfEntryPoiValidation'
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

const START = Date.UTC(2023, 0, 1);

function createBars(length) {
  return Array.from({ length }, (_, index) => {
    const center =
      100 +
      Math.sin(index / 5) * 5 +
      Math.sin(index / 2);
    return {
      openTime: START + index * LtfExecution.FIVE_MINUTES,
      closeTime:
        START +
        (index + 1) * LtfExecution.FIVE_MINUTES -
        1,
      open: center - 0.3,
      high: center + 1,
      low: center - 1,
      close: center + 0.3,
      volume: 1,
    };
  });
}

function baseMss(index, bias) {
  return {
    periodId: 1,
    index,
    time:
      START +
      (index + 1) * LtfExecution.FIVE_MINUTES -
      1,
    bias: bias || 'BULLISH',
    primaryDraw: {
      side: bias === 'BEARISH' ? 'SELL_SIDE' : 'BUY_SIDE',
      type: bias === 'BEARISH' ? 'PDL' : 'PDH',
      price: bias === 'BEARISH' ? 70 : 130,
    },
    sweep: {
      index: 5,
      time:
        START + 6 * LtfExecution.FIVE_MINUTES - 1,
    },
    mss: { direction: bias || 'BULLISH' },
  };
}

test('generic 5m PD Array snapshots remain prefix invariant', () => {
  const bars = createBars(120);
  const prefixLength = 80;
  const prefix = PdArray.analyze({
    klines: bars.slice(0, prefixLength),
    intervalMilliseconds: LtfExecution.FIVE_MINUTES,
  });
  const full = PdArray.analyze({
    klines: bars,
    intervalMilliseconds: LtfExecution.FIVE_MINUTES,
  });

  assert.deepStrictEqual(
    full.states.slice(0, prefixLength),
    prefix.states
  );
  assert.strictEqual(
    full.protocol.intervalMilliseconds,
    LtfExecution.FIVE_MINUTES
  );
});

test('POI must form strictly after MSS and retest later', () => {
  const bars = createBars(40);
  bars[5].low = 90;
  const base = baseMss(12, 'BULLISH');
  const arrays = [{
    id: 'old',
    category: 'FVG',
    direction: 'BULLISH',
    type: 'BULLISH_FVG',
    top: 102,
    bottom: 101,
    originIndex: 2,
    availableIndex: 2,
  }, {
    id: 'new',
    category: 'FVG',
    direction: 'BULLISH',
    type: 'BULLISH_FVG',
    top: 103,
    bottom: 102,
    originIndex: 3,
    availableIndex: 3,
  }];
  const touches = [{
    arrayId: 'old',
    category: 'FVG',
    direction: 'BULLISH',
    index: 4,
    time: bars[14].closeTime,
  }, {
    arrayId: 'new',
    category: 'FVG',
    direction: 'BULLISH',
    index: 5,
    time: bars[15].closeTime,
  }];
  const selected = Validation.selectPoiEntriesForMss(
    base,
    {
      arrays,
      events: { touches },
    },
    10,
    bars
  );

  assert.strictEqual(selected.size, 1);
  assert.strictEqual(selected.get('FVG').poi.id, 'new');
  assert.strictEqual(selected.get('FVG').poi.availableIndex, 13);
  assert.strictEqual(selected.get('FVG').index, 15);
});

test('same-bar stop and R targets use conservative stop-first rule', () => {
  const bars = createBars(310);
  const entry = {
    index: 0,
    bias: 'BULLISH',
    referencePrice: 100,
    riskAnchor: 95,
    risk: 5,
  };
  bars[1].low = 95;
  bars[1].high = 111;
  const outcome = Validation.evaluateRPath(
    entry,
    bars,
    24
  );

  assert.strictEqual(outcome.oneRReached, false);
  assert.strictEqual(outcome.twoRReached, false);
});

test('R targets must be reached before later invalidation', () => {
  const bars = createBars(310);
  const entry = {
    index: 0,
    bias: 'BULLISH',
    referencePrice: 100,
    riskAnchor: 95,
    risk: 5,
  };
  bars[1].low = 99;
  bars[1].high = 106;
  bars[2].low = 96;
  bars[2].high = 111;
  const outcome = Validation.evaluateRPath(
    entry,
    bars,
    24
  );

  assert.strictEqual(outcome.oneRReached, true);
  assert.strictEqual(outcome.twoRReached, true);
});

test('returns, MFE and MAE are normalized to Bias direction', () => {
  const bars = createBars(310);
  bars[0].close = 100;
  bars[48].close = 90;
  bars[144].close = 85;
  bars[288].close = 80;
  bars[288].low = 79;
  const evaluated = Validation.evaluateEntry({
    ...baseMss(0, 'BEARISH'),
    index: 0,
    year: 2023,
    referencePrice: 100,
    riskAnchor: 105,
    risk: 5,
  }, bars, [4, 12, 24], 24);

  assert.strictEqual(
    evaluated.outcome.directionalReturns['4h'],
    10
  );
  assert.strictEqual(
    evaluated.outcome.directionalReturns['24h'],
    20
  );
  assert.ok(evaluated.outcome.mfe >= 20);
  assert.ok(evaluated.outcome.mae >= 0);
});

console.log('\n' + testsPassed + ' tests passed.');
