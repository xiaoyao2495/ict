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
  '../scripts/runDailyBiasDecisionGateShadowAudit'
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
    context: values.phaseContext || 'CONTINUATION',
    transitionPending:
      values.transitionDirection !== undefined,
  };
  const oldAlignment = HtfAlignment.analyze({
    biasDirection: values.oldBias,
    structurePhase,
  });
  const oldOpportunity = OpportunityDetector.detect({
    currentPrice,
    h4Bias: values.oldBias,
    liquidity,
  });
  const current = {
    index: 100,
    availableIndex: 100,
    asOf: START,
    fourHourAnalysis: {
      bias: values.oldBias,
      dailyBias: {
        marketBias: values.newBias,
        transitionDirection:
          values.transitionDirection || null,
        structureState: values.phase,
      },
    },
    structurePhase,
    htfAlignment: oldAlignment,
    opportunity: oldOpportunity,
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

const cases = [
  report('BTCUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'NEUTRAL',
    phase: 'BEARISH_PULLBACK',
    phaseContext: 'POST_MSS',
    transitionDirection: 'BEARISH',
    liquidity: [{ type: 'EQUAL_HIGH', price: 100.2 }],
  }),
  report('BNBUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'BEARISH',
    phase: 'BEARISH_PULLBACK',
    liquidity: [{ type: 'EQUAL_HIGH', price: 100.2 }],
  }),
  report('ETHUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'BULLISH',
    phase: 'BULLISH_CONTINUATION',
    liquidity: [{ type: 'PDL', price: 98 }],
  }),
  report('SNDKUSDT', {
    oldBias: 'BEARISH',
    newBias: 'NEUTRAL',
    phase: 'BULLISH_PULLBACK',
    phaseContext: 'POST_MSS',
    transitionDirection: 'BULLISH',
    liquidity: [{ type: 'EQUAL_HIGH', price: 100.2 }],
  }),
  report('CLUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'BEARISH',
    phase: 'BEARISH_CONTINUATION',
    liquidity: [{ type: 'PDH', price: 102 }],
  }),
  report('MUUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'BEARISH',
    phase: 'BEARISH_PULLBACK',
    liquidity: [{ type: 'PWH', price: 100.3 }],
  }),
  report('XAUUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'NEUTRAL',
    phase: 'BEARISH_PULLBACK',
    phaseContext: 'POST_MSS',
    transitionDirection: 'BEARISH',
    liquidity: [{ type: 'PDH', price: 100.1 }],
  }),
  report('SPCXUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'BEARISH',
    phase: 'BEARISH_PULLBACK',
    liquidity: [{ type: 'EQUAL_HIGH', price: 100.4 }],
  }),
];

test('BNB enters WATCH_ZONE only through aligned shadow inputs', () => {
  const bnb = Audit.analyzeReports(cases).results.find(
    (result) => result.symbol === 'BNBUSDT'
  );

  assert.strictEqual(bnb.oldGateState, 'WAITING_HTF');
  assert.strictEqual(bnb.newGateState, 'WATCH_ZONE');
  assert.strictEqual(bnb.newDirection, 'BEARISH');
  assert.strictEqual(bnb.newOpportunity.liquidityType, 'EQUAL_HIGH');
  assert.strictEqual(
    bnb.transitionReason,
    Audit.TRANSITION_REASONS.DAILY_BIAS_ACTIVATES_WATCH_ZONE
  );
});

test('ETH restores Bullish background but only waits for opportunity', () => {
  const eth = Audit.analyzeReports(cases).results.find(
    (result) => result.symbol === 'ETHUSDT'
  );

  assert.strictEqual(eth.oldGateState, 'WAITING_HTF');
  assert.strictEqual(eth.newGateState, 'WAITING_OPPORTUNITY');
  assert.strictEqual(eth.newDirection, 'BULLISH');
  assert.strictEqual(eth.newOpportunity.status, 'WAITING');
});

test('SNDK removes old Bearish direction during Bullish transition', () => {
  const sndk = Audit.analyzeReports(cases).results.find(
    (result) => result.symbol === 'SNDKUSDT'
  );

  assert.strictEqual(sndk.oldGateState, 'HTF_TRANSITION');
  assert.strictEqual(sndk.newGateState, 'HTF_TRANSITION');
  assert.strictEqual(sndk.oldOpportunity.direction, 'BEARISH');
  assert.strictEqual(sndk.newOpportunity.direction, null);
  assert.strictEqual(sndk.newDirection, null);
  assert.strictEqual(sndk.transitionWatchViolation, false);
});

test('MSS and POST_MSS transitions never enter active Gate states', () => {
  const mss = report('MSSUSDT', {
    oldBias: 'BULLISH',
    newBias: 'NEUTRAL',
    phase: 'BULLISH_MSS',
    transitionDirection: 'BULLISH',
    liquidity: [{ type: 'PDL', price: 99.8 }],
  });
  const audit = Audit.analyzeReports(cases.concat([mss]));
  const transitions = audit.results.filter(
    (result) => result.transitionDirection
  );

  assert.ok(transitions.every((result) => ![
    'WATCH_ZONE',
    'CONFIRMING',
    'READY_OBSERVATION',
  ].includes(result.newGateState)));
  assert.strictEqual(audit.summary.transitionWatchViolations, 0);
});

test('Daily Bias replacement cannot directly create CONFIRMING or READY', () => {
  const audit = Audit.analyzeReports(cases);

  assert.strictEqual(audit.summary.directConfirmationViolations, 0);
  assert.ok(audit.results.every((result) => ![
    'CONFIRMING',
    'READY_OBSERVATION',
  ].includes(result.newGateState)));
});

test('old Gate output is reproduced before shadow replacement', () => {
  const audit = Audit.analyzeReports(cases);

  assert.strictEqual(audit.summary.productionParityFailures, 0);
  assert.ok(audit.results.every(
    (result) => result.productionParity === true
  ));
});

test('Shadow Gate audit does not mutate reports', () => {
  const input = JSON.parse(JSON.stringify(cases));
  const before = JSON.stringify(input);

  Audit.analyzeReports(input);

  assert.strictEqual(JSON.stringify(input), before);
});

test('unavailable data remains explicit and safe', () => {
  const audit = Audit.analyzeReports([{
    symbol: 'BNBUSDT',
    dataUnavailable: true,
    reason: 'BINANCE_TIMEOUT',
  }]);

  assert.strictEqual(audit.summary.unavailable, 1);
  assert.strictEqual(audit.summary.changed, 0);
  assert.strictEqual(
    audit.results[0].transitionReason,
    Audit.TRANSITION_REASONS.DATA_UNAVAILABLE
  );
});

test('runner writes only the requested Gate Shadow report', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-gate-shadow-')
  );
  const outputPath = path.join(directory, 'audit.txt');
  const result = await Audit.run({
    reports: cases,
    outputPath,
    currentTime: START,
    output() {},
  });

  assert.strictEqual(result.outputPath, outputPath);
  assert.strictEqual(
    await fs.readFile(outputPath, 'utf8'),
    result.body
  );
  assert.ok(result.body.includes('Old Gate State'));
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
