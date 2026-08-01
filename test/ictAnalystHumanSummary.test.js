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
    h4: {
      bias: 'BEARISH',
      primaryDraw: {
        type: 'PWL',
        price: 98,
      },
    },
    fiveMinute: {
      currentConfirmed: {
        confirmation: null,
      },
    },
    alignment: {
      status: 'WAITING',
      direction: null,
    },
    opportunity: {
      status: 'WAITING',
      direction: 'BEARISH',
      liquidityType: null,
      price: null,
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
    '① 【HTF】',
    'Bias：Bearish',
    'Structure：Undetermined',
    'Alignment：Waiting',
    '位置：溢价区',
    '【交易机会】',
    '方向：SHORT',
    '当前阶段：WAITING',
    '② 【Entry Watch】',
    '尚未锁定具体上方流动性',
    '候选类型：',
    'PDH / PWH / H4 Swing High / Equal High',
    '③ 【Event Chain】',
    '□ Sweep 目标尚未锁定',
    '□ Bearish MSS',
    '□ Bearish Displacement',
    '④ 【Primary Draw】',
    'PWL',
    '98',
  ]) {
    assert.ok(summary.includes(text), text);
  }
  for (const removed of [
    '【下一步等待路径】',
    '【等待原因】',
    '【已完成事件】',
  ]) {
    assert.strictEqual(summary.includes(removed), false);
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

  assert.ok(summary.includes('Bias：Bullish'));
  assert.ok(summary.includes('Alignment：Aligned'));
  assert.ok(summary.includes('方向：LONG'));
  assert.strictEqual(summary.includes('缺少：'), false);
  for (const forbidden of [
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

test('confirmation status only follows the strict chain result', () => {
  const independentEvents = traderContext({
    fiveMinute: {
      currentConfirmed: {
        liquiditySweeps: [{
          side: 'SELL_SIDE',
        }],
        mss: { direction: 'BULLISH' },
        displacement: { direction: 'BULLISH' },
        confirmation: null,
      },
    },
  });
  const bullish = traderContext({
    fiveMinute: {
      currentConfirmed: {
        confirmation: {
          status: 'CONFIRMED',
          direction: 'BULLISH',
        },
      },
    },
  });
  const bearish = traderContext({
    fiveMinute: {
      currentConfirmed: {
        confirmation: {
          status: 'CONFIRMED',
          direction: 'BEARISH',
        },
      },
    },
  });

  assert.strictEqual(
    HumanSummary.fiveMinuteConfirmationStatus(
      independentEvents.fiveMinute
    ),
    'WAITING'
  );
  assert.strictEqual(
    HumanSummary.fiveMinuteConfirmationStatus(
      bullish.fiveMinute
    ),
    'CONFIRMED_BULLISH'
  );
  assert.strictEqual(
    HumanSummary.fiveMinuteConfirmationStatus(
      bearish.fiveMinute
    ),
    'CONFIRMED_BEARISH'
  );
});

test('independent 5m events are not described as complete confirmation', () => {
  const input = traderContext({
    h4: { bias: 'BULLISH' },
    fiveMinute: {
      currentConfirmed: {
        liquiditySweeps: [{
          side: 'SELL_SIDE',
        }],
        mss: { direction: 'BULLISH' },
        displacement: { direction: 'BULLISH' },
        confirmation: null,
      },
    },
  });
  const summary = HumanSummary.summarizeTraderContext(input);

  assert.ok(summary.includes('✓ Sweep'));
  assert.ok(summary.includes('✓ Bullish MSS'));
  assert.ok(summary.includes('✓ Bullish Displacement'));
  assert.strictEqual(summary.includes('状态：READY'), false);
  assert.ok(summary.includes('当前阶段：WAITING'));
  assert.strictEqual(
    summary.includes('5分钟严格多头确认链已经完成。'),
    false
  );
});

test('next scenario follows bullish and bearish HTF direction', () => {
  assert.strictEqual(
    HumanSummary.nextScenario(
      { bias: 'BULLISH' },
      'WAITING'
    ),
    '等待：\nSell Side Liquidity Sweep\n' +
      '→ Bullish MSS\n→ Bullish Displacement'
  );
  assert.strictEqual(
    HumanSummary.nextScenario(
      { bias: 'BEARISH' },
      'WAITING'
    ),
    '等待：\nBuy Side Liquidity Sweep\n' +
      '→ Bearish MSS\n→ Bearish Displacement'
  );
});

test('Structure Phase descriptions are symmetric', () => {
  const expected = {
    BULLISH_MSS:
      '空头结构已被破坏，等待多头确认',
    BULLISH_PULLBACK:
      '多头转换回调阶段，等待Bullish BOS',
    BULLISH_CONFIRMED: '多头趋势已确认',
    BEARISH_MSS:
      '多头结构已被破坏，等待空头确认',
    BEARISH_PULLBACK:
      '空头转换回调阶段，等待Bearish BOS',
    BEARISH_CONFIRMED: '空头趋势已确认',
  };

  for (const [state, description] of Object.entries(
    expected
  )) {
    assert.strictEqual(
      HumanSummary.structurePhaseDescription(state),
      description
    );
  }
});

test('Human Summary shows Structure Phase in dashboard form', () => {
  const summary = HumanSummary.summarizeTraderContext(
    traderContext({
      structurePhase: {
        state: 'BULLISH_CONFIRMED',
        direction: 'BULLISH',
        context: 'POST_MSS',
        mssEvent: {
          type: 'BULLISH_MSS',
          breakType: 'CLOSE_BREAK',
          level: 110,
          breakIndex: 4,
          availableIndex: 6,
        },
        confirmationBos: {
          type: 'BULLISH_BOS',
          breakType: 'DISPLACEMENT_BREAK',
          level: 115,
          breakIndex: 10,
          availableIndex: 12,
        },
      },
    })
  );

  for (const text of [
    '① 【HTF】',
    'Structure：Bullish Confirmed',
  ]) {
    assert.ok(summary.includes(text), text);
  }
});

test('Structure Phase accepts the Engine current shape', () => {
  const details = HumanSummary.structurePhaseDetails({
    structurePhase: 'BEARISH_PULLBACK',
    direction: 'BEARISH',
    context: 'POST_MSS',
    sourceEvent: {
      type: 'BEARISH_MSS',
      breakType: 'CLOSE_BREAK',
      level: 90,
    },
  });

  assert.strictEqual(details.state, 'BEARISH_PULLBACK');
  assert.strictEqual(details.direction, 'BEARISH');
  assert.strictEqual(details.context, 'POST_MSS');
});

test('position narrative uses H4 bias and premium discount', () => {
  const bullish = HumanSummary.positionWaitingNarrative(
    { bias: 'BULLISH' },
    { positionZone: 'DISCOUNT' }
  );
  const bearish = HumanSummary.positionWaitingNarrative(
    { bias: 'BEARISH' },
    { positionZone: 'PREMIUM' }
  );

  assert.ok(bullish.includes(
    '4H偏多且价格位于折价区'
  ));
  assert.ok(bearish.includes(
    '4H偏空且价格位于溢价区'
  ));
  assert.strictEqual(bullish.includes('不适合追单'), false);
  assert.strictEqual(bearish.includes('不适合追单'), false);
});

test('bullish WATCH_ZONE becomes a LONG observation', () => {
  const summary = HumanSummary.summarizeTraderContext(
    traderContext({
      h4: { bias: 'BULLISH' },
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'PDL',
        price: 99.6,
      },
    })
  );

  for (const text of [
    '【交易机会】',
    '方向：LONG',
    '当前阶段：WATCH_ZONE',
    '② 【Entry Watch】\n等待：\nPDL\n99.6',
    '□ Sweep PDL',
    '□ Bullish MSS',
    '□ Bullish Displacement',
  ]) {
    assert.ok(summary.includes(text), text);
  }
});

test('expected Sweep advances opportunity to CONFIRMING', () => {
  const summary = HumanSummary.summarizeTraderContext(
    traderContext({
      h4: { bias: 'BULLISH' },
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'H4_SWING_LOW',
        price: 99.7,
      },
      fiveMinute: {
        currentConfirmed: {
          liquiditySweeps: [{
            side: 'SELL_SIDE',
            type: 'H4_SWING_LOW',
          }],
          confirmation: null,
        },
      },
    })
  );

  assert.ok(summary.includes('当前阶段：CONFIRMING'));
  assert.ok(summary.includes('✓ Sweep H4 Swing Low'));
  assert.ok(summary.includes('□ Bullish MSS'));
  assert.ok(summary.includes('□ Bullish Displacement'));
  assert.strictEqual(
    summary.includes('Sell Side Liquidity Sweep'),
    false
  );
  assert.strictEqual(
    summary.includes(
      '当前阶段：WATCH_ZONE：等待流动性扫取'
    ),
    false
  );
});

test('MSS完成后事件链只等待Displacement', () => {
  const lines = HumanSummary.eventChainLines(
    traderContext({
      h4: { bias: 'BULLISH' },
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'EQUAL_LOW',
        price: 99.2,
      },
      fiveMinute: {
        currentConfirmed: {
          liquiditySweeps: [{
            side: 'SELL_SIDE',
            type: 'EQUAL_LOW',
            price: 99.2,
          }],
          mss: { direction: 'BULLISH' },
          displacement: null,
          confirmation: null,
        },
      },
    })
  ).join('\n');

  assert.ok(lines.includes('✓ Sweep Equal Low'));
  assert.ok(lines.includes('✓ Bullish MSS'));
  assert.ok(lines.includes('□ Bullish Displacement'));
  assert.strictEqual(lines.includes('状态：READY'), false);
});

