'use strict';

var assert = require('assert');
var Reporter = require(
  '../notifications/goldenCaseDingTalkReporter'
);
var DailyReportRunner = require(
  '../scripts/sendGoldenCaseDailyReport'
);

var CURRENT_TIME = Date.UTC(2026, 6, 31, 0, 0, 0);
var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function pipelineResult() {
  return {
    currentTime: CURRENT_TIME,
    message: 'Golden Case Daily Pipeline',
    steps: {
      capture: {
        status: 'SUCCESS',
        value: {
          capturedCount: 2,
          results: [
            {
              symbol: 'BTCUSDT',
              status: 'CAPTURED',
              reason: {
                opportunityStatus: 'WATCH_ZONE',
              },
            },
            {
              symbol: 'XAUUSDT',
              status: 'CAPTURED',
              reason: {
                opportunityStatus: 'CONFIRMING',
              },
            },
          ],
        },
      },
      researchReport: {
        status: 'SUCCESS',
        value: {
          research: {
            overview: {
              totalCases: 25,
              completedCount: 12,
              failedCount: 4,
              trackingCount: 7,
            },
            bestConditions: [{
              h4Bias: 'BULLISH',
              structurePhase: 'BULLISH_CONFIRMED',
              htfAlignment: 'ALIGNED',
              opportunityDirection: 'BULLISH',
              liquidityType: 'PDL',
              sampleCount: 10,
              completionRate: 0.8,
            }],
          },
        },
      },
    },
  };
}

test('normally generates and sends the daily report', function () {
  var calls = [];
  var client = {
    post: function (url, payload) {
      calls.push({ url: url, payload: payload });
      return Promise.resolve({ status: 200 });
    },
  };
  return Reporter.sendReport({
    pipelineResult: pipelineResult(),
    webhookUrl: 'https://example.test/webhook',
    httpClient: client,
  }).then(function (result) {
    assert.strictEqual(result.sent, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      calls[0].url,
      'https://example.test/webhook'
    );
    assert.strictEqual(
      calls[0].payload.text.content,
      result.message
    );
    assert.ok(result.message.indexOf(
      'ICT Golden Case Daily'
    ) === 0);
  });
});

test('empty webhook safely skips delivery', function () {
  var called = false;
  return Reporter.sendReport({
    pipelineResult: pipelineResult(),
    webhookUrl: '',
    httpClient: {
      post: function () {
        called = true;
      },
    },
  }).then(function (result) {
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.reason, 'WEBHOOK_MISSING');
    assert.strictEqual(result.error, null);
    assert.strictEqual(called, false);
  });
});

test('send failure is returned without rejecting pipeline work', function () {
  var failure = new Error('DingTalk unavailable');
  return Reporter.sendReport({
    pipelineResult: pipelineResult(),
    webhookUrl: 'https://example.test/webhook',
    httpClient: {
      post: function () {
        return Promise.reject(failure);
      },
    },
  }).then(function (result) {
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.reason, 'SEND_FAILED');
    assert.strictEqual(result.error, failure);
    assert.ok(result.message.indexOf(
      '当前案例总数：\n25'
    ) >= 0);
  });
});

test('message contains the complete required daily format', function () {
  var result = pipelineResult();
  var researchText = [
    'ICT Golden Case Research Dashboard',
    '',
    '1. 总览',
    '案例数量：25',
    '完成数量：12',
    '失败数量：4',
    '追踪中数量：7',
    '',
    '6. 最佳案例条件',
    '1. 4H=BULLISH｜结构阶段=BULLISH_CONFIRMED｜' +
      '一致性=ALIGNED｜机会方向=BULLISH｜流动性=PDL｜' +
      '样本=10｜完成率=80.00%｜失败率=20.00%',
  ].join('\n');
  delete result.steps.researchReport.value.research;
  var message = Reporter.buildMessage({
    pipelineResult: result,
    researchReportText: researchText,
  });
  assert.ok(message.indexOf(
    '日期：\n2026-07-31'
  ) >= 0);
  assert.ok(message.indexOf(
    '今日新增案例：\n2'
  ) >= 0);
  assert.ok(message.indexOf(
    '当前案例总数：\n25'
  ) >= 0);
  assert.ok(message.indexOf(
    'COMPLETED:\n12'
  ) >= 0);
  assert.ok(message.indexOf('FAILED:\n4') >= 0);
  assert.ok(message.indexOf('TRACKING:\n7') >= 0);
  assert.ok(message.indexOf(
    '条件：\n4H=BULLISH｜结构阶段=BULLISH_CONFIRMED'
  ) >= 0);
  assert.ok(message.indexOf('样本：\n10') >= 0);
  assert.ok(message.indexOf('完成率：\n80.00%') >= 0);
  assert.ok(message.indexOf(
    'BTCUSDT:\nWATCH_ZONE'
  ) >= 0);
  assert.ok(message.indexOf(
    'XAUUSDT:\nCONFIRMING'
  ) >= 0);
  assert.ok(message.endsWith('================'));
});

test('DingTalk failure does not reject the completed pipeline', function () {
  var completed = pipelineResult();
  return DailyReportRunner.run({
    pipelineRunner: {
      run: function () {
        return Promise.resolve(completed);
      },
    },
    researchReportPath: 'missing-research-report.txt',
    webhookUrl: 'https://example.test/webhook',
    httpClient: {
      post: function () {
        throw new Error('synchronous transport failure');
      },
    },
  }).then(function (result) {
    assert.strictEqual(result.pipelineResult, completed);
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.delivery.reason, 'SEND_FAILED');
    assert.strictEqual(
      result.error.message,
      'synchronous transport failure'
    );
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
