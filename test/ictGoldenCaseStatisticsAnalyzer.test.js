'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var Analyzer = require(
  '../history/ictGoldenCaseStatisticsAnalyzer'
);
var Formatter = require(
  '../formatters/ictGoldenCaseStatisticsFormatter'
);
var Generator = require(
  '../scripts/generateGoldenCaseStatistics'
);

var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function outcomeFor(status) {
  if (status === 'EMPTY') return {};
  if (status === 'FAILED') {
    return {
      trackingStatus: 'FAILED',
      failed: true,
      failedAt: '2026-07-31T01:00:00.000Z',
    };
  }
  if (status === 'COMPLETED') {
    return {
      trackingStatus: 'COMPLETED',
      failed: false,
      threeRAt: '2026-07-31T01:00:00.000Z',
    };
  }
  return {
    trackingStatus: 'TRACKING',
    failed: false,
  };
}

function goldenCase(options) {
  options = options || {};
  return {
    symbol: options.symbol || 'BTCUSDT',
    createdAt: '2026-07-31T00:00:00.000Z',
    htfBias: {
      bias: options.h4Bias || 'BULLISH',
    },
    structurePhase: {
      state: options.structurePhase || 'BULLISH_CONFIRMED',
    },
    htfAlignment: {
      status: options.htfAlignment || 'ALIGNED',
    },
    opportunity: {
      direction: options.opportunityDirection || 'BULLISH',
      liquidityType: options.liquidityType || 'PDL',
    },
    outcome: outcomeFor(options.outcomeStatus || 'EMPTY'),
  };
}

function findValue(groups, value) {
  var index;
  for (index = 0; index < groups.length; index += 1) {
    if (groups[index].value === value) return groups[index];
  }
  return null;
}

function repeatCases(count, options, completedCount) {
  var result = [];
  var index;
  for (index = 0; index < count; index += 1) {
    var copy = {};
    var key;
    for (key in options) {
      if (Object.prototype.hasOwnProperty.call(options, key)) {
        copy[key] = options[key];
      }
    }
    copy.outcomeStatus = index < completedCount
      ? 'COMPLETED'
      : 'FAILED';
    result.push(goldenCase(copy));
  }
  return result;
}

test('empty cases return safe zero statistics', function () {
  var input = [];
  var before = JSON.stringify(input);
  var statistics = Analyzer.analyze(input);
  assert.strictEqual(statistics.totalCases, 0);
  assert.deepStrictEqual(statistics.outcomeStatus, {
    COMPLETED: 0,
    FAILED: 0,
    TRACKING: 0,
    EMPTY: 0,
  });
  assert.deepStrictEqual(statistics.topCombinations, []);
  assert.strictEqual(
    Formatter.format(statistics),
    '暂无Golden Case统计数据\n'
  );
  assert.strictEqual(JSON.stringify(input), before);
});

test('single completed case has a 100 percent completion rate', function () {
  var input = [goldenCase({ outcomeStatus: 'COMPLETED' })];
  var statistics = Analyzer.analyze(input);
  var cohort = statistics.dimensions.h4Bias[0];
  assert.strictEqual(statistics.totalCases, 1);
  assert.strictEqual(statistics.outcomeStatus.COMPLETED, 1);
  assert.deepStrictEqual(cohort, {
    sampleCount: 1,
    completedCount: 1,
    failedCount: 0,
    completionRate: 1,
    failureRate: 0,
    value: 'BULLISH',
  });
  assert.ok(
    Formatter.format(statistics).indexOf('完成率 100.00%') >= 0
  );
});

test('mixed outcomes separate completed failed tracking and empty', function () {
  var statistics = Analyzer.analyze([
    goldenCase({ outcomeStatus: 'COMPLETED' }),
    goldenCase({ outcomeStatus: 'COMPLETED' }),
    goldenCase({ outcomeStatus: 'FAILED' }),
    goldenCase({ outcomeStatus: 'TRACKING' }),
    goldenCase({ outcomeStatus: 'EMPTY' }),
  ]);
  assert.deepStrictEqual(statistics.outcomeStatus, {
    COMPLETED: 2,
    FAILED: 1,
    TRACKING: 1,
    EMPTY: 1,
  });
  assert.deepStrictEqual(statistics.dimensions.h4Bias[0], {
    sampleCount: 5,
    completedCount: 2,
    failedCount: 1,
    completionRate: 0.4,
    failureRate: 0.2,
    value: 'BULLISH',
  });
});

