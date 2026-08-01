'use strict';

var assert = require('assert');
var Daily = require('../scripts/runIctDaily');

var CURRENT_TIME = Date.UTC(2026, 7, 1, 14, 30, 0);
var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

test('daily entry executes all research steps in order', function () {
  var order = [];
  var messages = [];
  return Daily.run({
    currentTime: CURRENT_TIME,
    pipelineRunner: function () {
      order.push('pipeline');
      return { ok: true };
    },
    lifecycleResearchRunner: function () {
      order.push('lifecycle');
      return { outputPath: 'lifecycle.txt' };
    },
    dashboardRunner: function () {
      order.push('dashboard');
      return { outputPath: 'dashboard.txt' };
    },
    output: function (message) {
      messages.push(message);
    },
  }).then(function (result) {
    assert.deepStrictEqual(order, [
      'pipeline',
      'lifecycle',
      'dashboard',
    ]);
    assert.strictEqual(result.succeeded, 3);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(messages.length, 1);
    assert.ok(messages[0].indexOf(
      'Golden Case Pipeline:\nSUCCESS'
    ) >= 0);
    assert.ok(messages[0].indexOf(
      'Lifecycle Research:\nSUCCESS'
    ) >= 0);
    assert.ok(messages[0].indexOf(
      'Research Dashboard:\nSUCCESS'
    ) >= 0);
  });
});

test('one daily step failure never blocks later steps', function () {
  var order = [];
  return Daily.run({
    currentTime: CURRENT_TIME,
    pipelineRunner: function () {
      order.push('pipeline');
      throw new Error('pipeline unavailable');
    },
    lifecycleResearchRunner: function () {
      order.push('lifecycle');
      return Promise.resolve({ ok: true });
    },
    dashboardRunner: function () {
      order.push('dashboard');
      throw new Error('dashboard unavailable');
    },
    output: function () {},
  }).then(function (result) {
    assert.deepStrictEqual(order, [
      'pipeline',
      'lifecycle',
      'dashboard',
    ]);
    assert.strictEqual(result.succeeded, 1);
    assert.strictEqual(result.failed, 2);
    assert.strictEqual(
      result.steps.goldenCasePipeline.status,
      'FAILED'
    );
    assert.strictEqual(
      result.steps.lifecycleResearch.status,
      'SUCCESS'
    );
    assert.strictEqual(
      result.steps.researchDashboard.status,
      'FAILED'
    );
    assert.ok(result.message.indexOf(
      'Error: pipeline unavailable'
    ) >= 0);
    assert.ok(result.message.indexOf(
      'Error: dashboard unavailable'
    ) >= 0);
  });
});

test('daily entry forwards shared paths without nested logs', function () {
  var received = {};
  return Daily.run({
    currentTime: CURRENT_TIME,
    casesDirectory: '/tmp/ict-cases-test',
    lifecycleFilePath: '/tmp/ict-lifecycle-test.json',
    lifecycleResearchOutputPath:
      '/tmp/ict-lifecycle-research-test.txt',
    dashboardOutputPath: '/tmp/ict-dashboard-test.txt',
    pipelineRunner: function (options) {
      received.pipeline = options;
      options.output('must stay hidden');
      return {};
    },
    lifecycleResearchRunner: function (options) {
      received.lifecycle = options;
      return {};
    },
    dashboardRunner: function (options) {
      received.dashboard = options;
      return {};
    },
    output: function () {},
  }).then(function () {
    assert.strictEqual(
      received.pipeline.casesDirectory,
      '/tmp/ict-cases-test'
    );
    assert.strictEqual(
      received.lifecycle.lifecycleFilePath,
      '/tmp/ict-lifecycle-test.json'
    );
    assert.strictEqual(
      received.lifecycle.outputPath,
      '/tmp/ict-lifecycle-research-test.txt'
    );
    assert.strictEqual(
      received.dashboard.outputPath,
      '/tmp/ict-dashboard-test.txt'
    );
  });
});

function runTests(index) {
  if (index >= tests.length) {
    console.log('\n' + testsPassed + ' tests passed.');
    return Promise.resolve();
  }
  return Promise.resolve(tests[index].callback()).then(function () {
    testsPassed += 1;
    console.log('PASS:', tests[index].name);
    return runTests(index + 1);
  }).catch(function (error) {
    console.error('FAIL:', tests[index].name);
    throw error;
  });
}

runTests(0).catch(function (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
