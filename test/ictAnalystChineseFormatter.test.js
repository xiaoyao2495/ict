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
        ...(options.m15DeliveryStage === undefined
          ? {}
          : {
            m15DeliveryStage:
              options.m15DeliveryStage,
            waitingLiquiditySide:
              options.waitingLiquiditySide || null,
          }),
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
          confirmation:
            options.confirmation === undefined
              ? {
                status: 'CONFIRMED',
                direction: 'BULLISH',
              }
              : options.confirmation,
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
      ...(options.positionContext === undefined
        ? {}
        : {
          positionContext: options.positionContext,
        }),
      ...(options.opportunity === undefined
        ? {}
        : {
          opportunity: options.opportunity,
        }),
      ...(options.structurePhase === undefined
        ? {}
        : {
          structurePhase: options.structurePhase,
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
    '【4小时结构阶段】',
    '状态：UNDETERMINED',
    '下一等待事件：等待方向性4小时结构确认',
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
    '【当前位置】',
    '区域：位置不明确',
    '最近流动性：暂无明确流动性',
    '距离：--',
    '说明：价格位于4H区间位置不明确，' +
      '等待5分钟多头确认路径完成。',
    '4. 当前人工判断',
    '【当前市场环境】',
    '【已完成事件】',
    '【下一步等待路径】',
    '【等待原因】',
  ]) {
    assert.ok(text.includes(field), field);
  }
});

test('4小时结构阶段显示状态来源和下一事件', () => {
  const text = Formatter.format(currentReport({
    structurePhase: {
      state: 'BULLISH_PULLBACK',
      direction: 'BULLISH',
      context: 'POST_MSS',
      sourceEvent: {
        type: 'BULLISH_MSS',
        breakType: 'CLOSE_BREAK',
        level: 51000,
        breakIndex: 8,
        availableIndex: 10,
      },
      mssEvent: {
        type: 'BULLISH_MSS',
        breakType: 'CLOSE_BREAK',
        level: 51000,
        breakIndex: 8,
        availableIndex: 10,
      },
    },
  }));

  for (const expected of [
    '【4小时结构阶段】',
    '状态：BULLISH_PULLBACK',
    '方向：BULLISH',
    '上下文：POST_MSS',
    '当前阶段说明：多头转换回调阶段，等待Bullish BOS',
    '来源MSS：BULLISH_MSS' +
      '（CLOSE_BREAK，结构位：51000）',
    '下一等待事件：等待Bullish BOS',
  ]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.strictEqual(
    text.match(/【4小时结构阶段】/g).length,
    1
  );
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
    confirmation: null,
    observation: {
      state: 'NONE',
      side: null,
    },
  }));

  assert.ok(text.includes('- Bias：中性'));
  assert.ok(text.includes('暂无明确主要流动性目标'));
  assert.ok(text.includes('- 当前观察：暂无'));
  assert.ok(text.includes(
    '【下一步等待路径】\n等待：4小时方向明确'
  ));
  assert.ok(text.includes(
    '【等待原因】\n4小时方向尚未明确，' +
    '暂不建立方向性5分钟等待路径。'
  ));
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

  assert.ok(text.includes(report.current.humanSummary));
  assert.strictEqual(
    text.includes('- 市场状态解读：'),
    false
  );
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

test('Watchlist display supports 4H plus 5m without Delivery', () => {
  const report = currentReport();
  delete report.current.oneHourAnalysis;
  report.current.alignment = {
    status: 'WAITING',
    direction: null,
    reason: '等待5分钟确认',
  };
  const text = Formatter.format(report);

  assert.strictEqual(text.includes('15分钟'), false);
  assert.strictEqual(text.includes('Delivery'), false);
  assert.ok(text.includes('2. 【5分钟确认】'));
  assert.ok(text.includes('3. 当前人工判断'));
});

test('formatter includes the opportunity observation chapter', () => {
  const text = Formatter.format(currentReport({
    opportunity: {
      status: 'WATCH_ZONE',
      direction: 'BULLISH',
      liquidityType: 'PWL',
      price: 99.6,
    },
    confirmation: null,
    sweeps: [],
    mss: null,
    displacement: null,
  }));

  assert.ok(text.includes('【交易机会观察】'));
  assert.ok(text.includes('方向：LONG'));
  assert.ok(text.includes('关注流动性：PWL'));
  assert.ok(text.includes(
    '当前阶段：WATCH_ZONE：等待流动性扫取'
  ));
});

