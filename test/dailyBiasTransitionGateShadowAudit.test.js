'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const DecisionGate = require('../indicators/ictDecisionGate');
const HtfAlignment = require(
  '../indicators/ictHtfAlignmentAnalyzer'
);
const OpportunityDetector = require(
  '../indicators/ictOpportunityDetector'
);
const Audit = require(
  '../scripts/runDailyBiasTransitionGateShadowAudit'
);

const tests = [];
let testsPassed = 0;
const START = Date.UTC(2026, 7, 3);

function test(name, callback) {
  tests.push({ name, callback });
}

function report(symbol, values) {
  values = values || {};
  const currentPrice = values.currentPrice || 100;
  const liquidity = values.liquidity || [];
  const structurePhase = {
    state: values.phase,
    direction: values.phase.indexOf('BULLISH_') === 0
      ? 'BULLISH'
      : values.phase.indexOf('BEARISH_') === 0
        ? 'BEARISH'
        : null,
    context: values.context || 'CONTINUATION',
    transitionPending: values.transitionPending === true,
  };
  const alignment = HtfAlignment.analyze({
    biasDirection: values.oldBias,
    structurePhase,
  });
  const opportunity = OpportunityDetector.detect({
    h4Bias: values.oldBias,
    currentPrice,
    liquidity,
  });
  const current = {
    index: 100,
    availableIndex: 100,
    asOf: START,
    fourHourAnalysis: {
      bias: values.oldBias,
      dailyBias: {
        marketBias: values.marketBias,
        legacyBias: values.legacyBias || values.oldBias,
        transitionDirection:
          values.transitionDirection || null,
        structureState: values.phase,
      },
    },
    structurePhase,
    htfAlignment: alignment,
    opportunity,
    alignment: { status: 'WAITING' },
    fiveMinuteObservation: {
      index: 100,
      availableIndex: 100,
      time: START,
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
  };
  current.decisionGate = DecisionGate.analyze({
    current,
    previousGateState: null,
  });
  return { symbol, current, currentPrice, liquidity };
}

const transitions = [
  report('BTCUSDT', {
    oldBias: 'NEUTRAL',
    marketBias: 'NEUTRAL',
    legacyBias: 'BULLISH',
    transitionDirection: 'BEARISH',
    phase: 'BEARISH_PULLBACK',
    context: 'POST_MSS',
    transitionPending: true,
    liquidity: [{ type: 'EQUAL_HIGH', price: 100.2 }],
  }),
  report('SNDKUSDT', {
    oldBias: 'BEARISH',
    marketBias: 'NEUTRAL',
    legacyBias: 'BEARISH',
    transitionDirection: 'BULLISH',
    phase: 'BULLISH_PULLBACK',
    context: 'POST_MSS',
    transitionPending: true,
    liquidity: [{ type: 'EQUAL_HIGH', price: 100.2 }],
  }),
  report('XAUUSDT', {
    oldBias: 'NEUTRAL',
    marketBias: 'NEUTRAL',
    legacyBias: 'BULLISH',
    transitionDirection: 'BEARISH',
    phase: 'BEARISH_PULLBACK',
    context: 'POST_MSS',
    transitionPending: true,
    liquidity: [{ type: 'PDH', price: 100.1 }],
  }),
];

test('BTC SNDK and XAU become explicit HTF_TRANSITION states', () => {
  const audit = Audit.analyzeReports(transitions);

  assert.strictEqual(audit.summary.semanticApplied, 3);
  assert.ok(audit.results.every(
    (result) => result.currentGateState === 'HTF_TRANSITION'
  ));
  assert.ok(audit.results.every(
    (result) => result.shadowGateState === 'HTF_TRANSITION'
  ));
});

test('transition shadow never carries direction opportunity or progress', () => {
  const value = transitions[1];
  const projection = require(
    '../scripts/runDailyBiasDecisionGateShadowAudit'
  ).reportProjection(value);
  const current = require(
    '../scripts/runDailyBiasDecisionGateShadowAudit'
  ).buildShadowCurrent(projection);
  const gate = DecisionGate.analyze({ current });
  const input = Audit.transitionInputOf(value);
  const shadow = Audit.applyTransitionSemantic(
    gate,
    current,
    input
  );

  assert.strictEqual(shadow.state, 'HTF_TRANSITION');
  assert.strictEqual(shadow.direction, null);
  assert.strictEqual(shadow.activeOpportunity, null);
  assert.deepStrictEqual(shadow.progress, {
    sweepCompleted: false,
    mssCompleted: false,
    displacementCompleted: false,
    strictConfirmationCompleted: false,
  });
});

test('MSS with POST_MSS context also maps to HTF_TRANSITION', () => {
  const mss = report('MSSUSDT', {
    oldBias: 'NEUTRAL',
    marketBias: 'NEUTRAL',
    legacyBias: 'BEARISH',
    transitionDirection: 'BULLISH',
    phase: 'BULLISH_MSS',
    context: 'POST_MSS',
    transitionPending: true,
  });
  const result = Audit.analyzeReports([mss]).results[0];

  assert.strictEqual(result.currentGateState, 'HTF_TRANSITION');
  assert.strictEqual(result.shadowGateState, 'HTF_TRANSITION');
});

test('confirmed Bullish trend remains unchanged', () => {
  const eth = report('ETHUSDT', {
    oldBias: 'NEUTRAL',
    marketBias: 'BULLISH',
    legacyBias: 'BULLISH',
    phase: 'BULLISH_CONTINUATION',
    context: 'CONTINUATION',
    liquidity: [{ type: 'PDL', price: 98 }],
  });
  const result = Audit.analyzeReports([eth]).results[0];

  assert.strictEqual(result.currentGateState, 'WAITING_OPPORTUNITY');
  assert.strictEqual(result.shadowGateState, 'WAITING_OPPORTUNITY');
  assert.strictEqual(result.confirmedTrendChanged, false);
});

test('confirmed Bearish WATCH_ZONE remains unchanged', () => {
  const bnb = report('BNBUSDT', {
    oldBias: 'NEUTRAL',
    marketBias: 'BEARISH',
    legacyBias: 'BEARISH',
    phase: 'BEARISH_PULLBACK',
    context: 'CONTINUATION',
    liquidity: [{ type: 'EQUAL_HIGH', price: 100.2 }],
  });
  const result = Audit.analyzeReports([bnb]).results[0];

  assert.strictEqual(result.currentGateState, 'WATCH_ZONE');
  assert.strictEqual(result.shadowGateState, 'WATCH_ZONE');
  assert.strictEqual(result.confirmedTrendChanged, false);
});

test('Neutral without POST_MSS context is not relabeled', () => {
  const value = report('RANGEUSDT', {
    oldBias: 'NEUTRAL',
    marketBias: 'NEUTRAL',
    transitionDirection: 'BULLISH',
    phase: 'BULLISH_PULLBACK',
    context: 'CONTINUATION',
  });
  const result = Audit.analyzeReports([value]).results[0];

  assert.strictEqual(result.semanticApplied, false);
  assert.strictEqual(result.currentGateState, result.shadowGateState);
});

test('transition safety and confirmed trend invariants pass', () => {
  const eth = report('ETHUSDT', {
    oldBias: 'NEUTRAL',
    marketBias: 'BULLISH',
    phase: 'BULLISH_CONTINUATION',
  });
  const audit = Audit.analyzeReports(transitions.concat([eth]));

  assert.strictEqual(audit.summary.transitionSafetyViolations, 0);
  assert.strictEqual(audit.summary.confirmedTrendChanges, 0);
});

test('audit is immutable and unavailable data remains safe', () => {
  const input = JSON.parse(JSON.stringify(transitions));
  const before = JSON.stringify(input);
  const unavailable = Audit.analyzeReports([{
    symbol: 'BTCUSDT',
    dataUnavailable: true,
    reason: 'BINANCE_TIMEOUT',
  }]);

  Audit.analyzeReports(input);

  assert.strictEqual(JSON.stringify(input), before);
  assert.strictEqual(unavailable.summary.unavailable, 1);
  assert.strictEqual(unavailable.summary.changed, 0);
});

test('runner writes only the requested Transition Gate report', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-transition-gate-shadow-')
  );
  const outputPath = path.join(directory, 'audit.txt');
  const result = await Audit.run({
    reports: transitions,
    outputPath,
    currentTime: START,
    output() {},
  });

  assert.strictEqual(result.outputPath, outputPath);
  assert.strictEqual(
    await fs.readFile(outputPath, 'utf8'),
    result.body
  );
  assert.ok(result.body.includes('HTF_TRANSITION'));
  assert.deepStrictEqual(
    (await fs.readdir(directory)).sort(),
    ['audit.txt']
  );
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
