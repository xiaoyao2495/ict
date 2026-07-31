'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var Aggregator = require(
  '../history/ictGoldenCaseResearchAggregator'
);
var Formatter = require(
  '../formatters/ictGoldenCaseResearchFormatter'
);
var Generator = require(
  '../scripts/generateGoldenCaseResearchReport'
);

var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function outcome(status) {
  if (status === 'EMPTY') return {};
  if (status === 'FAILED') {
    return {
      trackingStatus: 'FAILED',
      failed: true,
      failedAt: '2026-07-31T04:00:00.000Z',
    };
  }
  if (status === 'COMPLETED') {
    return {
      trackingStatus: 'COMPLETED',
      failed: false,
      threeRAt: '2026-07-31T04:00:00.000Z',
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
    createdAt: options.createdAt ||
      '2026-07-31T00:00:00.000Z',
    htfBias: {
      bias: options.h4Bias || 'BULLISH',
    },
    structurePhase: {
      state: options.structurePhase ||
        'BULLISH_CONFIRMED',
      direction: options.structureDirection ||
        'BULLISH',
    },
    htfAlignment: {
      status: options.htfAlignment || 'ALIGNED',
    },
    opportunity: {
      direction: options.opportunityDirection ||
        'BULLISH',
      liquidityType: options.liquidityType || 'PDL',
    },
    outcome: outcome(options.outcomeStatus || 'EMPTY'),
  };
}

function copyOptions(source) {
  var result = {};
  var key;
  for (key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = source[key];
    }
  }
  return result;
}

function repeatCases(count, options, completedCount) {
  var cases = [];
  var index;
  for (index = 0; index < count; index += 1) {
    var item = copyOptions(options);
    item.outcomeStatus = index < completedCount
      ? 'COMPLETED'
      : 'FAILED';
    cases.push(goldenCase(item));
  }
  return cases;
}

function findValue(items, value) {
  var index;
  for (index = 0; index < items.length; index += 1) {
    if (items[index].value === value) return items[index];
  }
  return null;
}

test('empty data returns the required safe research message', function () {
  var input = [];
  var before = JSON.stringify(input);
  var research = Aggregator.analyze(input);
  assert.strictEqual(research.overview.totalCases, 0);
  assert.strictEqual(research.conflictStudy.sampleCount, 0);
  assert.strictEqual(research.timeStudy.busiestHour, null);
  assert.deepStrictEqual(research.bestConditions, []);
  assert.strictEqual(
    Formatter.format(research),
    '暂无Golden Case研究数据\n'
  );
  assert.strictEqual(JSON.stringify(input), before);
});

test('mixed outcomes produce the complete overview', function () {
  var input = [
    goldenCase({ outcomeStatus: 'COMPLETED' }),
    goldenCase({ outcomeStatus: 'COMPLETED' }),
    goldenCase({ outcomeStatus: 'FAILED' }),
    goldenCase({ outcomeStatus: 'TRACKING' }),
    goldenCase({ outcomeStatus: 'EMPTY' }),
  ];
  var snapshot = JSON.stringify(input);
  var research = Aggregator.analyze(input);
  var text = Formatter.format(research);

  assert.deepStrictEqual(research.overview, {
    totalCases: 5,
    completedCount: 2,
    failedCount: 1,
    trackingCount: 1,
    emptyCount: 1,
    completionRate: 0.4,
    failureRate: 0.2,
  });
  assert.strictEqual(
    findValue(research.htfAnalysis.h4Bias, 'BULLISH')
      .sampleCount,
    5
  );
  assert.strictEqual(
    findValue(research.opportunityStudy, 'PDL')
      .sampleCount,
    5
  );
  assert.ok(text.indexOf('完成数量：2') >= 0);
  assert.ok(text.indexOf('失败率：20.00%') >= 0);
  assert.strictEqual(JSON.stringify(input), snapshot);
});

test('Bias and Structure Phase direction conflicts are isolated', function () {
  var research = Aggregator.analyze([
    goldenCase({
      h4Bias: 'BULLISH',
      structurePhase: 'BEARISH_PULLBACK',
      structureDirection: 'BEARISH',
      htfAlignment: 'CONFLICT',
      outcomeStatus: 'COMPLETED',
    }),
    goldenCase({
      h4Bias: 'BEARISH',
      structurePhase: 'BULLISH_CONTINUATION',
      structureDirection: 'BULLISH',
      htfAlignment: 'CONFLICT',
      outcomeStatus: 'FAILED',
    }),
    goldenCase({
      h4Bias: 'BULLISH',
      structurePhase: 'BULLISH_CONFIRMED',
      structureDirection: 'BULLISH',
      outcomeStatus: 'COMPLETED',
    }),
  ]);

  assert.strictEqual(research.conflictStudy.sampleCount, 2);
  assert.strictEqual(research.conflictStudy.completedCount, 1);
  assert.strictEqual(research.conflictStudy.failedCount, 1);
  assert.strictEqual(research.conflictStudy.completionRate, 0.5);
  assert.strictEqual(research.conflictStudy.failureRate, 0.5);
  assert.strictEqual(research.conflictStudy.groups.length, 2);
});

