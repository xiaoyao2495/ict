'use strict';

const assert = require('assert');
const Formatter = require(
  '../formatters/ictAnalystChineseFormatter'
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

function currentReport(options) {
  options = options || {};
  return {
    current: {
      asOf: options.asOf === undefined
        ? Date.UTC(2026, 6, 28, 0)
        : options.asOf,
      fourHourAnalysis: {
        currentStructure:
          options.h4Structure || 'BULLISH',
        confirmedSwingSequence: [
          { label: 'HH' },
          { label: 'HL' },
        ],
        bias: options.h4Bias || 'BULLISH',
        premiumDiscount:
          options.location || 'DISCOUNT',
        primaryDraw: options.primaryDraw === undefined
          ? {
            type: 'PWH',
            side: 'BUY_SIDE',
            price: 54321.12,
          }
          : options.primaryDraw,
      },
      oneHourAnalysis: {
        deliveryDirection:
          options.h1Direction || 'BULLISH',
        deliveryState:
          options.deliveryState || 'ALIGNED_BULLISH',
        relationToH4:
          options.relation || 'ALIGNED',
      },
      fiveMinuteObservation: {
        currentConfirmed: {
          liquiditySweeps: options.sweeps || [{
            type: 'LTF_SWING_LOW',
            side: 'SELL_SIDE',
            price: 51234.56,
          }],
          displacement:
            options.displacement === undefined
              ? { direction: 'BULLISH', strength: 1.5 }
              : options.displacement,
          mss: options.mss === undefined
            ? { direction: 'BULLISH' }
            : options.mss,
        },
        potentialObservation: options.observation || {
          state: 'POTENTIAL_LONG_OBSERVATION',
          side: 'LONG',
        },
      },
    },
  };
}

test('Chinese message contains every required fixed field', () => {
  const text = Formatter.format(currentReport());
  for (const field of [
    '【ICT市场分析】',
    '时间：2026-07-28 08:00:00',
    '1. 4H HTF Bias',
    '- 结构：',
    '- Bias：',
    '- 主要流动性目标：',
    '- Premium/Discount：',
    '2. 1H Delivery',
    '- 当前方向：',
    '- 与4H关系：',
    '- 当前阶段解释：',
    '3. 5m Confirmation',
    '- Sweep：',
    '- Displacement：',
    '- MSS：',
    '- Potential Long/Short/None：',
    '4. 当前人工判断',
    '- 偏多/偏空/等待：',
    '- 关注原因：',
  ]) {
    assert.ok(text.includes(field), field);
  }
});

test('Neutral report produces a waiting judgment', () => {
  const text = Formatter.format(currentReport({
    h4Structure: 'NEUTRAL',
    h4Bias: 'NEUTRAL',
    h1Direction: 'NEUTRAL',
    deliveryState: 'NEUTRAL',
    relation: 'UNCLEAR',
    location: 'EQUILIBRIUM',
    primaryDraw: null,
    sweeps: [],
    displacement: null,
    mss: null,
    observation: {
      state: 'NONE',
      side: null,
    },
  }));

  assert.ok(text.includes('- Bias：中性'));
  assert.ok(text.includes('暂无明确主要流动性目标'));
  assert.ok(text.includes('Potential Long/Short/None：None'));
  assert.ok(text.includes('- 偏多/偏空/等待：等待'));
  assert.ok(text.includes(
    '当前5m收盘未确认新的流动性扫取'
  ));
});

test('formatter never exposes prices or execution fields', () => {
  const text = Formatter.format(currentReport());
  assert.strictEqual(text.includes('54321.12'), false);
  assert.strictEqual(text.includes('51234.56'), false);
  for (const forbidden of [
    'Entry',
    'Stop',
    'Target',
    '仓位',
    '自动交易',
    '开仓',
    '下单',
  ]) {
    assert.strictEqual(
      text.includes(forbidden),
      false,
      forbidden
    );
  }
});

test('formatter also accepts the current snapshot directly', () => {
  const report = currentReport();
  assert.strictEqual(
    Formatter.format(report.current),
    Formatter.format(report)
  );
});

test('formatter includes the human market-state summary', () => {
  const report = currentReport();
  report.current.humanSummary =
    '4H结构保持多头，1H正在顺应4H方向交付，' +
    '但5m尚未出现新的同向确认。';
  const text = Formatter.format(report);

  assert.ok(text.includes('- 市场状态解读：'));
  assert.ok(text.includes(report.current.humanSummary));
});

test('repeated Sweeps are grouped without mutating report data', () => {
  const baseTime = Date.UTC(2026, 6, 27, 8);
  const sweeps = [
    ...Array.from({ length: 5 }, (_, index) => ({
      type: 'LTF_SWING_LOW',
      side: 'SELL_SIDE',
      availableIndex: index + 1,
      time: baseTime + index,
    })),
    {
      type: 'EQUAL_LOW',
      side: 'SELL_SIDE',
      availableIndex: 6,
      time: baseTime + 5,
    },
    {
      type: 'H1_SWING_LOW',
      side: 'SELL_SIDE',
      availableIndex: 7,
      time: baseTime + 6,
    },
  ];
  const report = currentReport({ sweeps });
  const original = JSON.parse(JSON.stringify(report));
  const text = Formatter.format(report);

  assert.ok(text.includes(
    'Sweep：已确认扫取卖方流动性，共7个事件'
  ));
  assert.ok(text.includes('LTF Swing Low ×5'));
  assert.ok(text.includes('等低流动性 ×1'));
  assert.ok(text.includes('1H Swing Low ×1'));
  assert.ok(text.includes(
    '最新事件：1H Swing Low，availableIndex：7，时间：' +
    '2026-07-27 16:00:00'
  ));
  assert.deepStrictEqual(report, original);
});

test('a single Sweep remains a concise one-line description', () => {
  const report = currentReport({
    sweeps: [{
      type: 'LTF_SWING_LOW',
      side: 'SELL_SIDE',
      availableIndex: 12,
      time: Date.UTC(2026, 6, 27, 9),
    }],
  });
  const sweepLine = Formatter.format(report)
    .split('\n')
    .find((line) => line.startsWith('- Sweep：'));

  assert.ok(sweepLine.includes('LTF Swing Low'));
  assert.ok(sweepLine.includes('availableIndex：12'));
  assert.strictEqual(sweepLine.includes('共1个事件'), false);
});

console.log('\n' + testsPassed + ' tests passed.');
