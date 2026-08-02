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
      ...(options.opportunity === null
        ? {}
        : {
          opportunity: options.opportunity || {
            status: 'WATCH_ZONE',
            direction: 'BULLISH',
            liquidityType: 'LTF_SWING_LOW',
            price: 51234.56,
          },
        }),
      ...(options.structurePhase === undefined
        ? {}
        : {
          structurePhase: options.structurePhase,
        }),
      ...(options.decisionGate === undefined
        ? {}
        : {
          decisionGate: options.decisionGate,
        }),
    },
  };
}

test('Chinese message contains every required fixed field', () => {
  const text = Formatter.format(currentReport());
  for (const field of [
    '【ICT市场分析】',
    '时间：2026-07-28 08:00:00',
    '【交易监控面板】',
    '① 【HTF】',
    'Bias：Bullish',
    'Structure：Undetermined',
    'Alignment：Undetermined',
    '位置：位置不明确',
    '【交易机会】',
    '方向：LONG',
    '当前阶段：READY',
    '② 【Entry Watch】',
    '③ 【Event Chain】',
    '✓ Sweep 5m Swing Low',
    '✓ Bullish MSS',
    '✓ Bullish Displacement',
    '状态：READY',
    '④ 【Primary Draw】',
    'PWH',
    '54321.12',
    '⑤ 【Liquidity Roadmap】',
  ]) {
    assert.ok(text.includes(field), field);
  }
  for (const removed of [
    '【当前位置】',
    '【下一步等待路径】',
    '【等待原因】',
  ]) {
    assert.strictEqual(text.includes(removed), false);
  }
});

test('4小时结构阶段以监控面板状态显示', () => {
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
    '① 【HTF】',
    'Structure：Bullish Pullback',
  ]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.strictEqual(
    text.includes('来源MSS：'),
    false
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

  assert.ok(text.includes('Bias：Neutral'));
  assert.ok(text.includes('方向：NONE'));
  assert.ok(text.includes('当前阶段：WAITING'));
  assert.ok(text.includes('暂停，等待4H方向明确'));
  assert.ok(text.includes('③ 【Event Chain】\n暂停'));
  assert.strictEqual(text.includes('等待 Sweep'), false);
  assert.strictEqual(text.includes('□ Sweep'), false);
  assert.ok(text.includes('暂无明确目标'));
});

