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
      ...(options.liquidityRoadmap === undefined
        ? {}
        : {
          liquidityRoadmap: options.liquidityRoadmap,
        }),
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
    '3. 【5分钟确认】',
    '✓ 已扫流动性',
    '类型：5分钟摆动低点',
    '✓ 已确认市场结构向上转换',
    '✓ 已确认向上位移',
    '- 当前观察：潜在偏多观察',
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
  assert.ok(text.includes('- 当前观察：暂无'));
  assert.ok(text.includes('- 偏多/偏空/等待：等待'));
  assert.ok(text.includes('□ 等待流动性扫取'));
  assert.ok(text.includes('□ 等待市场结构转换'));
  assert.ok(text.includes('□ 等待位移确认'));
});

test('formatter shows Sweep price but no execution fields', () => {
  const text = Formatter.format(currentReport());
  assert.strictEqual(text.includes('54321.12'), false);
  assert.strictEqual(text.includes('价格：51234.56'), true);
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
    '✓ 已扫流动性，共7项'
  ));
  assert.ok(text.includes('类型：5分钟摆动低点 ×5'));
  assert.ok(text.includes('类型：等低 ×1'));
  assert.ok(text.includes('类型：1小时摆动低点 ×1'));
  assert.ok(text.includes(
    '最新扫取：\n  类型：1小时摆动低点\n' +
    '  扫取时间：2026-07-27 16:00:00'
  ));
  assert.strictEqual(text.includes('availableIndex'), false);
  assert.deepStrictEqual(report, original);
});

test('a single Sweep shows source price formation and taken time', () => {
  const report = currentReport({
    sweeps: [{
      type: 'LTF_SWING_LOW',
      side: 'SELL_SIDE',
      price: 50123.45,
      pivotTime: Date.UTC(2026, 6, 27, 8),
      availableIndex: 12,
      time: Date.UTC(2026, 6, 27, 9),
    }],
  });
  const text = Formatter.format(report);

  assert.ok(text.includes('✓ 已扫流动性'));
  assert.ok(text.includes('类型：5分钟摆动低点'));
  assert.ok(text.includes('价格：50123.45'));
  assert.ok(text.includes(
    '形成时间：2026-07-27 16:00:00'
  ));
  assert.ok(text.includes(
    '扫取时间：2026-07-27 17:00:00'
  ));
  assert.strictEqual(text.includes('availableIndex'), false);
});

test('15分钟状态使用指定中文映射', () => {
  const cases = [
    {
      deliveryState: 'RETRACEMENT',
      direction: 'NEUTRAL',
      expected: '回调中',
    },
    {
      deliveryState: 'ALIGNED_BULLISH',
      direction: 'BULLISH',
      expected: '开始顺势上涨',
    },
    {
      deliveryState: 'ALIGNED_BEARISH',
      direction: 'BEARISH',
      expected: '开始顺势下跌',
    },
    {
      deliveryState: 'NEUTRAL',
      direction: 'NEUTRAL',
      expected: '方向不明确',
    },
  ];

  for (const item of cases) {
    const report = currentReport({
      h1Direction: item.direction,
      deliveryState: item.deliveryState,
    });
    report.current.fifteenMinuteAnalysis = {
      ...report.current.oneHourAnalysis,
      timeframe: '15m',
    };
    delete report.current.oneHourAnalysis;
    const text = Formatter.format(report);

    assert.ok(text.includes('2. 15分钟状态'));
    assert.ok(text.includes('- 状态：' + item.expected));
  }
});

test('5分钟确认不再输出英文事件名称', () => {
  const text = Formatter.format(currentReport());

  for (const forbidden of [
    'Sweep',
    'MSS',
    'Displacement',
  ]) {
    assert.strictEqual(text.includes(forbidden), false);
  }
});

test('流动性路线按 Engine 结果显示类型和距离', () => {
  const text = Formatter.format(currentReport({
    liquidityRoadmap: [
      {
        type: 'PDL',
        timeframe: '1D',
        price: 99.58,
        distancePercent: 0.42,
        priority: 7,
      },
      {
        type: 'EQUAL_LOW',
        timeframe: '15m',
        price: 99.21,
        distancePercent: 0.79,
        priority: 5,
      },
      {
        type: 'PWL',
        timeframe: '1W',
        price: 98.75,
        distancePercent: 1.25,
        priority: 6,
      },
    ],
  }));

  assert.ok(text.includes('【流动性路线】'));
  assert.ok(text.includes('① 昨日低点（距离0.42%）'));
  assert.ok(text.includes('② 等低（距离0.79%）'));
  assert.ok(text.includes('③ 上周低点（距离1.25%）'));
});

test('没有路线目标时显示明确空状态', () => {
  const text = Formatter.format(currentReport({
    liquidityRoadmap: [],
  }));

  assert.ok(text.includes(
    '【流动性路线】\n暂无明确流动性路线。'
  ));
});

console.log('\n' + testsPassed + ' tests passed.');