test('5分钟确认不再输出英文事件名称', () => {
  const text = Formatter.format(currentReport());
  const confirmationText = text.slice(
    text.indexOf('【5分钟确认】'),
    text.indexOf('【流动性路线】')
  );

  for (const forbidden of [
    'Sweep',
    'MSS',
    'Displacement',
  ]) {
    assert.strictEqual(
      confirmationText.includes(forbidden),
      false
    );
  }
});

test('流动性路线按 Engine 结果显示类型和距离', () => {
  const text = Formatter.format(currentReport({
    liquidityRoadmap: [
      {
        type: 'PDL',
        timeframe: '1D',
        price: 99.58,
        distanceValue: 0.42,
        distancePercent: 0.42,
        priority: 7,
      },
      {
        type: 'EQUAL_LOW',
        timeframe: '15m',
        price: 99.21,
        distanceValue: 0.79,
        distancePercent: 0.79,
        priority: 5,
      },
      {
        type: 'PWL',
        timeframe: '1W',
        price: 98.75,
        distanceValue: 1.25,
        distancePercent: 1.25,
        priority: 6,
      },
    ],
  }));

  assert.ok(text.includes('【流动性路线】'));
  assert.ok(text.includes(
    '① 昨日低点\n价格：99.58\n距离：0.42（0.42%）'
  ));
  assert.ok(text.includes(
    '② 等低\n价格：99.21\n距离：0.79（0.79%）'
  ));
  assert.ok(text.includes(
    '③ 上周低点\n价格：98.75\n距离：1.25（1.25%）'
  ));
});

test('没有路线目标时显示明确空状态', () => {
  const text = Formatter.format(currentReport({
    liquidityRoadmap: [],
  }));

  assert.ok(text.includes(
    '【流动性路线】\n暂无明确流动性路线。'
  ));
});

test('当前位置显示区域最近流动性距离和说明', () => {
  const context = {
    positionZone: 'PREMIUM',
    nearestLiquidity: {
      type: 'PDL',
      timeframe: '1D',
      price: 99.58,
      side: 'SELL_SIDE',
    },
    distanceValue: 0.42,
    distancePercent: 0.42,
    context:
      '价格位于溢价区，价格接近下方卖方流动性，' +
      '不适合追单。',
  };
  const text = Formatter.format(currentReport({
    positionContext: context,
  }));

  assert.ok(text.includes('【当前位置】'));
  assert.ok(text.includes('区域：溢价区'));
  assert.ok(text.includes('最近流动性：昨日低点'));
  assert.ok(text.includes('价格：99.58'));
  assert.ok(text.includes('距离：0.42（0.42%）'));
  assert.ok(text.includes(
    '说明：4H偏多但价格位于溢价区，' +
    '等待价格完成流动性处理并重新形成5分钟多头确认。'
  ));
  assert.strictEqual(text.includes('不适合追单'), false);
});

test('价格距离按绝对值和百分比共同显示', () => {
  const distancePercent = 1000 / 65000 * 100;
  const text = Formatter.format(currentReport({
    liquidityRoadmap: [{
      type: 'PDH',
      timeframe: '1D',
      price: 66000,
      distanceValue: 1000,
      distancePercent,
      priority: 7,
    }],
    positionContext: {
      positionZone: 'PREMIUM',
      nearestLiquidity: {
        type: 'PDH',
        timeframe: '1D',
        price: 66000,
        side: 'BUY_SIDE',
      },
      distanceValue: 1000,
      distancePercent,
      context: '价格位于溢价区。',
    },
  }));

  assert.ok(text.includes(
    '① 昨日高点\n价格：66000\n距离：1000（1.54%）'
  ));
  assert.ok(text.includes(
    '最近流动性：昨日高点\n价格：66000\n' +
    '距离：1000（1.54%）'
  ));
});

test('最终总结不输出英文交易方向或自动交易建议', () => {
  const text = Formatter.format(currentReport({
    positionContext: {
      positionZone: 'DISCOUNT',
      nearestLiquidity: null,
      distancePercent: null,
      context: '价格位于折价区。',
    },
    liquidityRoadmap: [],
  }));
  const summary = text.slice(text.indexOf('【市场环境】'));

  for (const forbidden of [
    'LONG',
    'SHORT',
    'BUY',
    'SELL',
    '买入',
    '卖出',
    '开仓',
    '下单',
    '自动交易',
  ]) {
    assert.strictEqual(
      summary.includes(forbidden),
      false,
      forbidden
    );
  }
});

console.log('\n' + testsPassed + ' tests passed.');
