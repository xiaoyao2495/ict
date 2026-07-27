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
  ).includes('整体保持观察'));
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

console.log('\n' + testsPassed + ' tests passed.');
