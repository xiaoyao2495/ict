'use strict';

const assert = require('assert');
const HumanSummary = require(
  '../formatters/ictAnalystHumanSummary'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function inputFor(dailyBias, legacyBias) {
  return {
    h4: {
      bias: legacyBias || 'NEUTRAL',
      primaryDraw: {
        type: 'PDL',
        price: 90,
      },
      dailyBias,
    },
    htfAlignment: {
      status: 'UNDETERMINED',
    },
  };
}

test('ETH shows Bullish background with Premium WAIT separately', () => {
  const input = inputFor({
    marketBias: 'BULLISH',
    legacyBias: 'NEUTRAL',
    transitionDirection: null,
    structureState: 'BULLISH_CONTINUATION',
    location: {
      state: 'PREMIUM',
      relationToRange: 'INSIDE',
    },
    drawOnLiquidity: {
      side: 'BUY_SIDE',
      type: 'PDH',
      price: 2020.9,
    },
    htfLocationReadiness: 'WAIT',
    reasons: [],
  });
  const text = HumanSummary.dailyBiasDashboardLines(
    input
  ).join('\n');

  assert.ok(text.includes('4H交易背景：🟢 偏多'));
  assert.ok(text.includes(
    '结构阶段：上涨延续（BULLISH_CONTINUATION）'
  ));
  assert.ok(text.includes('当前位置：溢价区'));
  assert.ok(text.includes(
    '流动性目标：买方流动性（昨日高点，价格：2020.9）'
  ));
  assert.ok(text.includes(
    '执行环境：等待更好的执行位置，不追多（WAIT）'
  ));
});

test('CL keeps Bearish background in Discount and waits', () => {
  const input = inputFor({
    marketBias: 'BEARISH',
    legacyBias: 'BEARISH',
    transitionDirection: null,
    structureState: 'BEARISH_CONTINUATION',
    location: {
      state: 'DISCOUNT',
      relationToRange: 'INSIDE',
    },
    drawOnLiquidity: {
      side: 'SELL_SIDE',
      type: 'PWL',
      price: 72.59,
    },
    htfLocationReadiness: 'WAIT',
    reasons: [],
  }, 'NEUTRAL');
  const text = HumanSummary.dailyBiasDashboardLines(
    input
  ).join('\n');

  assert.ok(text.includes('4H交易背景：🔴 偏空'));
  assert.ok(text.includes(
    '结构阶段：下跌延续（BEARISH_CONTINUATION）'
  ));
  assert.ok(text.includes('当前位置：折价区'));
  assert.ok(text.includes(
    '执行环境：等待更好的执行位置，不追空（WAIT）'
  ));
  assert.strictEqual(
    text.includes('4H交易背景：⚪ 中性'),
    false
  );
});

test('SNDK shows legacy Bearish and Bullish transition', () => {
  const input = inputFor({
    marketBias: 'NEUTRAL',
    legacyBias: 'BEARISH',
    transitionDirection: 'BULLISH',
    structureState: 'BULLISH_PULLBACK',
    location: {
      state: 'PREMIUM',
      relationToRange: 'ABOVE_RANGE',
    },
    drawOnLiquidity: null,
    htfLocationReadiness: 'WAIT',
    reasons: [],
  }, 'BEARISH');
  const text = HumanSummary.dailyBiasDashboardLines(
    input
  ).join('\n');

  assert.ok(text.includes('4H交易背景：⚪ 结构转换中'));
  assert.ok(text.includes('历史背景：🔴 偏空'));
  assert.ok(text.includes('转换方向：🟢 偏多'));
  assert.ok(text.includes(
    '结构阶段：多头回调阶段（BULLISH_PULLBACK）'
  ));
  assert.ok(text.includes(
    '当前位置：溢价区（4H区间上方）'
  ));
  assert.ok(text.includes('执行环境：等待结构确认（WAIT）'));
});

test('Primary Draw display prefers Daily Bias without changing data', () => {
  const input = inputFor({
    marketBias: 'BULLISH',
    legacyBias: 'BULLISH',
    transitionDirection: null,
    structureState: 'BULLISH_CONTINUATION',
    location: {
      state: 'DISCOUNT',
      relationToRange: 'INSIDE',
    },
    drawOnLiquidity: {
      side: 'BUY_SIDE',
      type: 'PWH',
      price: 1234,
    },
    htfLocationReadiness: 'READY',
    reasons: [],
  }, 'BEARISH');
  const before = JSON.stringify(input);
  const summary = HumanSummary.summarizeTraderContext(input);

  assert.ok(summary.includes('4H交易背景：🟢 偏多'));
  assert.ok(summary.includes('位置条件已具备，可进入5分钟观察'));
  assert.ok(summary.includes('④ 【Primary Draw】'));
  assert.ok(summary.includes('PWH'));
  assert.ok(summary.includes('1234'));
  assert.strictEqual(JSON.stringify(input), before);
});

test('reports without dailyBias preserve the legacy HTF dashboard', () => {
  const input = {
    h4: { bias: 'BEARISH' },
    htfAlignment: { status: 'ALIGNED' },
    positionContext: { positionZone: 'PREMIUM' },
  };
  const text = HumanSummary.htfDashboardLines(input)
    .join('\n');

  assert.ok(text.includes('Bias：Bearish'));
  assert.ok(text.includes('Structure：Undetermined'));
  assert.strictEqual(text.includes('4H交易背景：'), false);
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
