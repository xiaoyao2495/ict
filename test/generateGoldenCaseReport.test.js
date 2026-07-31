'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var Generator = require(
  '../scripts/generateGoldenCaseReport'
);

var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function createWorkspace() {
  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-golden-report-'
  )).then(function (root) {
    var inputDirectory = path.join(root, 'cases');
    var outputPath = path.join(root, 'golden-case-summary.txt');
    return fs.mkdir(inputDirectory, { recursive: true })
      .then(function () {
        return {
          root: root,
          inputDirectory: inputDirectory,
          outputPath: outputPath,
        };
      });
  });
}

function removeWorkspace(workspace) {
  if (!workspace) return Promise.resolve();
  return fs.rm(workspace.root, {
    recursive: true,
    force: true,
  });
}

function writeCase(workspace, fileName, data) {
  return fs.writeFile(
    path.join(workspace.inputDirectory, fileName),
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

function completeCase(symbol, createdAt) {
  return {
    symbol: symbol,
    createdAt: createdAt,
    htfBias: {
      bias: 'BULLISH',
      structure: 'BULLISH',
      premiumDiscount: 'DISCOUNT',
    },
    structurePhase: {
      state: 'BULLISH_CONFIRMED',
      direction: 'BULLISH',
      context: 'Post bullish MSS',
    },
    htfAlignment: {
      status: 'ALIGNED',
      biasDirection: 'BULLISH',
      structureDirection: 'BULLISH',
      reason: 'Bias and structure agree.',
    },
    opportunity: {
      status: 'WATCH_ZONE',
      direction: 'BULLISH',
      liquidityType: 'PDL',
      liquidityPrice: 117500,
    },
    confirmation: {
      status: 'WAITING',
      direction: null,
    },
    outcome: {},
  };
}

test('generates a normal Chinese Golden Case report', function () {
  var workspace;
  return createWorkspace().then(function (created) {
    workspace = created;
    return writeCase(
      workspace,
      '2026-07-31-BTCUSDT.json',
      completeCase(
        'BTCUSDT',
        '2026-07-31T00:00:00.000Z'
      )
    );
  }).then(function () {
    return Generator.generateGoldenCaseReport({
      inputDirectory: workspace.inputDirectory,
      outputPath: workspace.outputPath,
    });
  }).then(function (result) {
    assert.strictEqual(result.cases.length, 1);
    assert.ok(result.text.indexOf('【基础信息】') >= 0);
    assert.ok(result.text.indexOf('交易对：BTCUSDT') >= 0);
    assert.ok(result.text.indexOf('【4小时环境】') >= 0);
    assert.ok(result.text.indexOf(
      '结构阶段：BULLISH_CONFIRMED'
    ) >= 0);
    assert.ok(result.text.indexOf('一致性：一致（ALIGNED）') >= 0);
    assert.ok(result.text.indexOf('【交易机会】') >= 0);
    assert.ok(result.text.indexOf('关注流动性：PDL') >= 0);
    assert.ok(result.text.indexOf('流动性价格：117500') >= 0);
    assert.ok(result.text.indexOf('【5分钟确认】') >= 0);
    assert.ok(result.text.indexOf('等待：Tracking...') >= 0);
    return fs.readFile(workspace.outputPath, 'utf8');
  }).then(function (written) {
    assert.ok(written.indexOf('ICT Golden Case 人工复盘汇总') >= 0);
  }).finally(function () {
    return removeWorkspace(workspace);
  });
});

test('missing fields are rendered safely', function () {
  var workspace;
  return createWorkspace().then(function (created) {
    workspace = created;
    return writeCase(
      workspace,
      'partial.json',
      { symbol: 'ETHUSDT' }
    );
  }).then(function () {
    return Generator.generateGoldenCaseReport({
      inputDirectory: workspace.inputDirectory,
      outputPath: workspace.outputPath,
    });
  }).then(function (result) {
    assert.ok(result.text.indexOf('交易对：ETHUSDT') >= 0);
    assert.ok(result.text.indexOf('记录时间：未记录') >= 0);
    assert.ok(result.text.indexOf('方向：未记录') >= 0);
    assert.ok(result.text.indexOf('结构阶段：未记录') >= 0);
    assert.ok(result.text.indexOf('一致性：未记录') >= 0);
    assert.ok(result.text.indexOf('等待：Tracking...') >= 0);
  }).finally(function () {
    return removeWorkspace(workspace);
  });
});

test('multiple cases are sorted newest first', function () {
  var workspace;
  return createWorkspace().then(function (created) {
    workspace = created;
    return Promise.all([
      writeCase(
        workspace,
        'older.json',
        completeCase(
          'BTCUSDT',
          '2026-07-30T00:00:00.000Z'
        )
      ),
      writeCase(
        workspace,
        'newest.json',
        completeCase(
          'SOLUSDT',
          '2026-07-31T01:00:00.000Z'
        )
      ),
      writeCase(
        workspace,
        'middle.json',
        completeCase(
          'ETHUSDT',
          '2026-07-31T00:00:00.000Z'
        )
      ),
    ]);
  }).then(function () {
    return Generator.generateGoldenCaseReport({
      inputDirectory: workspace.inputDirectory,
      outputPath: workspace.outputPath,
    });
  }).then(function (result) {
    assert.deepStrictEqual(
      result.cases.map(function (entry) {
        return entry.data.symbol;
      }),
      ['SOLUSDT', 'ETHUSDT', 'BTCUSDT']
    );
    assert.ok(
      result.text.indexOf('案例 1：SOLUSDT') <
      result.text.indexOf('案例 2：ETHUSDT')
    );
    assert.ok(
      result.text.indexOf('案例 2：ETHUSDT') <
      result.text.indexOf('案例 3：BTCUSDT')
    );
  }).finally(function () {
    return removeWorkspace(workspace);
  });
});

test('empty directory produces an explicit empty report', function () {
  var workspace;
  return createWorkspace().then(function (created) {
    workspace = created;
    return Generator.generateGoldenCaseReport({
      inputDirectory: workspace.inputDirectory,
      outputPath: workspace.outputPath,
    });
  }).then(function (result) {
    assert.strictEqual(result.cases.length, 0);
    assert.ok(result.text.indexOf('案例数量：0') >= 0);
    assert.ok(result.text.indexOf('暂无可复盘案例。') >= 0);
    return fs.readFile(workspace.outputPath, 'utf8');
  }).then(function (written) {
    assert.strictEqual(written.indexOf('暂无可复盘案例。') >= 0, true);
  }).finally(function () {
    return removeWorkspace(workspace);
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
