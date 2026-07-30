'use strict';

const assert = require('assert');
const HumanSummary = require(
  '../formatters/ictAnalystHumanSummary'
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

function context(options) {
  options = options || {};
  return {
    h4: {
      bias: options.bias || 'BULLISH',
    },
    h1: {
      relationToH4: options.relation || 'ALIGNED',
    },
    fiveMinute: {
      currentConfirmed: options.currentConfirmed || {
        liquiditySweeps: [],
        displacement: null,
        mss: null,
      },
      potentialObservation: {
        state: options.observation || 'NONE',
      },
    },
  };
}

test('retracement summary matches the requested market reading', () => {
  const input = context({ relation: 'RETRACEMENT' });
  assert.strictEqual(
    HumanSummary.summarize(
      input.h4,
      input.h1,
      input.fiveMinute
    ),
    '4H结构保持多头，但1H目前处于回调阶段，' +
      '等待低周期确认是否重新跟随4H方向。'
  );
});

test('aligned confirmation describes multi-timeframe state', () => {
  const input = context({
    observation: 'POTENTIAL_LONG_OBSERVATION',
  });
  const summary = HumanSummary.summarize(
    input.h4,
    input.h1,
    input.fiveMinute
  );

  assert.ok(summary.includes('4H结构保持多头'));
  assert.ok(summary.includes('1H正在顺应4H方向交付'));
  assert.ok(summary.includes('5m也已出现同向确认'));
});

test('bearish and neutral states remain descriptive only', () => {
  const bearish = context({
    bias: 'BEARISH',
    relation: 'COUNTER_TREND',
  });
  const neutral = context({ bias: 'NEUTRAL' });

  assert.ok(HumanSummary.summarize(
    bearish.h4,
    bearish.h1,
    bearish.fiveMinute
  ).includes('4H结构保持空头'));
  assert.ok(HumanSummary.summarize(
    neutral.h4,
    neutral.h1,
    neutral.fiveMinute
  ).includes('5m局部事件暂不足以形成可执行叙事'));
});

test('every summary excludes execution language', () => {
  const summaries = [
    context(),
    context({ relation: 'RETRACEMENT' }),
    context({ relation: 'COUNTER_TREND' }),
    context({ relation: 'UNCLEAR' }),
    context({
      observation: 'POTENTIAL_LONG_OBSERVATION',
    }),
    context({
      bias: 'BEARISH',
      observation: 'POTENTIAL_SHORT_OBSERVATION',
    }),
    context({ bias: 'NEUTRAL' }),
  ].map((input) => HumanSummary.summarize(
    input.h4,
    input.h1,
    input.fiveMinute
  ));

  for (const summary of summaries) {
    for (const forbidden of [
      '买入',
      '卖出',
      '开仓',
      '止损',
      '止盈',
      '目标价格',
    ]) {
      assert.strictEqual(
        summary.includes(forbidden),
        false,
        summary + ' contains ' + forbidden
      );
    }
  }
});

test('directionally consistent 5m events keep a unified narrative', () => {
  const input = context({
    observation: 'POTENTIAL_LONG_OBSERVATION',
    currentConfirmed: {
      liquiditySweeps: [{
        side: 'SELL_SIDE',
        type: 'LTF_SWING_LOW',
      }],
      displacement: { direction: 'BULLISH' },
      mss: { direction: 'BULLISH' },
    },
  });
  const summary = HumanSummary.summarize(
    input.h4,
    input.h1,
    input.fiveMinute
  );

  assert.strictEqual(
    HumanSummary.ltfNarrativeState(input.fiveMinute),
    'ALIGNED_BULLISH'
  );
  assert.ok(summary.includes('当前多周期状态较为一致'));
  assert.strictEqual(
    summary.includes('未形成一致叙事'),
    false
  );
});

test('direction conflict is stated without changing observation', () => {
  const input = context({
    currentConfirmed: {
      liquiditySweeps: [{
        side: 'SELL_SIDE',
        type: 'LTF_SWING_LOW',
      }],
      displacement: { direction: 'BEARISH' },
      mss: { direction: 'BEARISH' },
    },
  });
  const before = JSON.parse(JSON.stringify(input.fiveMinute));
  const summary = HumanSummary.summarize(
    input.h4,
    input.h1,
    input.fiveMinute
  );

  assert.strictEqual(
    HumanSummary.ltfNarrativeState(input.fiveMinute),
    'CONFLICT'
  );
  assert.ok(summary.includes(
    '5m已出现局部结构事件，但扫取方向、位移方向与' +
    '市场结构转换方向' +
    '未形成一致叙事。'
  ));
  assert.deepStrictEqual(input.fiveMinute, before);
});

test('neutral 4H uses the non-directional narrative', () => {
  const input = context({
    bias: 'NEUTRAL',
    currentConfirmed: {
      liquiditySweeps: [{
        side: 'SELL_SIDE',
        type: 'LTF_SWING_LOW',
      }],
      displacement: { direction: 'BEARISH' },
      mss: { direction: 'BEARISH' },
    },
  });
  const summary = HumanSummary.summarize(
    input.h4,
    input.h1,
    input.fiveMinute
  );

  assert.strictEqual(
    summary,
    '4H方向尚未明确，5m局部事件暂不足以形成可执行叙事。'
  );
  assert.strictEqual(
    summary.includes('与HTF一致的完整确认'),
    false
  );
});

function traderContext(overrides) {
  return {
    h4: { bias: 'BEARISH' },
    fiveMinute: {
      currentConfirmed: {
        confirmation: null,
      },
    },
    alignment: {
      status: 'WAITING',
      direction: null,
    },
    liquidityRoadmap: [{
      type: 'PDL',
      timeframe: '1D',
      price: 99,
      distancePercent: 1,
      priority: 7,
      side: 'SELL_SIDE',
      directionAligned: true,
    }],
    positionContext: {
      positionZone: 'PREMIUM',
      nearestLiquidity: {
        type: 'EQUAL_HIGH',
        price: 100.42,
        side: 'BUY_SIDE',
      },
      distancePercent: 0.42,
    },
    ...(overrides || {}),
  };
}

test('trader summary combines every requested context layer', () => {
  const summary = HumanSummary.summarizeTraderContext(
    traderContext()
  );

  for (const text of [
    '【市场环境】',
    '4H方向：偏空',
    '5m确认：等待完整确认',
    '多周期关系：等待低周期确认',
    '当前位置：溢价区',
    '【当前阶段】',
    '等待5分钟完整确认',
    '缺少：',
    '- 5分钟完整确认',
    '【关键原因】',
    '流动性路线首先指向昨日低点',
    '价格已经接近目标流动性',
  ]) {
    assert.ok(summary.includes(text), text);
  }
});

test('4H direction waits directly for 5m confirmation', () => {
  const summary = HumanSummary.summarize(
    { bias: 'BULLISH' },
    {
      currentConfirmed: {
        confirmation: null,
      },
    }
  );

  assert.strictEqual(
    summary,
    '4H结构保持多头，等待5分钟确认。'
  );
});

test('aligned context describes confirmation without execution advice', () => {
  const summary = HumanSummary.summarizeTraderContext(
    traderContext({
      h4: { bias: 'BULLISH' },
      fiveMinute: {
        currentConfirmed: {
          confirmation: {
            status: 'CONFIRMED',
            direction: 'BULLISH',
          },
        },
      },
      alignment: {
        status: 'ALIGNED',
        direction: 'BULLISH',
      },
    })
  );

  assert.ok(summary.includes('5m确认：已形成向上确认'));
  assert.ok(summary.includes('多周期方向一致'));
  assert.ok(summary.includes(
    '多周期观察条件已经完整'
  ));
  assert.ok(summary.includes('缺少：\n- 无'));
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
    '建议',
    '应该',
    '不适合',
    '追单',
  ]) {
    assert.strictEqual(
      summary.includes(forbidden),
      false,
      forbidden
    );
  }
});