test('all requested dimensions produce independent cohorts', function () {
  var statistics = Analyzer.analyze([
    goldenCase({ outcomeStatus: 'COMPLETED' }),
    goldenCase({
      symbol: 'ETHUSDT',
      h4Bias: 'BEARISH',
      structurePhase: 'BEARISH_CONFIRMED',
      htfAlignment: 'CONFLICT',
      opportunityDirection: 'BEARISH',
      liquidityType: 'PDH',
      outcomeStatus: 'FAILED',
    }),
    {
      symbol: 'SOLUSDT',
      outcome: { trackingStatus: 'TRACKING' },
    },
  ]);
  var bearish = findValue(
    statistics.dimensions.h4Bias,
    'BEARISH'
  );
  var conflict = findValue(
    statistics.dimensions.htfAlignment,
    'CONFLICT'
  );
  var pdh = findValue(
    statistics.dimensions.liquidityType,
    'PDH'
  );
  var unavailable = findValue(
    statistics.dimensions.structurePhase,
    'UNAVAILABLE'
  );

  assert.strictEqual(bearish.sampleCount, 1);
  assert.strictEqual(bearish.failedCount, 1);
  assert.strictEqual(conflict.failureRate, 1);
  assert.strictEqual(pdh.failedCount, 1);
  assert.strictEqual(unavailable.sampleCount, 1);
  assert.ok(
    Object.prototype.hasOwnProperty.call(
      statistics.dimensions,
      'opportunityDirection'
    )
  );
});

test('Top combinations require ten samples and sort by completion rate', function () {
  var perfect = repeatCases(10, {
    h4Bias: 'BULLISH',
    structurePhase: 'BULLISH_CONFIRMED',
    htfAlignment: 'ALIGNED',
    opportunityDirection: 'BULLISH',
    liquidityType: 'PDL',
  }, 10);
  var largerNinety = repeatCases(20, {
    h4Bias: 'BEARISH',
    structurePhase: 'BEARISH_CONFIRMED',
    htfAlignment: 'ALIGNED',
    opportunityDirection: 'BEARISH',
    liquidityType: 'PDH',
  }, 18);
  var smallerNinety = repeatCases(10, {
    h4Bias: 'BULLISH',
    structurePhase: 'BULLISH_CONTINUATION',
    htfAlignment: 'ALIGNED',
    opportunityDirection: 'BULLISH',
    liquidityType: 'PWL',
  }, 9);
  var excluded = repeatCases(9, {
    h4Bias: 'BEARISH',
    structurePhase: 'BEARISH_CONTINUATION',
    htfAlignment: 'ALIGNED',
    opportunityDirection: 'BEARISH',
    liquidityType: 'PWH',
  }, 9);
  var statistics = Analyzer.analyze(
    perfect.concat(largerNinety, smallerNinety, excluded)
  );

  assert.strictEqual(statistics.topCombinations.length, 3);
  assert.strictEqual(
    statistics.topCombinations[0].liquidityType,
    'PDL'
  );
  assert.strictEqual(
    statistics.topCombinations[0].completionRate,
    1
  );
  assert.strictEqual(
    statistics.topCombinations[1].sampleCount,
    20
  );
  assert.strictEqual(
    statistics.topCombinations[2].sampleCount,
    10
  );
  assert.strictEqual(
    statistics.topCombinations.some(function (item) {
      return item.liquidityType === 'PWH';
    }),
    false
  );
});

test('generator reads cases and writes the statistics report', function () {
  var root;
  var inputDirectory;
  var outputPath;
  var caseData = goldenCase({ outcomeStatus: 'COMPLETED' });
  var originalBody = JSON.stringify(caseData, null, 2) + '\n';

  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-golden-statistics-'
  )).then(function (created) {
    root = created;
    inputDirectory = path.join(root, 'cases');
    outputPath = path.join(root, 'statistics.txt');
    return fs.mkdir(inputDirectory, { recursive: true });
  }).then(function () {
    return fs.writeFile(
      path.join(inputDirectory, 'case.json'),
      originalBody,
      'utf8'
    );
  }).then(function () {
    return Generator.generateGoldenCaseStatistics({
      inputDirectory: inputDirectory,
      outputPath: outputPath,
    });
  }).then(function (result) {
    assert.strictEqual(result.statistics.totalCases, 1);
    return Promise.all([
      fs.readFile(outputPath, 'utf8'),
      fs.readFile(path.join(inputDirectory, 'case.json'), 'utf8'),
    ]);
  }).then(function (contents) {
    assert.ok(contents[0].indexOf('总案例数量：1') >= 0);
    assert.strictEqual(contents[1], originalBody);
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
