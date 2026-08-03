'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const OpportunityDetector = require(
  '../indicators/ictOpportunityDetector'
);
const Audit = require(
  '../scripts/runDailyBiasOpportunityShadowAudit'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function opportunity(direction, currentPrice, liquidity) {
  return OpportunityDetector.detect({
    h4Bias: direction,
    currentPrice,
    liquidity,
  });
}

function report(symbol, values) {
  values = values || {};
  const currentPrice = values.currentPrice || 100;
  const liquidity = values.liquidity || [];
  return {
    symbol,
    currentPrice,
    liquidity,
    current: {
      fourHourAnalysis: {
        bias: values.oldBias,
        dailyBias: {
          marketBias: values.newBias,
          transitionDirection:
            values.transitionDirection || null,
          structureState: values.phase,
        },
      },
      structurePhase: { state: values.phase },
      opportunity: opportunity(
        values.oldBias,
        currentPrice,
        liquidity
      ),
    },
  };
}

const cases = [
  report('BTCUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'NEUTRAL',
    phase: 'BEARISH_PULLBACK',
    transitionDirection: 'BEARISH',
    liquidity: [{ type: 'EQUAL_HIGH', price: 100.2 }],
  }),
  report('BNBUSDT', {
    oldBias: 'BEARISH',
    newBias: 'BEARISH',
    phase: 'BEARISH_CONTINUATION',
    liquidity: [{ type: 'EQUAL_HIGH', price: 100.2 }],
  }),
  report('ETHUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'BULLISH',
    phase: 'BULLISH_CONTINUATION',
    liquidity: [{ type: 'PDL', price: 99.8 }],
  }),
  report('SNDKUSDT', {
    oldBias: 'BEARISH',
    newBias: 'NEUTRAL',
    phase: 'BULLISH_PULLBACK',
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

test('compares all requested symbols using the unchanged detector', () => {
  const audit = Audit.analyzeReports(cases, {
    currentTime: Date.UTC(2026, 7, 3),
  });

  assert.deepStrictEqual(
    audit.results.map((result) => result.symbol),
    Audit.REVIEW_SYMBOLS
  );
  assert.strictEqual(audit.summary.symbols, 8);
  assert.strictEqual(audit.summary.productionParityFailures, 0);
  assert.ok(audit.results.every(
    (result) => result.productionParity === true
  ));
});

test('Daily Bias can activate a new directional WATCH_ZONE', () => {
  const eth = Audit.analyzeReports(cases).results.find(
    (result) => result.symbol === 'ETHUSDT'
  );

  assert.strictEqual(eth.oldObservationState, 'WAITING_OPPORTUNITY');
  assert.strictEqual(eth.newObservationState, 'WATCH_ZONE');
  assert.strictEqual(eth.newOpportunityDirection, 'BULLISH');
  assert.strictEqual(eth.newLiquidityType, 'PDL');
  assert.strictEqual(
    eth.changedReason,
    Audit.CHANGE_REASONS.WATCH_ZONE_ENTERED
  );
});

test('Daily Bias direction can activate WAITING without inventing a zone', () => {
  const cl = Audit.analyzeReports(cases).results.find(
    (result) => result.symbol === 'CLUSDT'
  );

  assert.strictEqual(cl.oldObservationState, 'WAITING_OPPORTUNITY');
  assert.strictEqual(cl.newObservationState, 'WAITING_OPPORTUNITY');
  assert.strictEqual(cl.oldOpportunityDirection, null);
  assert.strictEqual(cl.newOpportunityDirection, 'BEARISH');
  assert.strictEqual(cl.newLiquidityType, null);
  assert.strictEqual(
    cl.changedReason,
    Audit.CHANGE_REASONS.DAILY_BIAS_DIRECTION_ACTIVATED
  );
});

test('Transition suppresses the old opportunity and never creates a new one', () => {
  const sndk = Audit.analyzeReports(cases).results.find(
    (result) => result.symbol === 'SNDKUSDT'
  );

  assert.strictEqual(sndk.oldObservationState, 'WATCH_ZONE');
  assert.strictEqual(sndk.newObservationState, 'WAITING_OPPORTUNITY');
  assert.strictEqual(sndk.newOpportunityDirection, null);
  assert.strictEqual(sndk.newLiquidityType, null);
  assert.strictEqual(sndk.transitionOpportunityViolation, false);
  assert.strictEqual(
    sndk.changedReason,
    Audit.CHANGE_REASONS.TRANSITION_SUPPRESSED_OPPORTUNITY
  );
});

test('Neutral transition cases remain waiting despite nearby liquidity', () => {
  const audit = Audit.analyzeReports(cases);
  const transitions = audit.results.filter(
    (result) => result.transitionDirection
  );

  assert.strictEqual(transitions.length, 3);
  assert.ok(transitions.every(
    (result) => result.newObservationState ===
      'WAITING_OPPORTUNITY'
  ));
  assert.strictEqual(audit.summary.transitionViolations, 0);
});

test('active liquidity changes are retained in the comparison', () => {
  const audit = Audit.analyzeReports(cases);
  const mu = audit.results.find(
    (result) => result.symbol === 'MUUSDT'
  );
  const spcx = audit.results.find(
    (result) => result.symbol === 'SPCXUSDT'
  );

  assert.strictEqual(mu.newLiquidityType, 'PWH');
  assert.strictEqual(spcx.newLiquidityType, 'EQUAL_HIGH');
  assert.ok(audit.summary.liquidityChanges >= 3);
});

test('Shadow Audit does not mutate reports or liquidity', () => {
  const input = JSON.parse(JSON.stringify(cases));
  const before = JSON.stringify(input);

  Audit.analyzeReports(input);

  assert.strictEqual(JSON.stringify(input), before);
});

test('unavailable market data is explicit and excluded from changes', () => {
  const audit = Audit.analyzeReports([{
    symbol: 'BNBUSDT',
    dataUnavailable: true,
    reason: 'BINANCE_TIMEOUT',
  }]);

  assert.strictEqual(audit.summary.available, 0);
  assert.strictEqual(audit.summary.unavailable, 1);
  assert.strictEqual(audit.summary.changed, 0);
  assert.strictEqual(
    audit.results[0].changedReason,
    Audit.CHANGE_REASONS.DATA_UNAVAILABLE
  );
});

test('runner writes only the requested Shadow Audit report', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-opportunity-shadow-')
  );
  const outputPath = path.join(directory, 'audit.txt');
  const result = await Audit.run({
    reports: cases,
    outputPath,
    currentTime: Date.UTC(2026, 7, 3),
    output() {},
  });

  assert.strictEqual(result.outputPath, outputPath);
  assert.strictEqual(
    await fs.readFile(outputPath, 'utf8'),
    result.body
  );
  assert.ok(result.body.includes('WAITING_OPPORTUNITY'));
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
