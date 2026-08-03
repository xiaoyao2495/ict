'use strict';

/*
 * Daily Bias Backtest Audit V1（D.1.1）单元测试
 * 全部离线：注入 H4 状态 / 合成 K 线，不访问网络。
 */

const assert = require('assert');
const Audit = require('../backtest/dailyBiasBacktestAudit');

const FIVE_MINUTES = 300000;
const FOUR_HOURS = 14400000;

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function phase(state, values) {
  return {
    state,
    direction: state.indexOf('BULLISH_') === 0
      ? 'BULLISH'
      : state.indexOf('BEARISH_') === 0
        ? 'BEARISH'
        : null,
    context: state.indexOf('PULLBACK') >= 0
      ? 'CONTINUATION'
      : null,
    transitionPending: false,
    ...(values || {}),
  };
}

function h4State(index, closeTime, price, values) {
  values = values || {};
  return {
    index,
    availableIndex: index,
    time: closeTime,
    referencePrice: price,
    narrative: { bias: values.legacyBias || null },
    dealingRange: {
      high: 120,
      low: 80,
      equilibrium: 100,
      location: values.location || 'PREMIUM',
    },
    liquidity: {
      buySideLiquidity: [{
        type: 'PDH',
        side: 'BUY_SIDE',
        price: 125,
        status: 'ACTIVE',
        availableIndex: 8,
      }],
      sellSideLiquidity: [{
        type: 'PDL',
        side: 'SELL_SIDE',
        price: 75,
        status: 'ACTIVE',
        availableIndex: 8,
      }],
      activeLevels: [],
    },
    ...values,
  };
}

function kline5m(index) {
  const openTime = index * FIVE_MINUTES;
  return {
    openTime,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 0,
    closeTime: openTime + FIVE_MINUTES - 1,
  };
}

function trade(entryIndex, type, status, r) {
  return {
    type,
    status,
    entry: 100,
    stop: 99,
    target: 102,
    entryIndex,
    r,
  };
}

/*
 * 4H 状态（注入）:
 *   h4[0] 收盘于 47*5m -> BULLISH_CONTINUATION
 *   h4[1] 收盘于 95*5m -> BEARISH_CONTINUATION
 *   h4[2] 收盘于 143*5m -> BULLISH_MSS（转换）
 */
function taggedFixture() {
  const h4States = [
    h4State(0, 47 * FIVE_MINUTES, 110, {
      location: 'PREMIUM',
      legacyBias: 'NEUTRAL',
    }),
    h4State(1, 95 * FIVE_MINUTES, 90, {
      location: 'DISCOUNT',
      legacyBias: 'NEUTRAL',
    }),
    h4State(2, 143 * FIVE_MINUTES, 110, {
      location: 'PREMIUM',
      legacyBias: 'BEARISH',
    }),
  ];
  const structurePhaseStates = [
    phase('BULLISH_CONTINUATION'),
    phase('BEARISH_CONTINUATION'),
    phase('BULLISH_MSS', {
      context: 'POST_MSS',
      transitionPending: true,
    }),
  ];
  return { h4States, structurePhaseStates };
}

test('alignment matrix matches D.1 definition', () => {
  assert.strictEqual(
    Audit.alignmentOf('BULLISH', 'LONG'),
    Audit.ALIGNMENTS.ALIGNED
  );
  assert.strictEqual(
    Audit.alignmentOf('BEARISH', 'SHORT'),
    Audit.ALIGNMENTS.ALIGNED
  );
  assert.strictEqual(
    Audit.alignmentOf('BULLISH', 'SHORT'),
    Audit.ALIGNMENTS.COUNTER
  );
  assert.strictEqual(
    Audit.alignmentOf('BEARISH', 'LONG'),
    Audit.ALIGNMENTS.COUNTER
  );
  assert.strictEqual(
    Audit.alignmentOf('NEUTRAL', 'LONG'),
    Audit.ALIGNMENTS.TRANSITION
  );
  assert.strictEqual(
    Audit.alignmentOf('NEUTRAL', 'SHORT'),
    Audit.ALIGNMENTS.TRANSITION
  );
});

