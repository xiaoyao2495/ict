'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Audit = require(
  '../scripts/runHtfDailyBiasTimelineAudit'
);

const FOUR_HOURS = 4 * 60 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;
const START = Date.UTC(2026, 0, 1);
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

function bar(index, duration, close) {
  const openTime = START + index * duration;
  return {
    openTime,
    closeTime: openTime + duration - 1,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
  };
}

function phaseState(index, state, values) {
  return {
    index,
    availableIndex: index,
    phaseAvailableIndex: index,
    structurePhase: state,
    direction: state.indexOf('BULLISH_') === 0
      ? 'BULLISH'
      : state.indexOf('BEARISH_') === 0
        ? 'BEARISH'
        : null,
    context: 'CONTINUATION',
    transitionPending: false,
    sourceEvent: null,
    mssEvent: null,
    confirmationBos: null,
    ...(values || {}),
  };
}

function htfState(index, bias, price, location) {
  return {
    index,
    availableIndex: index,
    time: START + (index + 1) * FOUR_HOURS - 1,
    referencePrice: price,
    dealingRange: {
      high: 120,
      low: 80,
      equilibrium: 100,
      location,
      availableIndex: index,
    },
    liquidity: {
      buySideLiquidity: [{
        type: 'PDH',
        side: 'BUY_SIDE',
        price: 125,
        status: 'ACTIVE',
        availableIndex: index,
      }],
      sellSideLiquidity: [{
        type: 'PDL',
        side: 'SELL_SIDE',
        price: 75,
        status: 'ACTIVE',
        availableIndex: index,
      }],
    },
    narrative: { bias },
  };
}

function semanticFixture() {
  const klines = [
    bar(0, FOUR_HOURS, 110),
    bar(1, FOUR_HOURS, 108),
    bar(2, FOUR_HOURS, 105),
    bar(3, FOUR_HOURS, 95),
  ];
  const htfStates = [
    htfState(0, 'BEARISH', 110, 'PREMIUM'),
    htfState(1, 'BEARISH', 108, 'PREMIUM'),
    htfState(2, 'NEUTRAL', 105, 'PREMIUM'),
    htfState(3, 'NEUTRAL', 95, 'DISCOUNT'),
  ];
  const bearish = phaseState(0, 'BEARISH_CONTINUATION');
  const bullishMss = phaseState(1, 'BULLISH_MSS', {
    context: 'POST_MSS',
    transitionPending: true,
    mssEvent: { availableIndex: 1 },
  });
  const bullishPullback = phaseState(2, 'BULLISH_PULLBACK', {
    context: 'POST_MSS',
    transitionPending: true,
    phaseAvailableIndex: 2,
    mssEvent: { availableIndex: 1 },
  });
  const bullishConfirmed = phaseState(3, 'BULLISH_CONFIRMED', {
    context: 'POST_MSS',
    transitionPending: false,
    confirmationBos: { availableIndex: 3 },
  });
  return {
    klines,
    htfAnalysis: { states: htfStates },
    phaseAnalysis: {
      states: [
        bearish,
        bullishMss,
        bullishPullback,
        bullishConfirmed,
      ],
    },
  };
}

test('Timeline creates one causal Daily Bias state per 4H node', () => {
  const fixture = semanticFixture();
  const timeline = Audit.buildTimelineFromAnalyses(
    fixture.klines,
    fixture.htfAnalysis,
    fixture.phaseAnalysis
  );

  assert.strictEqual(timeline.length, fixture.klines.length);
  assert.deepStrictEqual(
    timeline.map((state) => state.availableIndex),
    [0, 1, 2, 3]
  );
  assert.deepStrictEqual(
    timeline.map((state) => state.marketBias),
    ['BEARISH', 'NEUTRAL', 'NEUTRAL', 'BULLISH']
  );
  assert.deepStrictEqual(
    timeline.map((state) => state.transitionDirection),
    [null, 'BULLISH', 'BULLISH', null]
  );
});

test('MSS Pullback and Confirmed transitions publish at their own index', () => {
  const fixture = semanticFixture();
  const timeline = Audit.buildTimelineFromAnalyses(
    fixture.klines,
    fixture.htfAnalysis,
    fixture.phaseAnalysis
  );

  assert.strictEqual(timeline[0].structurePhase,
    'BEARISH_CONTINUATION');
  assert.strictEqual(timeline[1].structurePhase, 'BULLISH_MSS');
  assert.strictEqual(timeline[1].marketBias, 'NEUTRAL');
  assert.strictEqual(timeline[2].structurePhase,
    'BULLISH_PULLBACK');
  assert.strictEqual(timeline[3].structurePhase,
    'BULLISH_CONFIRMED');
  assert.strictEqual(timeline[3].marketBias, 'BULLISH');
});

test('availableIndex audit rejects future-published structure data', () => {
  const fixture = semanticFixture();
  const timeline = Audit.buildTimelineFromAnalyses(
    fixture.klines,
    fixture.htfAnalysis,
    fixture.phaseAnalysis
  );
  const valid = Audit.auditCausality(timeline);
  const invalidTimeline = JSON.parse(JSON.stringify(timeline));
  invalidTimeline[1].mssEvent.availableIndex = 2;
  const invalid = Audit.auditCausality(invalidTimeline);

  assert.strictEqual(valid.pass, true);
  assert.strictEqual(invalid.pass, false);
  assert.strictEqual(invalid.violations[0].source, 'MSS_EVENT');
});

