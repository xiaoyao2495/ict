'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var Analyzer = require(
  '../history/ictGoldenCaseLifecycleResearchAnalyzer'
);
var Formatter = require(
  '../formatters/ictGoldenCaseLifecycleResearchFormatter'
);
var Generator = require(
  '../scripts/generateGoldenCaseLifecycleResearch'
);

var START = '2026-08-01T00:00:00.000Z';
var ID = 'BULLISH|EQUAL_LOW|62782';
var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function event(from, to, activeOpportunity) {
  return {
    timestamp: START,
    from: from,
    to: to,
    reasonCode: to,
    activeOpportunity: activeOpportunity === undefined
      ? {
        direction: 'BULLISH',
        liquidityType: 'EQUAL_LOW',
        price: 62782,
      }
      : activeOpportunity,
    progress: {},
  };
}

function lifecycle(events, options) {
  options = options || {};
  var id = options.opportunityId || ID;
  var symbol = options.symbol || 'BTCUSDT';
  var currentState = options.currentState ||
    events[events.length - 1].to;
  var record = {
    opportunityId: id,
    symbol: symbol,
    createdAt: START,
    events: events,
    currentState: currentState,
    completed: currentState === 'INVALIDATED',
  };
  var state = { version: 1, symbols: {} };
  state.symbols[symbol] = {
    currentOpportunityId: record.completed ? null : id,
    opportunities: {},
  };
  state.symbols[symbol].opportunities[id] = record;
  return state;
}

function mergeLifecycle(states) {
  var merged = { version: 1, symbols: {} };
  states.forEach(function (state) {
    Object.keys(state.symbols).forEach(function (symbol) {
      merged.symbols[symbol] = state.symbols[symbol];
    });
  });
  return merged;
}

function goldenCase(status, options) {
  options = options || {};
  return {
    symbol: options.symbol || 'BTCUSDT',
    createdAt: START,
    decisionGate: {
      activeOpportunity: {
        id: options.opportunityId || ID,
        direction: options.direction || 'BULLISH',
        liquidityType: options.liquidityType || 'EQUAL_LOW',
        price: options.price === undefined ? 62782 : options.price,
      },
      sourceState: {
        h4Bias: options.h4Bias || 'BULLISH',
        structurePhase:
          options.structurePhase || 'BULLISH_CONFIRMED',
        htfAlignment: options.htfAlignment || 'ALIGNED',
      },
    },
    htfBias: { bias: options.h4Bias || 'BULLISH' },
    structurePhase: {
      state: options.structurePhase || 'BULLISH_CONFIRMED',
    },
    htfAlignment: {
      status: options.htfAlignment || 'ALIGNED',
    },
    opportunity: {
      direction: options.direction || 'BULLISH',
      liquidityType: options.liquidityType || 'EQUAL_LOW',
      liquidityPrice: options.price === undefined ? 62782 : options.price,
    },
    outcome: status === 'COMPLETED'
      ? {
        trackingStatus: 'COMPLETED',
        threeRAt: '2026-08-01T03:00:00.000Z',
      }
      : status === 'FAILED'
        ? { trackingStatus: 'FAILED', failed: true }
        : {},
  };
}

function findGroup(items, value) {
  return items.find(function (item) {
    return item.value === value;
  });
}

test('empty and missing lifecycle data returns safe zeros', function () {
  var research = Analyzer.analyze({});
  assert.strictEqual(research.totalOpportunities, 0);
  assert.deepStrictEqual(research.transitionCounts, {
    waitingOpportunityToWatchZone: 0,
    watchZoneToConfirming: 0,
    confirmingToReadyObservation: 0,
    readyObservationToInvalidated: 0,
  });
  assert.strictEqual(
    research.conversionRates.watchZoneToConfirming.rate,
    0
  );
  assert.strictEqual(
    Formatter.format(research),
    '暂无Golden Case Lifecycle研究数据\n'
  );
});

