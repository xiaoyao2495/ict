'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Audit = require(
  '../scripts/runDailyBiasAlignmentShadowAudit'
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

function report(symbol, values) {
  values = values || {};
  return {
    symbol,
    current: {
      fourHourAnalysis: {
        bias: values.oldBias,
        dailyBias: {
          marketBias: values.newBias,
          transitionDirection:
            values.transitionDirection || null,
        },
      },
      structurePhase: phase(
        values.phase,
        values.phaseValues
      ),
    },
  };
}

const cases = [
  report('BTCUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'NEUTRAL',
    phase: 'BULLISH_MSS',
    transitionDirection: 'BULLISH',
  }),
  report('BNBUSDT', {
    oldBias: 'BEARISH',
    newBias: 'BEARISH',
    phase: 'BEARISH_CONTINUATION',
  }),
  report('ETHUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'BULLISH',
    phase: 'BULLISH_CONTINUATION',
  }),
  report('SNDKUSDT', {
    oldBias: 'BEARISH',
    newBias: 'NEUTRAL',
    phase: 'BULLISH_PULLBACK',
    transitionDirection: 'BULLISH',
    phaseValues: {
      context: 'POST_MSS',
      transitionPending: true,
    },
  }),
  report('CLUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'BEARISH',
    phase: 'BEARISH_CONTINUATION',
  }),
  report('MUUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'BEARISH',
    phase: 'BEARISH_PULLBACK',
  }),
  report('XAUUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'NEUTRAL',
    phase: 'BEARISH_MSS',
    transitionDirection: 'BEARISH',
  }),
  report('SPCXUSDT', {
    oldBias: 'NEUTRAL',
    newBias: 'BEARISH',
    phase: 'BEARISH_PULLBACK',
  }),
];

test('compares Old and Daily Bias through the production analyzer', () => {
  const audit = Audit.analyzeReports(cases, {
    currentTime: Date.UTC(2026, 7, 3),
    dataSource: 'TEST_FIXTURE',
    sourceAsOf: '2026-08-03T00:00:00.000Z',
  });
  const bySymbol = Object.fromEntries(
    audit.results.map((result) => [result.symbol, result])
  );

  assert.strictEqual(bySymbol.BNBUSDT.oldAlignment, 'ALIGNED');
  assert.strictEqual(bySymbol.BNBUSDT.newAlignment, 'ALIGNED');
  assert.strictEqual(bySymbol.ETHUSDT.oldAlignment, 'UNDETERMINED');
  assert.strictEqual(bySymbol.ETHUSDT.newAlignment, 'ALIGNED');
  assert.strictEqual(bySymbol.CLUSDT.newAlignment, 'ALIGNED');
  assert.strictEqual(bySymbol.MUUSDT.newAlignment, 'ALIGNED');
  assert.strictEqual(bySymbol.SPCXUSDT.newAlignment, 'ALIGNED');
  assert.strictEqual(audit.dataSource, 'TEST_FIXTURE');
  assert.strictEqual(
    audit.sourceAsOf,
    '2026-08-03T00:00:00.000Z'
  );
});

test('transition exposure removes a false directional conflict', () => {
  const sndk = Audit.analyzeReports(cases).results.find(
    (result) => result.symbol === 'SNDKUSDT'
  );

  assert.strictEqual(sndk.oldAlignment, 'CONFLICT');
  assert.strictEqual(sndk.newAlignment, 'UNDETERMINED');
  assert.strictEqual(sndk.oldDirection, 'BEARISH');
  assert.strictEqual(sndk.newDirection, 'NEUTRAL');
  assert.strictEqual(sndk.transitionDirection, 'BULLISH');
  assert.strictEqual(
    sndk.changedReason,
    Audit.CHANGE_REASONS.DAILY_BIAS_TRANSITION_EXPOSED
  );
});

test('restored background direction explains new alignment', () => {
  const eth = Audit.analyzeReports(cases).results.find(
    (result) => result.symbol === 'ETHUSDT'
  );

  assert.strictEqual(eth.oldDirection, 'NEUTRAL');
  assert.strictEqual(eth.newDirection, 'BULLISH');
  assert.strictEqual(
    eth.changedReason,
    Audit.CHANGE_REASONS.DAILY_BIAS_DIRECTION_RESTORED
  );
});

test('all requested review symbols are represented independently', () => {
  const audit = Audit.analyzeReports(cases);

  assert.deepStrictEqual(
    audit.results.map((result) => result.symbol),
    Audit.REVIEW_SYMBOLS
  );
  assert.strictEqual(audit.summary.symbols, 8);
  assert.strictEqual(audit.summary.changed, 5);
  assert.strictEqual(audit.summary.unchanged, 3);
});

test('audit input remains immutable', () => {
  const input = JSON.parse(JSON.stringify(cases));
  const before = JSON.stringify(input);

  Audit.analyzeReports(input);

  assert.strictEqual(JSON.stringify(input), before);
});

test('runtime symbol selection includes Watchlist and review symbols', () => {
  const symbols = Audit.auditSymbols({
    watchlistLoader: {
      loadWatchlist() {
        return { symbols: ['BTCUSDT', 'ETHUSDT'] };
      },
    },
  });

  assert.deepStrictEqual(symbols, Audit.REVIEW_SYMBOLS);
});

test('empty input formats a safe shadow report', () => {
  const audit = Audit.analyzeReports([], {
    currentTime: Date.UTC(2026, 7, 3),
  });
  const body = Audit.formatAudit(audit);

  assert.strictEqual(audit.summary.symbols, 0);
  assert.strictEqual(audit.summary.changed, 0);
  assert.ok(body.includes('Production Behavior Modified：NO'));
  assert.ok(body.includes('Comparison Table'));
});

test('unavailable review data is explicit and never counted as change', () => {
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
  assert.strictEqual(audit.results[0].newReason, 'BINANCE_TIMEOUT');
});

test('runner writes only the requested audit report', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-alignment-shadow-')
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