test('tagTrades tags ALIGNED / COUNTER / TRANSITION / UNTAGGED', () => {
  const { h4States, structurePhaseStates } = taggedFixture();
  const klines5m = Array.from(
    { length: 200 },
    (_, index) => kline5m(index)
  );
  const trades = [
    trade(30, 'LONG', 'WIN', 2),    // 第一个 4H 收盘前 -> UNTAGGED
    trade(60, 'LONG', 'WIN', 2),    // BULLISH + LONG -> ALIGNED
    trade(65, 'SHORT', 'LOSS', -1), // BULLISH + SHORT -> COUNTER
    trade(100, 'SHORT', 'WIN', 2),  // BEARISH + SHORT -> ALIGNED
    trade(110, 'LONG', 'LOSS', -1), // BEARISH + LONG -> COUNTER
    trade(150, 'LONG', 'WIN', 2),   // BULLISH_MSS -> TRANSITION
    trade(160, 'SHORT', 'WIN', 2),  // BULLISH_MSS -> TRANSITION
  ];

  const tagged = Audit.tagTrades({
    trades,
    klines5m,
    h4States,
    structurePhaseStates,
  });

  assert.strictEqual(tagged.length, trades.length);
  const byIndex = Object.fromEntries(
    tagged.map((item) => [item.entryIndex, item])
  );
  assert.strictEqual(
    byIndex[30].alignment,
    Audit.ALIGNMENTS.UNTAGGED
  );
  assert.strictEqual(byIndex[30].htfMarketBias, null);
  assert.strictEqual(
    byIndex[60].alignment,
    Audit.ALIGNMENTS.ALIGNED
  );
  assert.strictEqual(byIndex[60].htfMarketBias, 'BULLISH');
  assert.strictEqual(
    byIndex[65].alignment,
    Audit.ALIGNMENTS.COUNTER
  );
  assert.strictEqual(
    byIndex[100].alignment,
    Audit.ALIGNMENTS.ALIGNED
  );
  assert.strictEqual(byIndex[100].htfMarketBias, 'BEARISH');
  assert.strictEqual(
    byIndex[110].alignment,
    Audit.ALIGNMENTS.COUNTER
  );
  assert.strictEqual(
    byIndex[150].alignment,
    Audit.ALIGNMENTS.TRANSITION
  );
  assert.strictEqual(
    byIndex[150].transitionDirection,
    'BULLISH'
  );
  assert.strictEqual(
    byIndex[160].alignment,
    Audit.ALIGNMENTS.TRANSITION
  );
  tagged.forEach((item) => {
    assert.strictEqual(
      item.biasSourceVersion,
      'daily_bias_v1'
    );
    assert.strictEqual(item.setupDirection, item.type);
  });
});

test('tagTrades drops trades without a matching entry bar', () => {
  const { h4States, structurePhaseStates } = taggedFixture();
  const tagged = Audit.tagTrades({
    trades: [trade(10, 'LONG', 'WIN', 2)],
    klines5m: [],
    h4States,
    structurePhaseStates,
  });

  assert.deepStrictEqual(tagged, []);
});

test('tagTrades does not mutate input trades', () => {
  const { h4States, structurePhaseStates } = taggedFixture();
  const klines5m = Array.from(
    { length: 200 },
    (_, index) => kline5m(index)
  );
  const trades = [
    trade(60, 'LONG', 'WIN', 2),
    trade(150, 'LONG', 'WIN', 2),
  ];
  const snapshot = JSON.stringify({ trades, klines5m });

  Audit.tagTrades({
    trades,
    klines5m,
    h4States,
    structurePhaseStates,
  });

  assert.strictEqual(JSON.stringify({ trades, klines5m }), snapshot);
});

