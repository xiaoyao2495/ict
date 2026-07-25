'use strict';

const assert = require('assert');
const HTFBiasEngine = require('../indicators/htfBiasEngine');

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

function createH1Bars(length) {
  const start = Date.UTC(2023, 0, 2);
  return Array.from({ length }, (_, index) => {
    const center =
      100 +
      Math.sin(index / 8) * 10 +
      Math.sin(index / 3) * 2 +
      index * 0.01;
    const open = center - Math.sin(index / 2);
    const close = center + Math.cos(index / 4);
    return {
      openTime: start + index * HTFBiasEngine.ONE_HOUR,
      closeTime:
        start + (index + 1) * HTFBiasEngine.ONE_HOUR - 1,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1,
    };
  });
}

function aggregateH4(h1Bars) {
  const result = [];
  for (let index = 0; index + 3 < h1Bars.length; index += 4) {
    const group = h1Bars.slice(index, index + 4);
    result.push({
      openTime: group[0].openTime,
      closeTime: group[3].closeTime,
      open: group[0].open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: group[3].close,
      volume: 4,
    });
  }
  return result;
}

test('confirmed swings are causal and never replaced by future swings', () => {
  const h1 = createH1Bars(24 * 30);
  const h4 = aggregateH4(h1);
  const prefixLength = 120;
  const prefix = HTFBiasEngine.buildStructureTimeline(
    h4.slice(0, prefixLength)
  );
  const full = HTFBiasEngine.buildStructureTimeline(h4);
  const historical = full.swings.filter(
    (swing) => swing.availableIndex < prefixLength
  );

  assert.deepStrictEqual(historical, prefix.swings);
  assert.ok(prefix.swings.every(
    (swing) => swing.availableIndex >= swing.index
  ));
});

test('liquidity remains active until its sweep is actually available', () => {
  const start = Date.UTC(2024, 0, 1);
  const bars = Array.from({ length: 5 }, (_, index) => ({
    openTime: start + index * HTFBiasEngine.FOUR_HOURS,
    closeTime:
      start + (index + 1) * HTFBiasEngine.FOUR_HOURS - 1,
    open: 100,
    high: index === 4 ? 115 : 105,
    low: 95,
    close: 100,
  }));
  const levels = HTFBiasEngine.applyLiquidityLifecycle([
    {
      type: 'PDH',
      side: 'BUY_SIDE',
      price: 110,
      formedIndex: 0,
      availableIndex: 1,
      status: 'ACTIVE',
      sweptIndex: null,
    },
  ], bars);

  const before = HTFBiasEngine.projectLiquidity(levels, 3, 100);
  const after = HTFBiasEngine.projectLiquidity(levels, 4, 100);

  assert.strictEqual(before.buySideLiquidity.length, 1);
  assert.strictEqual(before.buySideLiquidity[0].status, 'ACTIVE');
  assert.strictEqual(after.buySideLiquidity.length, 0);
});

test('bias requires structure and dealing-range location alignment', () => {
  const liquidity = {
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
        price: 90,
        availableIndex: 1,
      },
    ],
  };

  assert.strictEqual(
    HTFBiasEngine.resolveBias(
      'BULLISH',
      { location: 'DISCOUNT' },
      liquidity,
      100
    ).direction,
    'BULLISH'
  );
  assert.strictEqual(
    HTFBiasEngine.resolveBias(
      'BULLISH',
      { location: 'PREMIUM' },
      liquidity,
      100
    ).direction,
    'NEUTRAL'
  );
  assert.strictEqual(
    HTFBiasEngine.resolveBias(
      'BEARISH',
      { location: 'PREMIUM' },
      liquidity,
      100
    ).direction,
    'BEARISH'
  );
});

test('primary target uses fixed ICT liquidity priority and active side', () => {
  const target = HTFBiasEngine.selectPrimaryTarget([
    {
      type: 'H4_SWING_HIGH',
      side: 'BUY_SIDE',
      price: 105,
      availableIndex: 2,
    },
    {
      type: 'PDH',
      side: 'BUY_SIDE',
      price: 110,
      availableIndex: 1,
    },
    {
      type: 'PWH',
      side: 'BUY_SIDE',
      price: 120,
      availableIndex: 0,
    },
  ], 100);

  assert.strictEqual(target.type, 'PWH');
  assert.strictEqual(target.side, 'BUY_SIDE');
  assert.strictEqual(target.price, 120);
});

test('combined 4H and 1H snapshots satisfy prefix invariance', () => {
  const fullH1 = createH1Bars(24 * 30);
  const fullH4 = aggregateH4(fullH1);
  const prefixH1 = fullH1.slice(0, 24 * 20);
  const prefixH4 = aggregateH4(prefixH1);
  const prefix = HTFBiasEngine.analyze({
    h4Klines: prefixH4,
    h1Klines: prefixH1,
  });
  const full = HTFBiasEngine.analyze({
    h4Klines: fullH4,
    h1Klines: fullH1,
  });
  const end = prefix.snapshots[prefix.snapshots.length - 1].timestamp;

  assert.deepStrictEqual(
    full.snapshots.filter((snapshot) => snapshot.timestamp <= end),
    prefix.snapshots
  );
  assert.deepStrictEqual(
    full.h4.states.slice(0, prefix.h4.states.length),
    prefix.h4.states
  );
});

test('future bars cannot alter an already published 4H bias', () => {
  const fullH1 = createH1Bars(24 * 25);
  const fullH4 = aggregateH4(fullH1);
  const prefixLength = 100;
  const prefixH4 = fullH4.slice(0, prefixLength);
  const prefixH1 = fullH1.slice(0, prefixLength * 4);
  const prefix = HTFBiasEngine.analyze({
    h4Klines: prefixH4,
    h1Klines: prefixH1,
  });
  const full = HTFBiasEngine.analyze({
    h4Klines: fullH4,
    h1Klines: fullH1,
  });

  assert.deepStrictEqual(
    full.h4.states[prefixLength - 1].bias,
    prefix.h4.states[prefixLength - 1].bias
  );
});

test('changing 1H delivery cannot change the 4H bias history', () => {
  const h1 = createH1Bars(24 * 20);
  const changedH1 = JSON.parse(JSON.stringify(h1));
  const h4 = aggregateH4(h1);
  for (let index = 0; index < changedH1.length; index += 1) {
    changedH1[index].close += Math.sin(index) * 20;
    changedH1[index].high = Math.max(
      changedH1[index].high,
      changedH1[index].close + 1
    );
    changedH1[index].low = Math.min(
      changedH1[index].low,
      changedH1[index].close - 1
    );
  }

  const original = HTFBiasEngine.analyze({
    h4Klines: h4,
    h1Klines: h1,
  });
  const changed = HTFBiasEngine.analyze({
    h4Klines: h4,
    h1Klines: changedH1,
  });

  assert.deepStrictEqual(original.h4, changed.h4);
  assert.strictEqual(original.protocol.h1CanModifyH4Bias, false);
});

console.log('\n' + testsPassed + ' tests passed.');
