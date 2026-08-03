'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Audit = require(
  '../scripts/runHtfDailyBiasShadowAudit'
);

let testsPassed = 0;

function test(name, callback) {
  Promise.resolve()
    .then(callback)
    .then(() => {
      testsPassed += 1;
      console.log('PASS:', name);
    })
    .catch((error) => {
      console.error('FAIL:', name);
      process.exitCode = 1;
      throw error;
    });
}

function phase(state, values) {
  return {
    state,
    direction: state.indexOf('BULLISH_') === 0
      ? 'BULLISH'
      : state.indexOf('BEARISH_') === 0
        ? 'BEARISH'
        : null,
    context: 'CONTINUATION',
    transitionPending: false,
    ...(values || {}),
  };
}

function sample(symbol, values) {
  values = values || {};
  const price = values.price || 110;
  return {
    symbol,
    htfBiasState: {
      referencePrice: price,
      narrative: { bias: values.oldBias },
      dealingRange: {
        high: 120,
        low: 80,
        equilibrium: 100,
        location: values.location,
      },
      liquidity: {
        buySideLiquidity: [{
          type: 'PDH',
          side: 'BUY_SIDE',
          price: 125,
          status: 'ACTIVE',
          availableIndex: 4,
        }],
        sellSideLiquidity: [{
          type: 'PDL',
          side: 'SELL_SIDE',
          price: 75,
          status: 'ACTIVE',
          availableIndex: 4,
        }],
      },
    },
    structurePhaseAnalysis: {
      current: phase(values.phase, values.phaseValues),
      states: values.states || [],
    },
  };
}

const cases = [
  sample('ETHUSDT', {
    oldBias: 'NEUTRAL',
    phase: 'BULLISH_CONTINUATION',
    location: 'PREMIUM',
  }),
  sample('CLUSDT', {
    oldBias: 'NEUTRAL',
    phase: 'BEARISH_CONTINUATION',
    location: 'DISCOUNT',
    price: 90,
  }),
  sample('SNDKUSDT', {
    oldBias: 'BEARISH',
    phase: 'BULLISH_PULLBACK',
    location: 'PREMIUM',
    price: 125,
    phaseValues: {
      context: 'POST_MSS',
      transitionPending: true,
    },
  }),
];

test('ETH CL and SNDK expose the frozen semantic changes', () => {
  const audit = Audit.analyzeReports(cases, {
    currentTime: Date.UTC(2026, 7, 3),
  });
  const bySymbol = Object.fromEntries(
    audit.results.map((result) => [result.symbol, result])
  );

  assert.strictEqual(
    bySymbol.ETHUSDT.newMarketBias,
    'BULLISH'
  );
  assert.strictEqual(
    bySymbol.ETHUSDT.htfLocationReadiness,
    'WAIT'
  );
  assert.strictEqual(
    bySymbol.CLUSDT.newMarketBias,
    'BEARISH'
  );
  assert.strictEqual(
    bySymbol.CLUSDT.htfLocationReadiness,
    'WAIT'
  );
  assert.strictEqual(
    bySymbol.SNDKUSDT.newMarketBias,
    'NEUTRAL'
  );
  assert.strictEqual(
    bySymbol.SNDKUSDT.legacyBias,
    'BEARISH'
  );
  assert.strictEqual(
    bySymbol.SNDKUSDT.transitionDirection,
    'BULLISH'
  );
});

test('Direction and transition assessments remain distinct', () => {
  const audit = Audit.analyzeReports(cases);

  assert.strictEqual(
    audit.summary.assessments[
      Audit.ASSESSMENTS.DIRECTION_LOCATION_SEPARATED
    ],
    2
  );
  assert.strictEqual(
    audit.summary.assessments[
      Audit.ASSESSMENTS.TRANSITION_EXPOSED
    ],
    1
  );
  assert.strictEqual(audit.summary.changed, 3);
});

test('Directional draw follows the new Market Bias', () => {
  const audit = Audit.analyzeReports(cases);
  const eth = audit.results[0];
  const cl = audit.results[1];
  const sndk = audit.results[2];

  assert.deepStrictEqual(eth.drawOnLiquidity, {
    side: 'BUY_SIDE',
    type: 'PDH',
    price: 125,
    distancePercent: 13.636363636363635,
  });
  assert.strictEqual(cl.drawOnLiquidity.side, 'SELL_SIDE');
  assert.strictEqual(cl.drawOnLiquidity.type, 'PDL');
  assert.strictEqual(sndk.drawOnLiquidity, null);
});

test('Audit does not mutate production-shaped inputs', () => {
  const input = JSON.parse(JSON.stringify(cases));
  const before = JSON.stringify(input);

  Audit.analyzeReports(input);

  assert.strictEqual(JSON.stringify(input), before);
});

test('Empty input produces a safe report', () => {
  const audit = Audit.analyzeReports([], {
    currentTime: Date.UTC(2026, 7, 3),
  });
  const body = Audit.formatAudit(audit);

  assert.strictEqual(audit.summary.symbols, 0);
  assert.strictEqual(audit.summary.changed, 0);
  assert.ok(body.includes('Production Behavior Modified：NO'));
  assert.ok(body.includes('Manual Review Table'));
});

test('Runner writes only the requested Shadow Audit report', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-daily-bias-shadow-')
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
  assert.deepStrictEqual(
    (await fs.readdir(directory)).sort(),
    ['audit.txt']
  );
});

process.on('beforeExit', () => {
  if (!process.exitCode) {
    console.log('\n' + testsPassed + ' tests passed.');
  }
});
