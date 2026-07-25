'use strict';

const assert = require('assert');
const PdEngine = require(
  '../indicators/ictHtfPdArrayEngine'
);
const LtfEngine = require('../indicators/ictLtfExecutionEngine');
const DeliveryValidation = require(
  '../backtest/ictHtfBiasLtfConfirmationValidation'
);
const Validation = require(
  '../backtest/ictHtfPdArrayConfluenceValidation'
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

function createBars(length, duration) {
  const start = Date.UTC(2023, 0, 2);
  return Array.from({ length }, (_, index) => {
    const center =
      100 +
      Math.sin(index / 5) * 7 +
      Math.sin(index / 2) * 2;
    const open = center - (index % 3 === 0 ? 0.7 : -0.3);
    const close = center + (index % 3 === 0 ? 0.5 : -0.2);
    return {
      openTime: start + index * duration,
      closeTime: start + (index + 1) * duration - 1,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1,
    };
  });
}

function rawPd(type, bottom, top, origin, available) {
  return {
    id: [type, origin, available].join(':'),
    type,
    category: type.endsWith('_OB') ? 'OB' : 'FVG',
    direction: type.startsWith('BULLISH')
      ? 'BULLISH'
      : 'BEARISH',
    bottom,
    top,
    originIndex: origin,
    availableIndex: available,
    sourceIds: [],
    touchIndex: null,
  };
}

test('Breaker is confirmed only by a later 4H close beyond OB', () => {
  const bars = createBars(6, 4 * 60 * 60 * 1000);
  bars[2] = {
    ...bars[2],
    open: 96,
    high: 101,
    low: 94,
    close: 95,
  };
  bars[3] = {
    ...bars[3],
    open: 95,
    high: 98,
    low: 89,
    close: 91,
  };
  bars[4] = {
    ...bars[4],
    open: 91,
    high: 93,
    low: 87,
    close: 89,
  };
  const ob = rawPd('BULLISH_OB', 90, 100, 0, 1);
  const breakers = PdEngine.deriveBreakers([ob], bars);

  assert.strictEqual(breakers.length, 1);
  assert.strictEqual(breakers[0].type, 'BEARISH_BREAKER');
  assert.strictEqual(breakers[0].availableIndex, 4);
});

test('BPR is the confirmed overlap and follows the newer FVG', () => {
  const older = rawPd('BEARISH_FVG', 100, 110, 1, 3);
  older.touchIndex = 4;
  const newer = rawPd('BULLISH_FVG', 105, 115, 5, 5);
  const bprs = PdEngine.deriveBprs([older, newer]);

  assert.strictEqual(bprs.length, 1);
  assert.strictEqual(bprs[0].type, 'BULLISH_BPR');
  assert.strictEqual(bprs[0].bottom, 105);
  assert.strictEqual(bprs[0].top, 110);
  assert.strictEqual(bprs[0].availableIndex, 5);
});

test('PD Array touch is published only after availability', () => {
  const bars = createBars(6, 4 * 60 * 60 * 1000);
  bars[3] = { ...bars[3], high: 104, low: 102 };
  bars[4] = { ...bars[4], high: 101, low: 99 };
  const item = rawPd('BULLISH_FVG', 100, 101, 1, 3);
  PdEngine.applyTouchLifecycle([item], bars);
  const timeline = PdEngine.buildTimeline([item], bars, true);

  assert.strictEqual(item.touchIndex, 4);
  assert.strictEqual(
    timeline.states[3].bullishFvgs.length,
    1
  );
  assert.strictEqual(
    timeline.states[4].bullishFvgs.length,
    0
  );
  assert.strictEqual(timeline.events[0].availableIndex, 4);
});

test('PD Array snapshots remain prefix invariant', () => {
  const bars = createBars(150, 4 * 60 * 60 * 1000);
  const prefixLength = 100;
  const prefix = PdEngine.analyze({
    h4Klines: bars.slice(0, prefixLength),
  });
  const full = PdEngine.analyze({ h4Klines: bars });

  assert.deepStrictEqual(
    full.states.slice(0, prefixLength),
    prefix.states
  );
  assert.deepStrictEqual(
    full.events.touches.filter(
      (event) => event.availableIndex < prefixLength
    ),
    prefix.events.touches
  );
});

function h4State(index, bias, draw, location) {
  return {
    index,
    time: Date.UTC(2023, 0, 2) +
      (index + 1) * 4 * 60 * 60 * 1000 - 1,
    dealingRange: { location },
    narrative: {
      bias,
      primaryDraw: draw,
    },
  };
}

function mssEvent(state, index, sweepOffset) {
  const sweepTime = state.time + sweepOffset;
  return {
    direction: 'BULLISH',
    index,
    time: sweepTime + LtfEngine.FIVE_MINUTES,
    sweep: {
      side: 'SELL_SIDE',
      level: {
        type: 'LTF_SWING_LOW',
        side: 'SELL_SIDE',
        price: 90,
      },
      index: index - 1,
      time: sweepTime,
    },
  };
}

test('Confluence requires PD touch before sweep in same Bias period', () => {
  const draw = {
    side: 'BUY_SIDE',
    type: 'PDH',
    price: 120,
  };
  const states = [
    h4State(0, 'BULLISH', draw, 'DISCOUNT'),
    h4State(1, 'BULLISH', draw, 'DISCOUNT'),
  ];
  const periods = DeliveryValidation.buildBiasPeriods(states);
  const bars = createBars(120, LtfEngine.FIVE_MINUTES);
  bars[20].close = 105;
  const mss = mssEvent(
    states[0],
    20,
    2 * LtfEngine.FIVE_MINUTES
  );
  const validTouch = {
    direction: 'BULLISH',
    category: 'FVG',
    time: states[0].time,
  };
  const grouped = Validation.groupEligibleTouches(
    [validTouch],
    states,
    periods.periodByH4Index
  );
  const events = Validation.matchConfluenceEvents(
    [mss],
    states,
    periods.periodByH4Index,
    grouped.byPeriod,
    bars
  );
  assert.strictEqual(events.length, 1);
  assert.deepStrictEqual(events[0].pdCategories, ['FVG']);

  const lateGrouped = Validation.groupEligibleTouches([{
    ...validTouch,
    time: mss.sweep.time,
  }], states, periods.periodByH4Index);
  const invalid = Validation.matchConfluenceEvents(
    [mss],
    states,
    periods.periodByH4Index,
    lateGrouped.byPeriod,
    bars
  );
  assert.strictEqual(invalid.length, 0);
});

test('PD category cohorts deliberately overlap', () => {
  const outcome = {
    directionSuccess: true,
    primaryDrawHit: false,
    mfe: 2,
    mae: 1,
  };
  const events = [{
    bias: 'BULLISH',
    pdCategories: ['FVG', 'OB'],
    outcomes: { '24h': outcome },
  }];
  const stats = Validation.buildCategoryStats(
    events,
    ['FVG', 'OB'],
    [24]
  );

  assert.strictEqual(stats.FVG.events, 1);
  assert.strictEqual(stats.OB.events, 1);
  assert.strictEqual(
    stats.FVG.horizons['24h'].directionSuccessRate,
    1
  );
});

test('Comparison reports treatment minus control deltas', () => {
  const control = {
    '24h': {
      directionSuccessRate: 0.5,
      primaryDrawHitRate: 0.2,
      averageMFE: 3,
      averageMAE: 2,
    },
  };
  const treatment = {
    '24h': {
      directionSuccessRate: 0.55,
      primaryDrawHitRate: 0.15,
      averageMFE: 3.2,
      averageMAE: 1.8,
    },
  };
  const compared = Validation.compareHorizons(
    control,
    treatment,
    [24]
  )['24h'];

  assert.ok(
    Math.abs(
      compared.directionSuccessPercentagePointDelta - 5
    ) < 1e-9
  );
  assert.ok(
    Math.abs(
      compared.primaryDrawHitPercentagePointDelta + 5
    ) < 1e-9
  );
  assert.ok(Math.abs(compared.averageMFEDelta - 0.2) < 1e-9);
  assert.ok(Math.abs(compared.averageMAEDelta + 0.2) < 1e-9);
});

console.log('\n' + testsPassed + ' tests passed.');
