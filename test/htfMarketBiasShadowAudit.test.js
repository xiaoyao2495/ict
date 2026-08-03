'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const ShadowAudit = require(
  '../scripts/runHtfMarketBiasShadowAudit'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function report(symbol, values) {
  return {
    symbol,
    currentPrice: values.price,
    current: {
      fourHourAnalysis: {
        bias: values.oldBias,
        premiumDiscount: values.location,
        dealingRange: {
          high: values.high,
          low: values.low,
          equilibrium: (values.high + values.low) / 2,
          location: values.location,
        },
      },
      structurePhase: {
        state: values.phase,
        direction: values.phase.indexOf('BULLISH_') === 0
          ? 'BULLISH'
          : 'BEARISH',
        context: values.context || 'CONTINUATION',
        transitionPending:
          values.transitionPending === true,
      },
    },
  };
}

function fixtures() {
  return [
    report('ETHUSDT', {
      oldBias: 'NEUTRAL',
      phase: 'BULLISH_CONTINUATION',
      location: 'PREMIUM',
      high: 1885,
      low: 1820.61,
      price: 1884.37,
    }),
    report('CLUSDT', {
      oldBias: 'NEUTRAL',
      phase: 'BEARISH_CONTINUATION',
      location: 'DISCOUNT',
      high: 88.17,
      low: 80,
      price: 80.77,
    }),
    report('SNDKUSDT', {
      oldBias: 'BEARISH',
      phase: 'BULLISH_PULLBACK',
      context: 'POST_MSS',
      transitionPending: true,
      location: 'PREMIUM',
      high: 1229.93,
      low: 1167.42,
      price: 1243.06,
    }),
    report('BTCUSDT', {
      oldBias: 'NEUTRAL',
      phase: 'UNDETERMINED',
      location: 'PREMIUM',
      high: 120,
      low: 80,
      price: 110,
    }),
  ];
}

test('classifies every frozen difference type', () => {
  assert.strictEqual(
    ShadowAudit.classifyDifference('NEUTRAL', {
      marketBias: 'BULLISH',
    }),
    'OLD_NEUTRAL_NEW_DIRECTION'
  );
  assert.strictEqual(
    ShadowAudit.classifyDifference('BEARISH', {
      marketBias: 'NEUTRAL',
      transitionDirection: 'BULLISH',
    }),
    'OLD_DIRECTION_NEW_TRANSITION'
  );
  assert.strictEqual(
    ShadowAudit.classifyDifference('BULLISH', {
      marketBias: 'BULLISH',
    }),
    'SAME'
  );
  assert.strictEqual(
    ShadowAudit.classifyDifference('BULLISH', {
      marketBias: 'BEARISH',
    }),
    'DIRECTION_CHANGED'
  );
});

test('ETH CL and SNDK shadow cases expose expected changes', () => {
  const audit = ShadowAudit.analyzeReports(fixtures(), {
    currentTime: Date.UTC(2026, 7, 3),
  });
  const bySymbol = Object.fromEntries(
    audit.results.map((item) => [item.symbol, item])
  );

  assert.strictEqual(
    bySymbol.ETHUSDT.newMarketBias,
    'BULLISH'
  );
  assert.strictEqual(bySymbol.ETHUSDT.location, 'PREMIUM');
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
  assert.strictEqual(bySymbol.SNDKUSDT.legacyBias, 'BEARISH');
  assert.strictEqual(
    bySymbol.SNDKUSDT.transitionDirection,
    'BULLISH'
  );
  assert.strictEqual(
    bySymbol.SNDKUSDT.rangeRelation,
    'ABOVE_RANGE'
  );
});

test('summary counts same and changed symbols by category', () => {
  const summary = ShadowAudit.analyzeReports(
    fixtures()
  ).summary;

  assert.strictEqual(summary.symbols, 4);
  assert.strictEqual(summary.same, 1);
  assert.strictEqual(summary.changed, 3);
  assert.strictEqual(
    summary.differenceTypes.OLD_NEUTRAL_NEW_DIRECTION,
    2
  );
  assert.strictEqual(
    summary.differenceTypes.OLD_DIRECTION_NEW_TRANSITION,
    1
  );
});

test('shadow audit does not mutate production reports', () => {
  const reports = fixtures();
  const before = JSON.stringify(reports);

  ShadowAudit.analyzeReports(reports);

  assert.strictEqual(JSON.stringify(reports), before);
  assert.strictEqual(
    reports[0].current.fourHourAnalysis.bias,
    'NEUTRAL'
  );
});

test('run writes only the formatted audit report', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'htf-bias-shadow-')
  );
  const outputPath = path.join(directory, 'audit.txt');
  const result = await ShadowAudit.run({
    reports: fixtures(),
    currentTime: Date.UTC(2026, 7, 3),
    outputPath,
    output() {},
  });
  const saved = await fs.readFile(outputPath, 'utf8');

  assert.strictEqual(saved, result.body);
  assert(saved.includes(
    'Production HTF Market Bias Shadow Audit V1'
  ));
  assert(saved.includes('Symbol：SNDKUSDT'));
  assert(saved.includes(
    'Difference Type：OLD_DIRECTION_NEW_TRANSITION'
  ));
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