test('Beijing hourly study finds busiest and highest completion hours', function () {
  var research = Aggregator.analyze([
    goldenCase({
      createdAt: '2026-07-31T00:05:00.000Z',
      outcomeStatus: 'COMPLETED',
    }),
    goldenCase({
      createdAt: '2026-07-31T00:35:00.000Z',
      outcomeStatus: 'FAILED',
    }),
    goldenCase({
      createdAt: '2026-07-31T01:05:00.000Z',
      outcomeStatus: 'COMPLETED',
    }),
  ]);
  var hourEight = research.timeStudy.hours[8];
  var hourNine = research.timeStudy.hours[9];

  assert.strictEqual(hourEight.sampleCount, 2);
  assert.strictEqual(hourEight.completionRate, 0.5);
  assert.strictEqual(hourNine.sampleCount, 1);
  assert.strictEqual(hourNine.completionRate, 1);
  assert.strictEqual(research.timeStudy.busiestHour.hour, 8);
  assert.strictEqual(
    research.timeStudy.highestCompletionHour.hour,
    9
  );
});

test('best conditions require ten samples and sort by completion rate', function () {
  var perfect = repeatCases(10, {
    h4Bias: 'BULLISH',
    structurePhase: 'BULLISH_CONFIRMED',
    structureDirection: 'BULLISH',
    htfAlignment: 'ALIGNED',
    opportunityDirection: 'BULLISH',
    liquidityType: 'PDL',
  }, 10);
  var ninety = repeatCases(20, {
    h4Bias: 'BEARISH',
    structurePhase: 'BEARISH_CONFIRMED',
    structureDirection: 'BEARISH',
    htfAlignment: 'ALIGNED',
    opportunityDirection: 'BEARISH',
    liquidityType: 'PWH',
  }, 18);
  var excluded = repeatCases(9, {
    h4Bias: 'BULLISH',
    structurePhase: 'BULLISH_CONTINUATION',
    structureDirection: 'BULLISH',
    htfAlignment: 'ALIGNED',
    opportunityDirection: 'BULLISH',
    liquidityType: 'EQUAL_LOW',
  }, 9);
  var research = Aggregator.analyze(
    perfect.concat(ninety, excluded)
  );

  assert.strictEqual(research.bestConditions.length, 2);
  assert.strictEqual(
    research.bestConditions[0].liquidityType,
    'PDL'
  );
  assert.strictEqual(
    research.bestConditions[0].completionRate,
    1
  );
  assert.strictEqual(
    research.bestConditions[1].completionRate,
    0.9
  );
  assert.strictEqual(
    research.bestConditions.some(function (item) {
      return item.liquidityType === 'EQUAL_LOW';
    }),
    false
  );
});

test('generator writes research output without modifying case JSON', function () {
  var root;
  var inputDirectory;
  var outputPath;
  var inputPath;
  var caseData = goldenCase({ outcomeStatus: 'COMPLETED' });
  var body = JSON.stringify(caseData, null, 2) + '\n';

  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-golden-research-'
  )).then(function (created) {
    root = created;
    inputDirectory = path.join(root, 'cases');
    outputPath = path.join(root, 'research.txt');
    inputPath = path.join(inputDirectory, 'case.json');
    return fs.mkdir(inputDirectory, { recursive: true });
  }).then(function () {
    return fs.writeFile(inputPath, body, 'utf8');
  }).then(function () {
    return Generator.generateGoldenCaseResearchReport({
      inputDirectory: inputDirectory,
      outputPath: outputPath,
    });
  }).then(function (result) {
    assert.strictEqual(result.research.overview.totalCases, 1);
    return Promise.all([
      fs.readFile(outputPath, 'utf8'),
      fs.readFile(inputPath, 'utf8'),
    ]);
  }).then(function (contents) {
    assert.ok(contents[0].indexOf('ICT Golden Case Research') >= 0);
    assert.strictEqual(contents[1], body);
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
