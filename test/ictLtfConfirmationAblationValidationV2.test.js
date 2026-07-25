'use strict';

const assert = require('assert');
const Ablation = require(
  '../backtest/ictLtfConfirmationAblationValidationV2'
);
const DeliveryValidation = require(
  '../backtest/ictHtfBiasLtfConfirmationValidation'
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
  return Array.from({ length }, (_, index) => ({
    openTime: START + index * FIVE_MINUTES,
    closeTime: START + (index + 1) * FIVE_MINUTES - 1,
    open: 100,
    high: 102,
    low: 98,
    close: 100 + index / 100,
    volume: 1,
  }));
}

function period(id, startTime, bias) {
  const bullish = bias !== 'BEARISH';
  return {
    id,
    bias: bullish ? 'BULLISH' : 'BEARISH',
    startTime,
    primaryDraw: {
      side: bullish ? 'BUY_SIDE' : 'SELL_SIDE',
      type: bullish ? 'PDH' : 'PDL',
      price: bullish ? 130 : 70,
    },
  };
}

function h4State(index, bias, draw) {
  return {
    index,
    time: START + (index + 1) * 4 * 60 * 60 * 1000 - 1,
    narrative: {
      bias,
      primaryDraw: draw,
    },
  };
}

test('latest closed index never uses an unfinished future bar', () => {
  const bars = createBars(4);
  assert.strictEqual(
    Ablation.latestClosedKlineIndex(
      bars,
      bars[1].closeTime
    ),
    1
  );
  assert.strictEqual(
    Ablation.latestClosedKlineIndex(
      bars,
      bars[2].closeTime - 1
    ),
    1
  );
});

test('Group A publishes one event at each Bias period start', () => {
  const bars = createBars(20);
  const periods = [
    period(0, bars[3].closeTime, 'BULLISH'),
    period(1, bars[10].closeTime, 'BEARISH'),
  ];
  const events = Ablation.buildBiasEvents(periods, bars);

  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].index, 3);
  assert.strictEqual(events[1].index, 10);
  assert.strictEqual(events[0].stage, 'BIAS_PRIMARY_DRAW');
});

test('Group B keeps the first allowed Sweep per Bias period', () => {
  const bars = createBars(120);
  const draw = {
    side: 'BUY_SIDE',
    type: 'PDH',
    price: 130,
  };
  const states = [
    h4State(0, 'BULLISH', draw),
    h4State(1, 'BULLISH', draw),
  ];
  const timeline = DeliveryValidation.buildBiasPeriods(states);
  const sweeps = [{
    type: 'LTF_SWING_LOW',
    side: 'SELL_SIDE',
    price: 90,
    sweptIndex: 50,
    time: states[0].time + FIVE_MINUTES,
  }, {
    type: 'EQUAL_LOW',
    side: 'SELL_SIDE',
    price: 91,
    sweptIndex: 51,
    time: states[0].time + 2 * FIVE_MINUTES,
  }];
  const events = Ablation.buildSweepEvents(
    sweeps,
    states,
    timeline.periodByH4Index,
    bars
  );

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].sweep.level.type, 'LTF_SWING_LOW');
});

test('Group B rejects same-side and unsupported liquidity', () => {
  const bars = createBars(120);
  const draw = {
    side: 'BUY_SIDE',
    type: 'PDH',
    price: 130,
  };
  const states = [h4State(0, 'BULLISH', draw)];
  const timeline = DeliveryValidation.buildBiasPeriods(states);
  const sweeps = [{
    type: 'PDH',
    side: 'BUY_SIDE',
    price: 120,
    sweptIndex: 50,
    time: states[0].time + FIVE_MINUTES,
  }, {
    type: 'PWL',
    side: 'SELL_SIDE',
    price: 80,
    sweptIndex: 51,
    time: states[0].time + 2 * FIVE_MINUTES,
  }];
  const events = Ablation.buildSweepEvents(
    sweeps,
    states,
    timeline.periodByH4Index,
    bars
  );

  assert.strictEqual(events.length, 0);
});

test('Summary exposes 1h/4h/12h/24h and 72h outcomes', () => {
  const outcomes = Object.fromEntries(
    Ablation.ALL_HORIZONS.map((hours) => [
      hours + 'h',
      {
        directionSuccess: true,
        primaryDrawHit: hours === 72,
        mfe: hours,
        mae: hours / 2,
      },
    ])
  );
  const summary = Ablation.summarizeGroup([{
    bias: 'BULLISH',
    year: 2023,
    outcomes,
  }], [2023], Ablation.ALL_HORIZONS);

  assert.strictEqual(summary.events, 1);
  assert.strictEqual(
    summary.horizons['1h'].directionSuccessRate,
    1
  );
  assert.strictEqual(
    summary.horizons['72h'].primaryDrawHitRate,
    1
  );
  assert.strictEqual(summary.yearly['2023'].events, 1);
});

console.log('\n' + testsPassed + ' tests passed.');