test('single lifecycle counts one Opportunity and WATCH_ZONE', function () {
  var input = lifecycle([
    event('WAITING_OPPORTUNITY', 'WATCH_ZONE'),
  ]);
  var before = JSON.stringify(input);
  var research = Analyzer.analyze({ lifecycle: input });
  assert.strictEqual(research.totalOpportunities, 1);
  assert.strictEqual(
    research.transitionCounts.waitingOpportunityToWatchZone,
    1
  );
  assert.strictEqual(research.overview.watchZoneCount, 1);
  assert.strictEqual(
    research.conversionRates.watchZoneToConfirming.rate,
    0
  );
  assert.strictEqual(JSON.stringify(input), before);
});

test('multi-stage lifecycle calculates every forward conversion', function () {
  var input = lifecycle([
    event('WAITING_OPPORTUNITY', 'WATCH_ZONE'),
    event('WATCH_ZONE', 'CONFIRMING'),
    event('CONFIRMING', 'READY_OBSERVATION'),
  ]);
  var research = Analyzer.analyze({
    lifecycle: input,
    cases: [goldenCase('TRACKING')],
  });
  assert.strictEqual(
    research.transitionCounts.watchZoneToConfirming,
    1
  );
  assert.strictEqual(
    research.transitionCounts.confirmingToReadyObservation,
    1
  );
  assert.strictEqual(
    research.conversionRates.watchZoneToConfirming.rate,
    1
  );
  assert.strictEqual(
    research.conversionRates.confirmingToReady.rate,
    1
  );
  assert.strictEqual(
    research.conversionRates.readyToCompletedOutcome.rate,
    0
  );
});

test('READY to INVALIDATED is counted without becoming Outcome success', function () {
  var input = lifecycle([
    event('WAITING_OPPORTUNITY', 'WATCH_ZONE'),
    event('WATCH_ZONE', 'CONFIRMING'),
    event('CONFIRMING', 'READY_OBSERVATION'),
    event('READY_OBSERVATION', 'INVALIDATED', null),
  ]);
  var research = Analyzer.analyze({
    lifecycle: input,
    cases: [goldenCase('FAILED')],
  });
  assert.strictEqual(
    research.transitionCounts.readyObservationToInvalidated,
    1
  );
  assert.strictEqual(research.overview.invalidatedCount, 1);
  assert.strictEqual(research.overview.completedOutcomeCount, 0);
});

test('COMPLETED Outcome is linked to READY by stable Opportunity ID', function () {
  var input = lifecycle([
    event('WAITING_OPPORTUNITY', 'WATCH_ZONE'),
    event('WATCH_ZONE', 'CONFIRMING'),
    event('CONFIRMING', 'READY_OBSERVATION'),
  ]);
  var research = Analyzer.analyze({
    lifecycle: input,
    cases: [goldenCase('COMPLETED')],
  });
  var biasGroup = findGroup(
    research.dimensions.h4Bias,
    'BULLISH'
  );
  assert.strictEqual(
    research.conversionRates.readyToCompletedOutcome
      .convertedCount,
    1
  );
  assert.strictEqual(
    research.conversionRates.readyToCompletedOutcome.rate,
    1
  );
  assert.strictEqual(biasGroup.completedOutcomeCount, 1);
  assert.strictEqual(biasGroup.readyOutcomeSuccessRate, 1);
  assert.ok(Formatter.format(research).indexOf(
    'READY_OBSERVATION → COMPLETED Outcome：1/1（100.00%）'
  ) >= 0);
});