test('summarize computes per-alignment win rate and avg R', () => {
  const { h4States, structurePhaseStates } = taggedFixture();
  const klines5m = Array.from(
    { length: 200 },
    (_, index) => kline5m(index)
  );
  const trades = [
    trade(60, 'LONG', 'WIN', 2),    // ALIGNED
    trade(65, 'SHORT', 'LOSS', -1), // COUNTER
    trade(100, 'SHORT', 'WIN', 2),  // ALIGNED
    trade(110, 'LONG', 'LOSS', -1), // COUNTER
    trade(150, 'LONG', 'WIN', 2),   // TRANSITION
    trade(160, 'SHORT', 'LOSS', -1),// TRANSITION
    trade(30, 'LONG', 'OPEN', null),// UNTAGGED 未收盘，不计
  ];

  const tagged = Audit.tagTrades({
    trades,
    klines5m,
    h4States,
    structurePhaseStates,
  });
  const summary = Audit.summarize(tagged);
  const aligned = summary.byAlignment[Audit.ALIGNMENTS.ALIGNED];
  const counter = summary.byAlignment[Audit.ALIGNMENTS.COUNTER];
  const transition =
    summary.byAlignment[Audit.ALIGNMENTS.TRANSITION];
  const untagged = summary.byAlignment[Audit.ALIGNMENTS.UNTAGGED];

  assert.deepStrictEqual(
    { trades: aligned.trades, win: aligned.win, loss: aligned.loss },
    { trades: 2, win: 2, loss: 0 }
  );
  assert.strictEqual(aligned.winRate, 100);
  assert.strictEqual(aligned.avgR, 2);

  assert.deepStrictEqual(
    { trades: counter.trades, win: counter.win, loss: counter.loss },
    { trades: 2, win: 0, loss: 2 }
  );
  assert.strictEqual(counter.winRate, 0);
  assert.strictEqual(counter.avgR, -1);

  assert.deepStrictEqual(
    { trades: transition.trades, win: transition.win, loss: transition.loss },
    { trades: 2, win: 1, loss: 1 }
  );
  assert.strictEqual(transition.winRate, 50);
  assert.strictEqual(transition.avgR, 0.5);

  assert.strictEqual(untagged.trades, 0);

  // 汇总 = 全部已收盘 trade（含 UNTAGGED 若存在）
  assert.deepStrictEqual(
    { trades: summary.totals.trades, win: summary.totals.win },
    { trades: 6, win: 3 }
  );
  assert.strictEqual(summary.totals.winRate, 50);
  assert.strictEqual(summary.totals.avgR, 0.5);
});

function syntheticH4Klines(count) {
  const bars = [];
  const base = Date.UTC(2025, 0, 1);
  let price = 100;
  for (let index = 0; index < count; index += 1) {
    const direction = index % 2 === 0 ? 1 : -1;
    const open = price;
    const close = open + direction * 0.5;
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    const openTime = base + index * FOUR_HOURS;
    bars.push({
      openTime,
      open,
      high,
      low,
      close,
      volume: 0,
      closeTime: openTime + FOUR_HOURS - 1,
    });
    price = close;
  }
  return bars;
}

test('analyze runs the full production pipeline offline', () => {
  const h4Klines = syntheticH4Klines(100);
  const klines5m = Array.from(
    { length: 500 },
    (_, index) => kline5m(index)
  );
  const trades = [
    trade(10, 'LONG', 'WIN', 2),
    trade(100, 'SHORT', 'LOSS', -1),
    trade(300, 'LONG', 'WIN', 2),
  ];

  const result = Audit.analyze({
    trades,
    klines5m,
    h4Klines,
  });

  assert.strictEqual(
    result.protocol.version,
    'DAILY_BIAS_BACKTEST_AUDIT_V1'
  );
  assert.strictEqual(
    result.protocol.biasSourceVersion,
    'daily_bias_v1'
  );
  assert.strictEqual(result.source.h4Klines, 100);
  assert.strictEqual(result.source.h4States, 100);
  assert.strictEqual(result.trades.length, trades.length);
  result.trades.forEach((item) => {
    assert.ok([
      Audit.ALIGNMENTS.ALIGNED,
      Audit.ALIGNMENTS.COUNTER,
      Audit.ALIGNMENTS.TRANSITION,
      Audit.ALIGNMENTS.UNTAGGED,
    ].includes(item.alignment));
    if (item.alignment !== Audit.ALIGNMENTS.UNTAGGED) {
      assert.ok(
        ['BULLISH', 'BEARISH', 'NEUTRAL'].includes(
          item.htfMarketBias
        )
      );
    }
  });
});

test('formatReport includes the three-way alignment sections', () => {
  const { h4States, structurePhaseStates } = taggedFixture();
  const klines5m = Array.from(
    { length: 200 },
    (_, index) => kline5m(index)
  );
  const result = Audit.analyze({
    trades: [
      trade(60, 'LONG', 'WIN', 2),
      trade(65, 'SHORT', 'LOSS', -1),
      trade(150, 'LONG', 'WIN', 2),
    ],
    klines5m,
    h4States,
    structurePhaseStates,
  });

  const text = Audit.formatReport(result);
  assert(text.includes('HTF ALIGNED:'));
  assert(text.includes('HTF COUNTER:'));
  assert(text.includes('HTF TRANSITION:'));
  assert(text.includes('daily_bias_v1'));
  assert(text.includes('1 trades, Win Rate 100.0%, Avg R +2.00'));
});