test('5m maps only to the last already closed 4H state', () => {
  const fixture = semanticFixture();
  const timeline = Audit.buildTimelineFromAnalyses(
    fixture.klines,
    fixture.htfAnalysis,
    fixture.phaseAnalysis
  );
  const firstClose = fixture.klines[0].closeTime;
  const secondClose = fixture.klines[1].closeTime;
  const ltf = [
    {
      closeTime: firstClose - 1,
    },
    {
      closeTime: firstClose,
    },
    {
      closeTime: firstClose + FIVE_MINUTES,
    },
    {
      closeTime: secondClose,
    },
  ];
  const result = Audit.mapFiveMinuteBars(timeline, ltf);

  assert.strictEqual(result.pass, true);
  assert.deepStrictEqual(
    result.mappings.map((mapping) => mapping.h4Index),
    [null, 0, 0, 1]
  );
});

test('empty 4H timeline leaves every 5m bar unmapped', () => {
  const result = Audit.mapFiveMinuteBars([], [
    { closeTime: 1000 },
    { closeTime: 2000 },
  ]);

  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.mappedBars, 0);
  assert.strictEqual(result.unmappedBars, 2);
  assert.deepStrictEqual(
    result.mappings.map((mapping) => mapping.h4Index),
    [null, null]
  );
});

test('Transition is explicit and never reduced to directional Bias', () => {
  const fixture = semanticFixture();
  const timeline = Audit.buildTimelineFromAnalyses(
    fixture.klines,
    fixture.htfAnalysis,
    fixture.phaseAnalysis
  );
  const result = Audit.auditTransitionSemantics(timeline);

  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.transitionStates, 2);
});

test('Location WAIT never removes an established Market Bias', () => {
  const fixture = semanticFixture();
  fixture.phaseAnalysis.states = [
    phaseState(0, 'BULLISH_CONTINUATION'),
    phaseState(1, 'BEARISH_CONTINUATION'),
    phaseState(2, 'BULLISH_PULLBACK', {
      context: 'CONTINUATION',
    }),
    phaseState(3, 'BEARISH_CONFIRMED'),
  ];
  const timeline = Audit.buildTimelineFromAnalyses(
    fixture.klines,
    fixture.htfAnalysis,
    fixture.phaseAnalysis
  );
  const result = Audit.auditDirectionReadiness(timeline);

  assert.strictEqual(result.pass, true);
  assert.ok(result.directionalWaitStates > 0);
  assert.deepStrictEqual(
    timeline.map((state) => state.marketBias),
    ['BULLISH', 'BEARISH', 'BULLISH', 'BEARISH']
  );
});

test('Production engines satisfy prefix invariance on closed 4H prefixes', () => {
  const closes = [
    100, 102, 99, 104, 101, 106, 103, 108,
    105, 110, 107, 112, 109, 114, 111, 116,
    113, 118, 115, 120, 117, 122, 119, 124,
  ];
  const klines = closes.map(
    (close, index) => bar(index, FOUR_HOURS, close)
  );
  const full = Audit.buildDailyBiasTimeline(klines).timeline;
  const result = Audit.verifyPrefixInvariance(
    klines,
    full,
    { prefixStep: 4 }
  );

  assert.strictEqual(result.pass, true);
  assert.ok(result.checkedPrefixes >= 6);
  assert.deepStrictEqual(result.mismatches, []);
});

test('Audit does not mutate Kline inputs', () => {
  const h4Klines = Array.from(
    { length: 20 },
    (_, index) => bar(index, FOUR_HOURS, 100 + index % 5)
  );
  const ltf5mKlines = Array.from(
    { length: 10 },
    (_, index) => bar(index, FIVE_MINUTES, 100)
  );
  const input = { symbol: 'BTCUSDT', h4Klines, ltf5mKlines };
  const before = JSON.stringify(input);

  Audit.auditSymbol(input, { prefixStep: 5 });

  assert.strictEqual(JSON.stringify(input), before);
});

test('Runner writes only the requested Timeline Audit report', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-daily-bias-timeline-')
  );
  const outputPath = path.join(directory, 'audit.txt');
  const h4Klines = Array.from(
    { length: 20 },
    (_, index) => bar(index, FOUR_HOURS, 100 + index % 5)
  );
  const result = await Audit.run({
    inputs: [{ symbol: 'BTCUSDT', h4Klines, ltf5mKlines: [] }],
    outputPath,
    prefixStep: 5,
    currentTime: Date.UTC(2026, 7, 3),
    output() {},
  });

  assert.strictEqual(result.audit.productionBehaviorModified, false);
  assert.strictEqual(
    await fs.readFile(outputPath, 'utf8'),
    result.body
  );
  assert.deepStrictEqual(await fs.readdir(directory), ['audit.txt']);
});

process.on('beforeExit', () => {
  if (!process.exitCode) {
    console.log('\n' + testsPassed + ' tests passed.');
  }
});
