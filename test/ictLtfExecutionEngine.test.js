'use strict';

const assert = require('assert');
const Ltf = require('../indicators/ictLtfExecutionEngine');
const Experiment = require(
  '../backtest/ictLtfExecutionExperiment'
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

function createBars(length) {
  const start = Date.UTC(2023, 0, 2);
  return Array.from({ length }, (_, index) => {
    const center =
      100 +
      Math.sin(index / 7) * 4 +
      Math.sin(index / 2.3);
    const open = center - 0.4;
    const close = center + 0.4;
    return {
      openTime: start + index * Ltf.FIVE_MINUTES,
      closeTime:
        start + (index + 1) * Ltf.FIVE_MINUTES - 1,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1,
    };
  });
}

function h4Snapshot(time) {
  return {
    index: 0,
    availableIndex: 0,
    time,
    structure: { state: 'BULLISH' },
    narrative: {
      bias: 'BULLISH',
      primaryDraw: {
        side: 'BUY_SIDE',
        type: 'PDH',
        price: 120,
      },
    },
    liquidity: {
      buySideLiquidity: [{
        type: 'PDH',
        side: 'BUY_SIDE',
        price: 120,
        availableIndex: 0,
      }],
      sellSideLiquidity: [{
        type: 'PDL',
        side: 'SELL_SIDE',
        price: 90,
        availableIndex: 0,
      }],
    },
  };
}

function h1Snapshot(time) {
  return {
    index: 0,
    availableIndex: 0,
    time,
    deliveryDirection: 'BULLISH',
    deliveryState: 'ALIGNED_BULLISH',
    relationToH4: 'ALIGNED',
  };
}

test('liquidity sweep is published only on the sweep candle', () => {
  const bars = createBars(7);
  bars[1].high = 104;
  bars[2].high = 106;
  const levels = Ltf.applyLiquidityLifecycle([{
    id: 'test',
    type: 'LTF_SWING_HIGH',
    side: 'BUY_SIDE',
    price: 105,
    source: 'INTERNAL',
    formedIndex: 0,
    availableIndex: 1,
    sweepStartIndex: 1,
    sweptIndex: null,
  }], bars);
  const timeline = Ltf.buildLiquidityTimeline(levels, bars);

  assert.strictEqual(timeline.snapshots[1].activeLevels.length, 1);
  assert.strictEqual(
    timeline.snapshots[1].currentSweeps.length,
    0
  );
  assert.strictEqual(
    timeline.snapshots[2].currentSweeps.length,
    1
  );
  assert.strictEqual(
    timeline.snapshots[2].currentSweeps[0].status,
    'SWEPT'
  );
  assert.strictEqual(
    timeline.snapshots[1].sweptLevels.length,
    0
  );
});

test('MSS requires prior opposite-side sweep and displacement break', () => {
  const bar = {
    close: 106,
    closeTime: Date.UTC(2023, 0, 2, 1),
  };
  const displacement = {
    direction: 'BULLISH',
    strength: 2,
  };
  const structure = {
    swingSequence: [{
      label: 'LH',
      price: 105,
      index: 1,
      availableIndex: 3,
    }],
  };
  const sweep = {
    side: 'SELL_SIDE',
    index: 2,
    time: Date.UTC(2023, 0, 2, 0, 30),
  };
  const mss = Ltf.confirmMss({
    displacement,
    pendingSweep: sweep,
    structure,
    bar,
    index: 4,
  });

  assert.strictEqual(mss.direction, 'BULLISH');
  assert.strictEqual(mss.level.label, 'LH');
  assert.strictEqual(
    Ltf.confirmMss({
      displacement,
      pendingSweep: { ...sweep, index: 4 },
      structure,
      bar,
      index: 4,
    }),
    null
  );
});

test('displacement requires body ratio expansion and consecutive bars', () => {
  const bars = createBars(24);
  for (let index = 0; index < 22; index += 1) {
    bars[index].open = 100;
    bars[index].close = index === 21 ? 101.4 : 100.4;
    bars[index].high = index === 21 ? 101.5 : 101;
    bars[index].low = 99.5;
  }
  bars[22].open = 101;
  bars[22].close = 105;
  bars[22].high = 105.2;
  bars[22].low = 100.8;

  const displacement = Ltf.detectDisplacement(bars, 22);
  assert.strictEqual(displacement.direction, 'BULLISH');
  assert.ok(displacement.bodyRatio >= 0.65);
  assert.ok(displacement.rangeExpansion >= 1.5);
  assert.strictEqual(displacement.consecutive, true);
});

test('FVG is created only after the third candle closes', () => {
  const bars = createBars(3);
  bars[0].high = 101;
  bars[2].low = 103;
  const fvg = Ltf.detectFvg(bars, 2);

  assert.strictEqual(Ltf.detectFvg(bars, 1), null);
  assert.strictEqual(fvg.direction, 'BULLISH');
  assert.strictEqual(fvg.bottom, 101);
  assert.strictEqual(fvg.top, 103);
  assert.strictEqual(fvg.createdAt, bars[2].closeTime);
});

test('LTF execution snapshots satisfy prefix invariance', () => {
  const bars = createBars(240);
  const h4 = [h4Snapshot(bars[0].closeTime)];
  const h1 = [h1Snapshot(bars[0].closeTime)];
  const prefixLength = 160;
  const prefix = Ltf.analyze({
    ltfKlines: bars.slice(0, prefixLength),
    h4BiasSnapshots: h4,
    h1DeliverySnapshots: h1,
  });
  const full = Ltf.analyze({
    ltfKlines: bars,
    h4BiasSnapshots: h4,
    h1DeliverySnapshots: h1,
  });

  assert.deepStrictEqual(
    full.states.filter(
      (state) => state.availableIndex < prefixLength
    ),
    prefix.states
  );
});

test('LTF analysis cannot mutate HTF snapshots or create orders', () => {
  const bars = createBars(120);
  const h4 = [h4Snapshot(bars[0].closeTime)];
  const h1 = [h1Snapshot(bars[0].closeTime)];
  const h4Before = JSON.parse(JSON.stringify(h4));
  const h1Before = JSON.parse(JSON.stringify(h1));
  const result = Ltf.analyze({
    ltfKlines: bars,
    h4BiasSnapshots: h4,
    h1DeliverySnapshots: h1,
  });

  assert.deepStrictEqual(h4, h4Before);
  assert.deepStrictEqual(h1, h1Before);
  assert.strictEqual(result.protocol.canModifyHtf, false);
  assert.strictEqual(result.protocol.generatesEntry, false);
  assert.ok(result.states.every((state) => (
    !Object.prototype.hasOwnProperty.call(state, 'entry') &&
    !Object.prototype.hasOwnProperty.call(state, 'stop') &&
    !Object.prototype.hasOwnProperty.call(state, 'target')
  )));
});

test('FVG mitigation summary separates eventual and horizon rates', () => {
  const result = Experiment.summarizeFvg(
    [{
      id: 'fvg-1',
      index: 2,
      createdAt: Date.UTC(2023, 0, 2),
    }],
    [{
      id: 'fvg-1',
      index: 4,
    }],
    [24],
    Ltf.FIFTEEN_MINUTES,
    200
  );

  assert.strictEqual(result.created, 1);
  assert.strictEqual(result.eventuallyMitigated, 1);
  assert.strictEqual(result.eventualMitigationRate, 1);
  assert.strictEqual(result.byHorizon['24h'].mitigated, 1);
});

console.log('\n' + testsPassed + ' tests passed.');