test('tag includes location and readiness fields', () => {
  const { h4States, structurePhaseStates } = taggedFixture();
  const klines5m = Array.from(
    { length: 200 },
    (_, index) => kline5m(index)
  );
  const tagged = Audit.tagTrades({
    trades: [
      trade(60, 'LONG', 'WIN', 2),   // BULLISH + PREMIUM -> WAIT
      trade(100, 'SHORT', 'WIN', 2), // BEARISH + DISCOUNT -> WAIT
      trade(150, 'LONG', 'WIN', 2),  // BULLISH_MSS -> NEUTRAL
    ],
    klines5m,
    h4States,
    structurePhaseStates,
  });

  const byIndex = Object.fromEntries(
    tagged.map((item) => [item.entryIndex, item])
  );
  assert.strictEqual(byIndex[60].htfMarketBias, 'BULLISH');
  assert.strictEqual(byIndex[60].htfLocation, 'PREMIUM');
  assert.strictEqual(byIndex[60].htfLocationReadiness, 'WAIT');
  assert.strictEqual(
    byIndex[60].structureState,
    'BULLISH_CONTINUATION'
  );
  assert.strictEqual(byIndex[100].htfMarketBias, 'BEARISH');
  assert.strictEqual(byIndex[100].htfLocation, 'DISCOUNT');
  assert.strictEqual(byIndex[100].htfLocationReadiness, 'WAIT');
  assert.strictEqual(byIndex[150].htfMarketBias, 'NEUTRAL');
  assert.strictEqual(byIndex[150].transitionDirection, 'BULLISH');
  assert.strictEqual(byIndex[150].structureState, 'BULLISH_MSS');
});

test('byDirection groups market bias x setup direction', () => {
  const { h4States, structurePhaseStates } = taggedFixture();
  const klines5m = Array.from(
    { length: 200 },
    (_, index) => kline5m(index)
  );
  const tagged = Audit.tagTrades({
    trades: [
      trade(60, 'LONG', 'WIN', 2),    // BULLISH+LONG
      trade(65, 'SHORT', 'LOSS', -1), // BULLISH+SHORT
      trade(100, 'SHORT', 'WIN', 2),  // BEARISH+SHORT
      trade(110, 'LONG', 'LOSS', -1), // BEARISH+LONG
    ],
    klines5m,
    h4States,
    structurePhaseStates,
  });

  const rows = Audit.byDirection(tagged);
  const byKey = Object.fromEntries(
    rows.map((row) => [row.key, row])
  );
  assert.deepStrictEqual(
    byKey['BULLISH+LONG'].trades, 1
  );
  assert.strictEqual(byKey['BULLISH+LONG'].win, 1);
  assert.strictEqual(byKey['BULLISH+SHORT'].trades, 1);
  assert.strictEqual(byKey['BEARISH+SHORT'].trades, 1);
  assert.strictEqual(byKey['BEARISH+LONG'].trades, 1);
  assert.strictEqual(byKey['BEARISH+LONG'].winRate, 0);
  assert.strictEqual(byKey['BULLISH+LONG'].avgR, 2);
});

test('byLocation groups market bias x location x readiness', () => {
  const { h4States, structurePhaseStates } = taggedFixture();
  const klines5m = Array.from(
    { length: 200 },
    (_, index) => kline5m(index)
  );
  const tagged = Audit.tagTrades({
    trades: [
      trade(60, 'LONG', 'WIN', 2),   // BULLISH+PREMIUM+WAIT
      trade(65, 'LONG', 'LOSS', -1), // BULLISH+PREMIUM+WAIT
    ],
    klines5m,
    h4States,
    structurePhaseStates,
  });

  const rows = Audit.byLocation(tagged);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].key, 'BULLISH+PREMIUM+WAIT');
  assert.deepStrictEqual(
    { trades: rows[0].trades, win: rows[0].win },
    { trades: 2, win: 1 }
  );
  assert.strictEqual(rows[0].winRate, 50);
});

