'use strict';

const assert = require('assert');
const Formatter = require(
  '../formatters/ictAnalystChineseFormatter'
);

let testsPassed = 0;
const NOW = Date.UTC(2026, 7, 3, 16);

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

function report(options) {
  options = options || {};
  const fourHourAnalysis = {
    bias: options.oldBias || 'NEUTRAL',
  };
  if (options.dailyBias !== undefined) {
    fourHourAnalysis.dailyBias = options.dailyBias;
  }
  return {
    current: {
      asOf: NOW,
      fourHourAnalysis,
      structurePhase: options.structurePhase || {
        state: 'UNDETERMINED',
      },
      fiveMinuteObservation: {
        currentConfirmed: {
          liquiditySweeps: [],
          mss: null,
          confirmation: null,
        },
        latestConfirmed: {
          liquiditySweep: null,
          mss: null,
          confirmation: null,
        },
      },
      decisionGate: options.decisionGate,
    },
  };
}

function transitionChange(options) {
  options = options || {};
  return {
    symbol: options.symbol || 'TESTUSDT',
    decisionGateTransition: {
      changed: true,
      from: options.from || 'WAITING_HTF',
      to: options.to,
      direction: options.transitionDirection,
      reasonCode: options.reasonCode ||
        'HTF_STRUCTURE_TRANSITION',
      activeOpportunity: options.activeOpportunity || null,
    },
  };
}

test('Bullish POST_MSS transition notification is explicit and inactive', () => {
  const staleOpportunity = {
    direction: 'BEARISH',
    liquidityType: 'EQUAL_HIGH',
    price: 100.2,
  };
  const value = report({
    oldBias: 'BEARISH',
    dailyBias: {
      marketBias: 'NEUTRAL',
      legacyBias: 'BEARISH',
      transitionDirection: 'BULLISH',
      structureState: 'BULLISH_PULLBACK',
    },
    structurePhase: {
      state: 'BULLISH_PULLBACK',
      context: 'POST_MSS',
    },
    decisionGate: {
      state: 'HTF_TRANSITION',
      direction: null,
      activeOpportunity: null,
      progress: {},
      reasonCode: 'HTF_STRUCTURE_TRANSITION',
    },
  });
  const text = Formatter.formatNotificationChange(
    value,
    ['DECISION_GATE_TRANSITION'],
    transitionChange({
      symbol: 'SNDKUSDT',
      to: 'HTF_TRANSITION',
      transitionDirection: 'BULLISH',
      activeOpportunity: staleOpportunity,
    })
  );

  assert.ok(text.includes('4H交易背景：\n⚪ 结构转换中'));
  assert.ok(text.includes('历史背景：\n🔴 偏空'));
  assert.ok(text.includes('转换方向：\n🟢 偏多'));
  assert.ok(text.includes(
    '结构阶段：\n多头回调阶段（BULLISH_PULLBACK）'
  ));
  assert.ok(text.includes('观察方向：\n无'));
  assert.strictEqual(text.includes('当前关注流动性：'), false);
  assert.strictEqual(text.includes('后续确认：'), false);
  assert.strictEqual(text.includes('确认中（Confirming）'), false);
  assert.strictEqual(text.includes('确认完成（Ready Observation）'), false);
});

test('Bearish POST_MSS transition notification preserves both directions', () => {
  const value = report({
    oldBias: 'BULLISH',
    dailyBias: {
      marketBias: 'NEUTRAL',
      legacyBias: 'BULLISH',
      transitionDirection: 'BEARISH',
      structureState: 'BEARISH_PULLBACK',
    },
    structurePhase: {
      state: 'BEARISH_PULLBACK',
      context: 'POST_MSS',
    },
    decisionGate: {
      state: 'HTF_TRANSITION',
      direction: null,
      activeOpportunity: null,
      progress: {},
    },
  });
  const text = Formatter.formatNotificationChange(
    value,
    ['DECISION_GATE_TRANSITION'],
    transitionChange({
      to: 'HTF_TRANSITION',
      transitionDirection: 'BEARISH',
    })
  );

  assert.ok(text.includes('4H交易背景：\n⚪ 结构转换中'));
  assert.ok(text.includes('历史背景：\n🟢 偏多'));
  assert.ok(text.includes('转换方向：\n🔴 偏空'));
  assert.ok(text.includes('观察方向：\n无'));
});

test('normal WATCH_ZONE keeps Daily Bias and Gate direction separate', () => {
  const opportunity = {
    direction: 'BEARISH',
    liquidityType: 'EQUAL_HIGH',
    price: 100.2,
  };
  const value = report({
    oldBias: 'NEUTRAL',
    dailyBias: {
      marketBias: 'BEARISH',
      legacyBias: 'BEARISH',
      transitionDirection: null,
      structureState: 'BEARISH_CONTINUATION',
    },
    decisionGate: {
      state: 'WATCH_ZONE',
      direction: 'BEARISH',
      activeOpportunity: opportunity,
      progress: {},
    },
  });
  const text = Formatter.formatNotificationChange(
    value,
    ['DECISION_GATE_TRANSITION'],
    transitionChange({
      from: 'WAITING_OPPORTUNITY',
      to: 'WATCH_ZONE',
      transitionDirection: 'BULLISH',
      reasonCode: 'OPPORTUNITY_ACTIVE',
      activeOpportunity: opportunity,
    })
  );

  assert.ok(text.includes('4H交易背景：\n🔴 偏空'));
  assert.ok(text.includes('观察方向：\n🔴 偏空'));
  assert.ok(text.includes('当前关注流动性：'));
  assert.ok(text.includes('后续确认：'));
});

test('legacy report without dailyBias falls back to old Bias', () => {
  const opportunity = {
    direction: 'BULLISH',
    liquidityType: 'EQUAL_LOW',
    price: 99.8,
  };
  const value = report({
    oldBias: 'BULLISH',
    decisionGate: {
      state: 'WATCH_ZONE',
      direction: 'BULLISH',
      activeOpportunity: opportunity,
      progress: {},
    },
  });
  const text = Formatter.formatNotificationChange(
    value,
    ['DECISION_GATE_TRANSITION'],
    transitionChange({
      from: 'WAITING_OPPORTUNITY',
      to: 'WATCH_ZONE',
      transitionDirection: 'BULLISH',
      reasonCode: 'OPPORTUNITY_ACTIVE',
      activeOpportunity: opportunity,
    })
  );

  assert.ok(text.includes('4H交易背景：\n🟢 偏多'));
  assert.ok(text.includes('观察方向：\n🟢 偏多'));
});

console.log('\n' + testsPassed + ' tests passed.');