test('Entry Watch与Primary Draw保持独立', () => {
  const summary = HumanSummary.summarizeTraderContext(
    traderContext({
      h4: {
        bias: 'BULLISH',
        primaryDraw: { type: 'PWH', price: 66924 },
      },
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'EQUAL_LOW',
        price: 62782,
      },
    })
  );
  const entry = summary.slice(
    summary.indexOf('② 【Entry Watch】'),
    summary.indexOf('③ 【Event Chain】')
  );
  const target = summary.slice(
    summary.indexOf('④ 【Primary Draw】')
  );

  assert.ok(entry.includes('Equal Low'));
  assert.ok(entry.includes('62782'));
  assert.strictEqual(entry.includes('PWH'), false);
  assert.ok(target.includes('PWH'));
  assert.ok(target.includes('66924'));
  assert.strictEqual(target.includes('Equal Low'), false);
});

test('缺少Structure Phase和Alignment时兼容旧报告', () => {
  const summary = HumanSummary.summarizeTraderContext({
    h4: { bias: 'BULLISH' },
    fiveMinute: { currentConfirmed: {} },
  });

  assert.ok(summary.includes('Bias：Bullish'));
  assert.ok(summary.includes('Structure：Undetermined'));
  assert.ok(summary.includes('Alignment：Undetermined'));
});

