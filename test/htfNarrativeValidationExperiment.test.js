'use strict';

const assert = require('assert');
const Validation = require(
  '../backtest/htfNarrativeValidationExperiment'
);

const FOUR_HOURS = 4 * 60 * 60 * 1000;
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

function createBars(length) {
  const start = Date.UTC(2023, 0, 1);
  return Array.from({ length }, (_, index) => ({
    openTime: start + index * FOUR_HOURS,
    closeTime: start + (index + 1) * FOUR_HOURS - 1,
    open: 100,
    high: 103,
    low: 97,
    close: 100,
  }));
}

function state(index, direction) {
  return {
    index,
    time: Date.UTC(2023, 0, 1) + (index + 1) * FOUR_HOURS - 1,
    referencePrice: 100,
    marketStructure: {
      state: direction,
      sequence: direction === 'BULLISH'
        ? [
          {
            label: 'HL',
            price: 90,
            index: 0,
            availableIndex: 1,
          },
        ]
        : [
          {
            label: 'LH',
            price: 110,
            index: 0,
            availableIndex: 1,
          },
        ],
      lastStructureEvent: null,
    },
    dealingRange: {
      location: direction === 'BULLISH' ? 'DISCOUNT' : 'PREMIUM',
    },
    liquidity: {
      buySideLiquidity: [
        {
          type: 'PDH',
          side: 'BUY_SIDE',
          price: 110,
          availableIndex: 1,
        },
      ],
      sellSideLiquidity: [
        {
          type: 'PDL',
          side: 'SELL_SIDE',
          price: 95,
          availableIndex: 1,
        },
      ],
    },
    bias: {
      direction,
      reasons: [],
      primaryLiquidityTarget: direction === 'BULLISH'
        ? {
          type: 'PDH',
          side: 'BUY_SIDE',
          price: 110,
          availableIndex: 1,
        }
        : {
          type: 'PDL',
          side: 'SELL_SIDE',
          price: 95,
          availableIndex: 1,
        },
    },
  };
}

test('continuous bias periods emit only their first event', () => {
  const neutral = state(0, 'NEUTRAL');
  neutral.bias.direction = 'NEUTRAL';
  neutral.marketStructure.sequence = [];
  const bullish1 = state(1, 'BULLISH');
  const bullish2 = state(2, 'BULLISH');
  const neutral2 = state(3, 'NEUTRAL');
  neutral2.bias.direction = 'NEUTRAL';
  neutral2.marketStructure.sequence = [];
  const bearish1 = state(4, 'BEARISH');
  const bearish2 = state(5, 'BEARISH');
  const events = Validation.extractNarrativeEvents({
    h4: {
      states: [
        neutral,
        bullish1,
        bullish2,
        neutral2,
        bearish1,
        bearish2,
      ],
    },
  });

  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].index, 1);
  assert.strictEqual(events[0].direction, 'BULLISH');
  assert.strictEqual(events[1].index, 4);
  assert.strictEqual(events[1].direction, 'BEARISH');
});

test('opposing sweep must occur before target to count Sweep to Target', () => {
  const bars = createBars(8);
  bars[1].low = 94;
  bars[2].high = 111;
  bars[4].low = 88;
  bars[4].close = 89;
  const states = Array.from({ length: 8 }, (_, index) => ({
    marketStructure: { lastStructureEvent: null },
  }));
  states[4].marketStructure.lastStructureEvent = {
    type: 'BEARISH_MSS',
    availableIndex: 4,
  };
  const event = {
    index: 0,
    direction: 'BULLISH',
    referencePrice: 100,
    recentSellSideLiquidity: {
      side: 'SELL_SIDE',
      type: 'PDL',
      price: 95,
    },
    recentBuySideLiquidity: {
      side: 'BUY_SIDE',
      type: 'PDH',
      price: 110,
    },
    primaryLiquidityTarget: {
      side: 'BUY_SIDE',
      type: 'PDH',
      price: 110,
    },
    protectedLevel: {
      type: 'PROTECTED_LOW',
      price: 90,
    },
  };
  const outcome = Validation.evaluateEvent(
    event,
    bars,
    states,
    24
  );

  assert.strictEqual(outcome.opposingSweepIndex, 1);
  assert.strictEqual(outcome.primaryTargetHitIndex, 2);
  assert.strictEqual(outcome.sweepThenTarget, true);
  assert.strictEqual(outcome.protectedBreakIndex, 4);
  assert.strictEqual(outcome.expectedMssType, 'BEARISH_MSS');
  assert.strictEqual(outcome.expectedMssConfirmed, true);
});

test('premium discount validation uses excursion dominance not close return', () => {
  const events = [
    {
      outcomes: {
        '24h': {
          mfe: 4,
          mae: 2,
          directionalDelivery: true,
          primaryTargetEligible: true,
          primaryTargetHit: true,
        },
      },
    },
    {
      outcomes: {
        '24h': {
          mfe: 1,
          mae: 3,
          directionalDelivery: false,
          primaryTargetEligible: true,
          primaryTargetHit: false,
        },
      },
    },
  ];
  const summary = Validation.summarizePremiumDiscount(events, 24);

  assert.strictEqual(summary.averageMFE, 2.5);
  assert.strictEqual(summary.averageMAE, 2.5);
  assert.strictEqual(summary.directionalDeliveryRate, 0.5);
  assert.strictEqual(summary.liquidityHitRate, 0.5);
});

test('protected level statistics condition MSS accuracy on actual breaks', () => {
  const events = [
    {
      outcomes: {
        '24h': {
          protectedLevelEligible: true,
          protectedLevelBroken: true,
          expectedMssConfirmed: true,
        },
      },
    },
    {
      outcomes: {
        '24h': {
          protectedLevelEligible: true,
          protectedLevelBroken: true,
          expectedMssConfirmed: false,
        },
      },
    },
    {
      outcomes: {
        '24h': {
          protectedLevelEligible: true,
          protectedLevelBroken: false,
          expectedMssConfirmed: false,
        },
      },
    },
  ];
  const summary = Validation.summarizeProtected(events, 24);

  assert.strictEqual(summary.protectedLevelBreaks, 2);
  assert.strictEqual(summary.expectedMssConfirmed, 1);
  assert.strictEqual(summary.mssAccuracy, 0.5);
});

test('future states cannot change already extracted narrative events', () => {
  const bullish = state(0, 'BULLISH');
  const bullish2 = state(1, 'BULLISH');
  const prefixResult = {
    h4: { states: [bullish, bullish2] },
  };
  const bearish = state(2, 'BEARISH');
  const fullResult = {
    h4: { states: [bullish, bullish2, bearish] },
  };
  const prefixEvents = Validation.extractNarrativeEvents(prefixResult);
  const historicalEvents = Validation
    .extractNarrativeEvents(fullResult)
    .filter((event) => event.index < 2);

  assert.deepStrictEqual(historicalEvents, prefixEvents);
});

console.log('\n' + testsPassed + ' tests passed.');