test('trader summary does not mutate composite context', () => {
  const input = traderContext();
  const original = JSON.parse(JSON.stringify(input));

  HumanSummary.summarizeTraderContext(input);

  assert.deepStrictEqual(input, original);
});

test('setup stage ignores legacy M15 state', () => {
  const result = HumanSummary.analyzeSetupStage(
    traderContext({
      delivery: {
        timeframe: '15m',
        deliveryState: 'RETRACEMENT',
        deliveryDirection: 'NEUTRAL',
        relationToH4: 'RETRACEMENT',
        m15DeliveryStage: 'WAITING_LIQUIDITY',
      },
    })
  );

  assert.deepStrictEqual(result, {
    setupStage: 'WAITING_LTF_CONFIRMATION',
    missingConditions: ['5分钟完整确认'],
  });
});

test('setup stage waits for 5m confirmation', () => {
  const result = HumanSummary.analyzeSetupStage(
    traderContext()
  );

  assert.deepStrictEqual(result, {
    setupStage: 'WAITING_LTF_CONFIRMATION',
    missingConditions: ['5分钟完整确认'],
  });
});

test('setup stage is ready after complete aligned confirmation', () => {
  const result = HumanSummary.analyzeSetupStage(
    traderContext({
      fiveMinute: {
        currentConfirmed: {
          confirmation: {
            status: 'CONFIRMED',
            direction: 'BEARISH',
          },
        },
      },
      alignment: {
        status: 'ALIGNED',
        direction: 'BEARISH',
      },
    })
  );

  assert.deepStrictEqual(result, {
    setupStage: 'READY_OBSERVATION',
    missingConditions: [],
  });
});

test('neutral 4H waits for direction and 5m', () => {
  const result = HumanSummary.analyzeSetupStage(
    traderContext({
      h4: { bias: 'NEUTRAL' },
    })
  );

  assert.deepStrictEqual(result, {
    setupStage: 'WAITING_HTF',
    missingConditions: [
      '明确的4小时方向',
      '5分钟完整确认',
    ],
  });
});

console.log('\n' + testsPassed + ' tests passed.');