test('transitionDetail groups transition phase direction', () => {
  const { h4States, structurePhaseStates } = taggedFixture();
  const klines5m = Array.from(
    { length: 200 },
    (_, index) => kline5m(index)
  );
  const tagged = Audit.tagTrades({
    trades: [
      trade(150, 'LONG', 'WIN', 2),
      trade(160, 'SHORT', 'LOSS', -1),
    ],
    klines5m,
    h4States,
    structurePhaseStates,
  });

  const rows = Audit.transitionDetail(tagged);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].key, 'BULLISH_MSS -> BULLISH');
  assert.deepStrictEqual(
    { trades: rows[0].trades, win: rows[0].win },
    { trades: 2, win: 1 }
  );
});

test('combine aggregates multiple symbols', () => {
  const { h4States, structurePhaseStates } = taggedFixture();
  const klines5m = Array.from(
    { length: 200 },
    (_, index) => kline5m(index)
  );
  const btc = Audit.analyze({
    symbol: 'BTCUSDT',
    trades: [
      trade(60, 'LONG', 'WIN', 2),
      trade(150, 'LONG', 'LOSS', -1),
    ],
    klines5m,
    h4States,
    structurePhaseStates,
  });
  const eth = Audit.analyze({
    symbol: 'ETHUSDT',
    trades: [
      trade(100, 'SHORT', 'WIN', 2),
      trade(30, 'LONG', 'WIN', 2), // UNTAGGED
    ],
    klines5m,
    h4States,
    structurePhaseStates,
  });

  const combined = Audit.combine([btc, eth]);

  assert.strictEqual(combined.source.symbols, 2);
  assert.strictEqual(
    combined.source.trades,
    btc.source.trades + eth.source.trades
  );
  assert.strictEqual(
    combined.source.tagged,
    btc.source.tagged + eth.source.tagged
  );
  assert.strictEqual(
    combined.totals.trades,
    btc.totals.trades + eth.totals.trades
  );
  assert.strictEqual(
    combined.totals.win,
    btc.totals.win + eth.totals.win
  );
  assert.strictEqual(combined.perSymbol.length, 2);
  assert.strictEqual(combined.perSymbol[0].symbol, 'BTCUSDT');
  assert.strictEqual(combined.perSymbol[1].symbol, 'ETHUSDT');
});

test('analyzeSymbols runs the full pipeline for multiple symbols', () => {
  const h4Klines = syntheticH4Klines(100);
  const klines5m = Array.from(
    { length: 500 },
    (_, index) => kline5m(index)
  );
  const combined = Audit.analyzeSymbols({
    symbols: [
      {
        symbol: 'BTCUSDT',
        trades: [
          trade(10, 'LONG', 'WIN', 2),
          trade(100, 'SHORT', 'LOSS', -1),
        ],
        klines5m,
        h4Klines,
      },
      {
        symbol: 'ETHUSDT',
        trades: [trade(300, 'LONG', 'WIN', 2)],
        klines5m,
        h4Klines,
      },
    ],
  });

  assert.strictEqual(
    combined.protocol.version,
    'DAILY_BIAS_BACKTEST_AUDIT_MULTI_V1'
  );
  assert.strictEqual(combined.source.symbols, 2);
  assert.strictEqual(combined.trades.length, 3);
  assert.strictEqual(combined.perSymbol.length, 2);
  assert.strictEqual(combined.perSymbol[0].symbol, 'BTCUSDT');
  assert.strictEqual(combined.perSymbol[1].symbol, 'ETHUSDT');
});

test('formatMultiReport includes combined and per-symbol sections', () => {
  const { h4States, structurePhaseStates } = taggedFixture();
  const klines5m = Array.from(
    { length: 200 },
    (_, index) => kline5m(index)
  );
  const combined = Audit.combine([
    Audit.analyze({
      symbol: 'BTCUSDT',
      trades: [trade(60, 'LONG', 'WIN', 2)],
      klines5m,
      h4States,
      structurePhaseStates,
    }),
    Audit.analyze({
      symbol: 'ETHUSDT',
      trades: [trade(150, 'LONG', 'LOSS', -1)],
      klines5m,
      h4States,
      structurePhaseStates,
    }),
  ]);

  const text = Audit.formatMultiReport(combined);
  assert(text.includes('总体（全部市场合并）'));
  assert(text.includes('HTF ALIGNED:'));
  assert(text.includes('HTF Direction x LTF Direction:'));
  assert(text.includes('HTF Location x Readiness:'));
  assert(text.includes('TRANSITION 明细'));
  assert(text.includes('===== BTCUSDT ====='));
  assert(text.includes('===== ETHUSDT ====='));
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