test('dimensions split independent Opportunities by context', function () {
  var bearishId = 'BEARISH|EQUAL_HIGH|70000';
  var bullish = lifecycle([
    event('WAITING_OPPORTUNITY', 'WATCH_ZONE'),
    event('WATCH_ZONE', 'CONFIRMING'),
  ]);
  var bearish = lifecycle([
    event('WAITING_OPPORTUNITY', 'WATCH_ZONE', {
      direction: 'BEARISH',
      liquidityType: 'EQUAL_HIGH',
      price: 70000,
    }),
  ], {
    symbol: 'ETHUSDT',
    opportunityId: bearishId,
  });
  var research = Analyzer.analyze({
    lifecycle: mergeLifecycle([bullish, bearish]),
    cases: [
      goldenCase('TRACKING'),
      goldenCase('TRACKING', {
        symbol: 'ETHUSDT',
        opportunityId: bearishId,
        direction: 'BEARISH',
        liquidityType: 'EQUAL_HIGH',
        price: 70000,
        h4Bias: 'BEARISH',
        structurePhase: 'BEARISH_CONFIRMED',
      }),
    ],
  });
  assert.strictEqual(research.totalOpportunities, 2);
  assert.strictEqual(
    findGroup(research.dimensions.direction, 'BULLISH')
      .watchZoneToConfirmingRate,
    1
  );
  assert.strictEqual(
    findGroup(research.dimensions.direction, 'BEARISH')
      .watchZoneToConfirmingRate,
    0
  );
  assert.ok(findGroup(
    research.dimensions.structurePhase,
    'BEARISH_CONFIRMED'
  ));
});

test('missing context fields are retained as UNAVAILABLE', function () {
  var input = {
    opportunities: [{
      opportunityId: ID,
      symbol: 'BTCUSDT',
      createdAt: START,
      events: [{
        timestamp: START,
        from: 'WAITING_OPPORTUNITY',
        to: 'WATCH_ZONE',
      }],
      currentState: 'WATCH_ZONE',
    }],
  };
  var research = Analyzer.analyze({
    lifecycle: input,
    cases: [{ symbol: 'BTCUSDT', outcome: null }],
  });
  assert.strictEqual(research.totalOpportunities, 1);
  assert.strictEqual(
    findGroup(research.dimensions.h4Bias, 'UNAVAILABLE')
      .totalOpportunities,
    1
  );
  assert.strictEqual(
    findGroup(research.dimensions.liquidityType, 'UNAVAILABLE')
      .totalOpportunities,
    1
  );
});

test('generator reads lifecycle and cases then writes report', function () {
  var root;
  var casesDirectory;
  var lifecyclePath;
  var outputPath;
  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-lifecycle-research-'
  )).then(function (created) {
    root = created;
    casesDirectory = path.join(root, 'cases');
    lifecyclePath = path.join(root, 'lifecycle.json');
    outputPath = path.join(root, 'research.txt');
    return fs.mkdir(casesDirectory, { recursive: true });
  }).then(function () {
    return Promise.all([
      fs.writeFile(
        lifecyclePath,
        JSON.stringify(lifecycle([
          event('WAITING_OPPORTUNITY', 'WATCH_ZONE'),
          event('WATCH_ZONE', 'CONFIRMING'),
          event('CONFIRMING', 'READY_OBSERVATION'),
        ])),
        'utf8'
      ),
      fs.writeFile(
        path.join(casesDirectory, 'case.json'),
        JSON.stringify(goldenCase('COMPLETED')),
        'utf8'
      ),
    ]);
  }).then(function () {
    return Generator.generateGoldenCaseLifecycleResearch({
      lifecycleFilePath: lifecyclePath,
      casesDirectory: casesDirectory,
      outputPath: outputPath,
    });
  }).then(function (result) {
    assert.strictEqual(result.research.totalOpportunities, 1);
    assert.strictEqual(
      result.research.overview.completedOutcomeCount,
      1
    );
    return fs.readFile(outputPath, 'utf8');
  }).then(function (text) {
    assert.ok(text.indexOf(
      'ICT Golden Case Lifecycle Research V1'
    ) >= 0);
    assert.ok(text.indexOf('Opportunity 总数：1') >= 0);
  }).finally(function () {
    if (!root) return Promise.resolve();
    return fs.rm(root, { recursive: true, force: true });
  });
});

function runTests(index) {
  if (index >= tests.length) {
    console.log('\n' + testsPassed + ' tests passed.');
    return Promise.resolve();
  }
  return Promise.resolve(tests[index].callback())
    .then(function () {
      testsPassed += 1;
      console.log('PASS:', tests[index].name);
      return runTests(index + 1);
    })
    .catch(function (error) {
      console.error('FAIL:', tests[index].name);
      throw error;
    });
}

runTests(0).catch(function (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
