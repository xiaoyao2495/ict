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
    '5m已出现局部结构事件，但扫取方向、位移方向与MSS' +
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

console.log('\n' + testsPassed + ' tests passed.');
