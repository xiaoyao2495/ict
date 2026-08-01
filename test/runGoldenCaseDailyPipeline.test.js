'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var Pipeline = require(
  '../scripts/runGoldenCaseDailyPipeline'
);

var CURRENT_TIME = Date.UTC(2026, 6, 31, 0, 0, 0);
var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function temporaryRoot() {
  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-golden-daily-'
  ));
}

function removeRoot(root) {
  if (!root) return Promise.resolve();
  return fs.rm(root, { recursive: true, force: true });
}

function emptyCaptureRunner(order) {
  return function () {
    if (order) order.push('capture');
    return Promise.resolve({
      capturedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      results: [],
    });
  };
}

function emptyWatchlistRunner(order) {
  return function () {
    if (order) order.push('watchlist');
    return Promise.resolve({
      currentTime: CURRENT_TIME,
      results: [],
    });
  };
}

function opportunityAnalysis() {
  return {
    currentTime: CURRENT_TIME,
    results: [{
      symbol: 'BTCUSDT',
      status: 'SUCCESS',
      report: {
        symbol: 'BTCUSDT',
        current: {
          decisionGate: {
            state: 'WATCH_ZONE',
            direction: 'BULLISH',
            activeOpportunity: {
              direction: 'BULLISH',
              liquidityType: 'EQUAL_LOW',
              price: 62782,
            },
            progress: {
              sweepCompleted: false,
              mssCompleted: false,
              displacementCompleted: false,
            },
            reasonCode: 'OPPORTUNITY_WATCH_ZONE',
            transition: {
              changed: true,
              from: 'WAITING_OPPORTUNITY',
              to: 'WATCH_ZONE',
              occurredAt: CURRENT_TIME,
            },
          },
        },
      },
    }],
  };
}

function fileOptions(root) {
  return {
    currentTime: CURRENT_TIME,
    casesDirectory: path.join(root, 'cases'),
    outcomeFilePath: path.join(root, 'outcomes.json'),
    statisticsOutputPath: path.join(root, 'statistics.txt'),
    researchOutputPath: path.join(root, 'research.txt'),
    lifecycleFilePath: path.join(root, 'lifecycle.json'),
    watchlistRunner: emptyWatchlistRunner(),
    captureRunner: emptyCaptureRunner(),
    output: function () {},
  };
}

test('complete pipeline executes every step in order', function () {
  var order = [];
  var messages = [];
  var analysis = opportunityAnalysis();
  return Pipeline.run({
    currentTime: CURRENT_TIME,
    watchlistRunner: function () {
      order.push('watchlist');
      return analysis;
    },
    lifecycleRunner: function (options) {
      order.push('lifecycle');
      assert.strictEqual(options.results, analysis.results);
      return { changed: true, changes: [{}] };
    },
    captureRunner: function (options) {
      order.push('capture');
      return options.watchlistAnalyst.run().then(function (reused) {
        assert.strictEqual(reused, analysis);
        return { capturedCount: 2 };
      });
    },
    outcomeRunner: function () {
      order.push('outcome');
      return Promise.resolve({ updatedCases: 1 });
    },
    statisticsRunner: function () {
      order.push('statistics');
      return Promise.resolve({ outputPath: 'statistics.txt' });
    },
    researchRunner: function () {
      order.push('research');
      return Promise.resolve({ outputPath: 'research.txt' });
    },
    output: function (message) {
      messages.push(message);
    },
  }).then(function (result) {
    assert.deepStrictEqual(order, [
      'watchlist',
      'lifecycle',
      'capture',
      'outcome',
      'statistics',
      'research',
    ]);
    assert.strictEqual(
      result.steps.watchlistReport.status,
      'SUCCESS'
    );
    assert.strictEqual(
      result.steps.lifecycleRecorder.status,
      'SUCCESS'
    );
    assert.strictEqual(result.steps.capture.status, 'SUCCESS');
    assert.strictEqual(
      result.steps.outcomeUpdate.status,
      'SUCCESS'
    );
    assert.strictEqual(result.steps.statistics.status, 'SUCCESS');
    assert.strictEqual(
      result.steps.researchReport.status,
      'SUCCESS'
    );
    assert.strictEqual(messages.length, 1);
    assert.ok(messages[0].indexOf(
      'Golden Case Daily Pipeline'
    ) >= 0);
    assert.ok(messages[0].indexOf(
      '北京时间 2026-07-31 08:00:00'
    ) >= 0);
    assert.ok(messages[0].indexOf(
      '新增生命周期事件：1'
    ) >= 0);
    assert.ok(messages[0].indexOf('新增案例数量：2') >= 0);
    assert.ok(messages[0].indexOf('更新案例数量：1') >= 0);
    assert.ok(messages[0].indexOf('Statistics:\n生成成功') >= 0);
    assert.ok(messages[0].indexOf(
      'Research Report:\n生成成功'
    ) >= 0);
  });
});