test('formatter shows Sweep price but no execution fields', () => {
  const text = Formatter.format(currentReport());
  assert.strictEqual(text.includes('54321.12'), true);
  assert.strictEqual(text.includes('价格：51234.56'), true);
  for (const forbidden of [
    'Stop',
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

test('formatter rebuilds dashboard from structured data', () => {
  const report = currentReport();
  report.current.humanSummary =
    '4H结构保持多头，1H正在顺应4H方向交付，' +
    '但5m尚未出现新的同向确认。';
  const text = Formatter.format(report);

  assert.strictEqual(
    text.includes(report.current.humanSummary),
    false
  );
  assert.ok(text.includes('【交易监控面板】'));
  assert.strictEqual(
    text.includes('- 市场状态解读：'),
    false
  );
});

test('event chain uses the latest directional Sweep without mutation', () => {
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

  assert.ok(text.includes('✓ Sweep H1 Swing Low'));
  assert.strictEqual(text.includes('availableIndex'), false);
  assert.deepStrictEqual(report, original);
});

test('a single Sweep shows source type and price', () => {
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

  assert.ok(text.includes('✓ Sweep 5m Swing Low'));
  assert.ok(text.includes('价格：50123.45'));
  assert.strictEqual(text.includes('形成时间：'), false);
  assert.strictEqual(text.includes('扫取时间：'), false);
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
  assert.ok(text.includes('① 【HTF】'));
  assert.ok(text.includes('③ 【Event Chain】'));
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

  assert.ok(text.includes('【交易机会】'));
  assert.ok(text.includes('方向：LONG'));
  assert.ok(text.includes('当前阶段：WATCH_ZONE'));
  assert.ok(text.includes(
    '② 【Entry Watch】\n等待：\nPWL\n99.6'
  ));
});

test('formatter forwards Decision Gate without duplicate sections', () => {
  const text = Formatter.format(currentReport({
    opportunity: {
      status: 'WAITING',
      direction: 'BEARISH',
    },
    sweeps: [],
    mss: null,
    displacement: null,
    confirmation: null,
    decisionGate: {
      state: 'WATCH_ZONE',
      direction: 'BULLISH',
      activeOpportunity: {
        direction: 'BULLISH',
        liquidityType: 'EQUAL_LOW',
        price: 50100,
      },
      progress: {
        sweepCompleted: false,
        mssCompleted: false,
        displacementCompleted: false,
      },
      blockers: ['WAITING_LTF_CONFIRMATION'],
      reasonCode: 'OPPORTUNITY_ACTIVE',
    },
  }));

  assert.strictEqual(
    (text.match(/【Decision Gate】/g) || []).length,
    1
  );
  assert.ok(text.includes('当前阶段：WATCH_ZONE'));
  assert.ok(text.includes('Equal Low\n50100'));
});

test('Decision Gate通知使用中文交易观察语言', () => {
  const report = currentReport({
    decisionGate: {
      state: 'WATCH_ZONE',
      direction: 'BULLISH',
      activeOpportunity: {
        id: 'BULLISH|EQUAL_LOW|62782',
        direction: 'BULLISH',
        liquidityType: 'EQUAL_LOW',
        price: 62782,
      },
      progress: {},
      blockers: ['WAITING_LTF_CONFIRMATION'],
      reasonCode: 'OPPORTUNITY_ACTIVE',
      transition: {
        changed: true,
        from: 'WAITING_OPPORTUNITY',
        to: 'WATCH_ZONE',
      },
    },
  });
  report.symbol = 'BTCUSDT';
  const text = Formatter.formatNotificationChange(
    report,
    ['DECISION_GATE_TRANSITION'],
    {
      symbol: 'BTCUSDT',
      decisionGateTransition: {
        changed: true,
        from: 'WAITING_OPPORTUNITY',
        to: 'WATCH_ZONE',
        direction: 'BULLISH',
        reasonCode: 'OPPORTUNITY_ACTIVE',
        activeOpportunity: {
          id: 'BULLISH|EQUAL_LOW|62782',
          direction: 'BULLISH',
          liquidityType: 'EQUAL_LOW',
          price: 62782,
        },
      },
    }
  );

  for (const expected of [
    '🔔 BTCUSDT 机会更新',
    '时间：\n2026-07-28 08:00:00',
    '状态：\n🟡 观察区（Watch Zone）',
    '变化：\n等待流动性机会 → 进入观察区域',
    '方向：\n🟢 偏多',
    '原因：\n发现潜在机会区域',
    '流动性位置：\n📍 等低点（卖方流动性）',
    '价格：\n62782',
    '当前阶段：\n等待流动性被扫取',
    '✅ 流动性位置已发现：等低点（卖方流动性）',
    '⏳ 5分钟看涨 MSS',
    '1. 是否扫取62782下方流动性',
  ]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.strictEqual(text.includes('reasonCode'), false);
  assert.strictEqual(
    text.includes('BULLISH|EQUAL_LOW|62782'),
    false
  );
});

test('偏空等高通知显示自然方向与流动性描述', () => {
  const report = currentReport({
    decisionGate: {
      state: 'WATCH_ZONE',
      direction: 'BEARISH',
      activeOpportunity: {
        direction: 'BEARISH',
        liquidityType: 'EQUAL_HIGH',
        price: 63282.95,
      },
      progress: {},
      blockers: ['WAITING_LTF_CONFIRMATION'],
      reasonCode: 'OPPORTUNITY_ACTIVE',
    },
  });
  const text = Formatter.formatNotificationChange(
    report,
    ['DECISION_GATE_TRANSITION'],
    {
      symbol: 'BTCUSDT',
      decisionGateTransition: {
        changed: true,
        from: 'WATCH_ZONE',
        to: 'WATCH_ZONE',
        direction: 'BEARISH',
        reasonCode: 'OPPORTUNITY_ACTIVE',
        activeOpportunity: {
          direction: 'BEARISH',
          liquidityType: 'EQUAL_HIGH',
          price: 63282.95,
        },
      },
    }
  );

  for (const expected of [
    '状态：\n🟡 观察区（Watch Zone）',
    '方向：\n🔴 偏空',
    '📍 等高点（买方流动性）',
    '价格：\n63282.95',
    '等待流动性被扫取',
    '是否形成5分钟看跌 MSS',
    '是否出现看跌 Displacement',
  ]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.strictEqual(text.includes('变化：'), false);
});

test('无具体机会的HTF状态也使用中文说明', () => {
  const text = Formatter.formatNotificationChange(
    currentReport({
      decisionGate: {
        state: 'WAITING_HTF',
        direction: null,
        activeOpportunity: null,
        progress: {},
        blockers: ['HTF_BIAS_UNCLEAR'],
        reasonCode: 'WAITING_FOR_HTF_BIAS',
      },
    }),
    ['DECISION_GATE_TRANSITION'],
    {
      symbol: 'BTCUSDT',
      decisionGateTransition: {
        changed: true,
        from: 'NONE',
        to: 'WAITING_HTF',
        direction: null,
        reasonCode: 'WAITING_FOR_HTF_BIAS',
        activeOpportunity: null,
      },
    }
  );

  assert.ok(text.includes('⚪ 等待4小时方向确认'));
  assert.ok(text.includes('⚪ 方向尚未明确'));
  assert.ok(text.includes('等待高周期方向明确'));
  assert.strictEqual(text.includes('流动性位置：'), false);
});

test('精简通知可显示进入CONFIRMING', () => {
  const report = currentReport({
    opportunity: {
      status: 'WATCH_ZONE',
      direction: 'BULLISH',
      liquidityType: 'EQUAL_LOW',
      price: 99.6,
    },
    confirmation: null,
    sweeps: [{
      type: 'EQUAL_LOW',
      side: 'SELL_SIDE',
      price: 99.6,
    }],
    mss: null,
    displacement: null,
  });
  const text = Formatter.formatNotificationChange(
    report,
    ['OPPORTUNITY_CHANGED'],
    {
      previousState: {
        opportunity: { status: 'WAITING' },
      },
    }
  );

  assert.ok(text.includes('进入 CONFIRMING'));
  assert.ok(text.includes('【Entry Watch】'));
  assert.ok(text.includes('【Event Chain】'));
  assert.strictEqual(text.includes('②'), false);
  assert.strictEqual(text.includes('③'), false);
});

test('事件链明确显示 Sweep MSS 与 Displacement', () => {
  const text = Formatter.format(currentReport());
  for (const expected of [
    '✓ Sweep',
    '✓ Bullish MSS',
    '✓ Bullish Displacement',
  ]) {
    assert.ok(text.includes(expected));
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

  assert.ok(text.includes('⑤ 【Liquidity Roadmap】'));
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
    '⑤ 【Liquidity Roadmap】\n暂无明确流动性路线。'
  ));
});

test('当前位置只在 HTF 面板保留一次', () => {
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

  assert.strictEqual(text.includes('【当前位置】'), false);
  assert.ok(text.includes('位置：溢价区'));
  assert.strictEqual(
    text.match(/位置：溢价区/g).length,
    1
  );
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
  assert.strictEqual(text.includes('最近流动性：'), false);
});

test('最终面板不输出自动交易建议', () => {
  const text = Formatter.format(currentReport({
    positionContext: {
      positionZone: 'DISCOUNT',
      nearestLiquidity: null,
      distancePercent: null,
      context: '价格位于折价区。',
    },
    liquidityRoadmap: [],
  }));
  const summary = text.slice(text.indexOf('【交易监控面板】'));

  for (const forbidden of [
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