test('bearish opportunity uses SHORT and buy-side path', () => {
  const lines = HumanSummary.opportunityObservationLines(
    traderContext({
      h4: { bias: 'BEARISH' },
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BEARISH',
        liquidityType: 'EQUAL_HIGH',
        price: 100.3,
      },
    })
  ).join('\n');

  assert.ok(lines.includes('方向：SHORT'));
  assert.ok(lines.includes(
    '② 【Entry Watch】\n等待：\nEqual High\n100.3'
  ));
  assert.ok(lines.includes('□ Sweep Equal High'));
  assert.ok(lines.includes('□ Bearish MSS'));
  assert.ok(lines.includes('□ Bearish Displacement'));
});

test('WAITING opportunity shows the complete event chain', () => {
  const path = HumanSummary.opportunityPath(
    traderContext({
      h4: { bias: 'BULLISH' },
      opportunity: {
        status: 'WAITING',
        direction: 'BULLISH',
      },
    })
  );

  assert.strictEqual(
    path,
    'Sweep（目标尚未锁定） → Bullish MSS → ' +
      'Bullish Displacement'
  );
});

test('WATCH_ZONE path names the current liquidity', () => {
  const path = HumanSummary.opportunityPath(
    traderContext({
      h4: { bias: 'BULLISH' },
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'H4_SWING_LOW',
      },
    })
  );

  assert.strictEqual(
    path,
    '等待锁定具体下方流动性 → ' +
      'Bullish MSS → Bullish Displacement'
  );
});

test('CONFIRMING hides a completed Sweep', () => {
  const path = HumanSummary.opportunityPath(
    traderContext({
      h4: { bias: 'BULLISH' },
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'PDL',
      },
      fiveMinute: {
        currentConfirmed: {
          liquiditySweeps: [{ side: 'SELL_SIDE' }],
          mss: null,
          displacement: null,
          confirmation: null,
        },
      },
    })
  );

  assert.strictEqual(
    path,
    'Bullish MSS → Bullish Displacement'
  );
});

test('CONFIRMING hides completed Sweep and MSS', () => {
  const input = traderContext({
    h4: { bias: 'BULLISH' },
    opportunity: {
      status: 'WATCH_ZONE',
      direction: 'BULLISH',
      liquidityType: 'PDL',
    },
    fiveMinute: {
      currentConfirmed: {
        liquiditySweeps: [{ side: 'SELL_SIDE' }],
        mss: { direction: 'BULLISH' },
        displacement: null,
        confirmation: null,
      },
    },
  });

  assert.strictEqual(
    HumanSummary.opportunityPath(input),
    'Bullish Displacement'
  );
  assert.strictEqual(
    HumanSummary.opportunityStage(input).text,
    'Sweep与MSS已完成，等待Displacement'
  );
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