test('one failed step does not stop later steps', function () {
  var order = [];
  return Pipeline.run({
    currentTime: CURRENT_TIME,
    watchlistRunner: emptyWatchlistRunner(order),
    lifecycleRunner: function () {
      order.push('lifecycle');
      return { changed: false, changes: [] };
    },
    captureRunner: function () {
      order.push('capture');
      return Promise.reject(new Error('capture failed'));
    },
    outcomeRunner: function () {
      order.push('outcome');
      return { updatedCases: 0 };
    },
    statisticsRunner: function () {
      order.push('statistics');
      return { outputPath: 'statistics.txt' };
    },
    researchRunner: function () {
      order.push('research');
      return { outputPath: 'research.txt' };
    },
    output: function () {},
  }).then(function (result) {
    assert.deepStrictEqual(order, [
      'watchlist',
      'lifecycle',
      'capture',
      'outcome',
      'statistics',
      'research',
    ]);
    assert.strictEqual(result.steps.capture.status, 'FAILED');
    assert.strictEqual(
      result.steps.outcomeUpdate.status,
      'SUCCESS'
    );
    assert.strictEqual(result.steps.statistics.status, 'SUCCESS');
    assert.strictEqual(
      result.steps.researchReport.status,
      'SUCCESS'
    );
    assert.ok(result.message.indexOf(
      '新增案例数量：失败（capture failed）'
    ) >= 0);
    assert.ok(result.message.indexOf(
      'Research Report:\n生成成功'
    ) >= 0);
  });
});

test('lifecycle transition is recorded from latest report', function () {
  var root;
  var options;
  return temporaryRoot().then(function (created) {
    root = created;
    options = fileOptions(root);
    options.watchlistRunner = function () {
      return opportunityAnalysis();
    };
    return Pipeline.run(options);
  }).then(function (result) {
    assert.strictEqual(
      result.steps.lifecycleRecorder.status,
      'SUCCESS'
    );
    assert.strictEqual(
      result.steps.lifecycleRecorder.value.changed,
      true
    );
    assert.strictEqual(
      result.steps.lifecycleRecorder.value.changes.length,
      1
    );
    return fs.readFile(path.join(root, 'lifecycle.json'), 'utf8');
  }).then(function (body) {
    var stored = JSON.parse(body);
    var record = stored.symbols.BTCUSDT.opportunities[
      'BULLISH|EQUAL_LOW|62782'
    ];
    assert.strictEqual(record.currentState, 'WATCH_ZONE');
    assert.strictEqual(record.events.length, 1);
  }).finally(function () {
    return removeRoot(root);
  });
});

test('repeated pipeline run does not duplicate transition', function () {
  var root;
  var options;
  return temporaryRoot().then(function (created) {
    root = created;
    options = fileOptions(root);
    options.watchlistRunner = function () {
      return opportunityAnalysis();
    };
    return Pipeline.run(options);
  }).then(function (first) {
    assert.strictEqual(
      first.steps.lifecycleRecorder.value.changes.length,
      1
    );
    return Pipeline.run(options);
  }).then(function (second) {
    assert.strictEqual(
      second.steps.lifecycleRecorder.value.changed,
      false
    );
    assert.strictEqual(
      second.steps.lifecycleRecorder.value.changes.length,
      0
    );
    return fs.readFile(path.join(root, 'lifecycle.json'), 'utf8');
  }).then(function (body) {
    var stored = JSON.parse(body);
    var record = stored.symbols.BTCUSDT.opportunities[
      'BULLISH|EQUAL_LOW|62782'
    ];
    assert.strictEqual(record.events.length, 1);
  }).finally(function () {
    return removeRoot(root);
  });
});

test('lifecycle failure does not stop later pipeline steps', function () {
  var order = [];
  return Pipeline.run({
    currentTime: CURRENT_TIME,
    watchlistRunner: emptyWatchlistRunner(order),
    lifecycleRunner: function () {
      order.push('lifecycle');
      throw new Error('lifecycle failed');
    },
    captureRunner: emptyCaptureRunner(order),
    outcomeRunner: function () {
      order.push('outcome');
      return { updatedCases: 0 };
    },
    statisticsRunner: function () {
      order.push('statistics');
      return {};
    },
    researchRunner: function () {
      order.push('research');
      return {};
    },
    output: function () {},
  }).then(function (result) {
    assert.deepStrictEqual(order, [
      'watchlist',
      'lifecycle',
      'capture',
      'outcome',
      'statistics',
      'research',
    ]);
    assert.strictEqual(
      result.steps.lifecycleRecorder.status,
      'FAILED'
    );
    assert.strictEqual(result.steps.capture.status, 'SUCCESS');
    assert.strictEqual(
      result.steps.outcomeUpdate.status,
      'SUCCESS'
    );
    assert.strictEqual(result.steps.statistics.status, 'SUCCESS');
    assert.strictEqual(
      result.steps.researchReport.status,
      'SUCCESS'
    );
    assert.ok(result.message.indexOf(
      '记录失败（lifecycle failed）'
    ) >= 0);
  });
});

test('empty cases directory completes all maintenance steps', function () {
  var root;
  return temporaryRoot().then(function (created) {
    root = created;
    return Pipeline.run(fileOptions(root));
  }).then(function (result) {
    assert.strictEqual(
      result.steps.watchlistReport.status,
      'SUCCESS'
    );
    assert.strictEqual(
      result.steps.lifecycleRecorder.status,
      'SUCCESS'
    );
    assert.strictEqual(
      result.steps.lifecycleRecorder.value.changed,
      false
    );
    assert.strictEqual(result.steps.capture.status, 'SUCCESS');
    assert.strictEqual(
      result.steps.outcomeUpdate.value.casesScanned,
      0
    );
    assert.strictEqual(
      result.steps.statistics.value.statistics.totalCases,
      0
    );
    assert.strictEqual(
      result.steps.researchReport.value.research
        .overview.totalCases,
      0
    );
    return Promise.all([
      fs.readFile(path.join(root, 'statistics.txt'), 'utf8'),
      fs.readFile(path.join(root, 'research.txt'), 'utf8'),
    ]);
  }).then(function (contents) {
    assert.strictEqual(
      contents[0],
      '暂无Golden Case统计数据\n'
    );
    assert.strictEqual(
      contents[1],
      '暂无Golden Case研究数据\n'
    );
  }).finally(function () {
    return removeRoot(root);
  });
});

test('repeated empty pipeline runs are idempotent', function () {
  var root;
  var firstMessage;
  var firstFiles;
  return temporaryRoot().then(function (created) {
    root = created;
    return Pipeline.run(fileOptions(root));
  }).then(function (first) {
    firstMessage = first.message;
    return Promise.all([
      fs.readFile(path.join(root, 'statistics.txt'), 'utf8'),
      fs.readFile(path.join(root, 'research.txt'), 'utf8'),
    ]);
  }).then(function (contents) {
    firstFiles = contents;
    return Pipeline.run(fileOptions(root));
  }).then(function (second) {
    assert.strictEqual(second.message, firstMessage);
    assert.strictEqual(
      second.steps.outcomeUpdate.value.updatedCases,
      0
    );
    return Promise.all([
      fs.readFile(path.join(root, 'statistics.txt'), 'utf8'),
      fs.readFile(path.join(root, 'research.txt'), 'utf8'),
    ]);
  }).then(function (secondFiles) {
    assert.deepStrictEqual(secondFiles, firstFiles);
  }).finally(function () {
    return removeRoot(root);
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
