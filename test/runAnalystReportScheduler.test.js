'use strict';

const assert = require('assert');
const Scheduler = require(
  '../scripts/runAnalystReportScheduler'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function quietLogger() {
  return {
    log() {},
    error() {},
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test('scheduler runs immediately and every fixed 15 minutes', async () => {
  let scheduledCallback = null;
  let scheduledDelay = null;
  let clearedTimer = null;
  let calls = 0;
  const timerToken = {};
  const scheduler = Scheduler.createScheduler({
    logger: quietLogger(),
    runNotification: async () => {
      calls += 1;
      return { sent: false };
    },
    setIntervalFn(callback, delay) {
      scheduledCallback = callback;
      scheduledDelay = delay;
      return timerToken;
    },
    clearIntervalFn(token) {
      clearedTimer = token;
    },
  });

  assert.strictEqual(Scheduler.INTERVAL_MINUTES, 15);
  assert.strictEqual(Scheduler.INTERVAL_MS, 900000);
  assert.strictEqual(scheduler.start(), true);
  assert.strictEqual(scheduler.start(), false);
  await scheduler.waitForIdle();
  assert.strictEqual(calls, 1);
  assert.strictEqual(scheduledDelay, Scheduler.INTERVAL_MS);

  scheduledCallback();
  await scheduler.waitForIdle();
  assert.strictEqual(calls, 2);

  await scheduler.stop();
  assert.strictEqual(clearedTimer, timerToken);
  assert.strictEqual(scheduler.isRunning(), false);
});

test('scheduler passes one stable option set to notification run', async () => {
  const notificationOptions = {
    webhookUrl: 'https://example.test/webhook',
    stateFilePath: 'state.json',
  };
  const received = [];
  const scheduler = Scheduler.createScheduler({
    logger: quietLogger(),
    notificationOptions,
    runImmediately: false,
    runNotification: async (options) => {
      received.push(options);
      return { sent: false };
    },
    setIntervalFn() {
      return {};
    },
    clearIntervalFn() {},
  });

  scheduler.start();
  await scheduler.execute('test');
  await scheduler.stop();

  assert.strictEqual(received.length, 1);
  assert.strictEqual(received[0], notificationOptions);
});

test('overlapping ticks do not create duplicate notification runs', async () => {
  let scheduledCallback = null;
  let calls = 0;
  const pending = deferred();
  const scheduler = Scheduler.createScheduler({
    logger: quietLogger(),
    runNotification: async () => {
      calls += 1;
      return pending.promise;
    },
    setIntervalFn(callback) {
      scheduledCallback = callback;
      return {};
    },
    clearIntervalFn() {},
  });

  scheduler.start();
  const overlap = await scheduler.execute('manual');
  scheduledCallback();

  assert.strictEqual(overlap.skipped, true);
  assert.strictEqual(overlap.reason, 'RUN_IN_PROGRESS');
  assert.strictEqual(calls, 1);

  pending.resolve({ sent: false });
  await scheduler.waitForIdle();
  await scheduler.stop();
});

test('a failed run does not stop the next interval', async () => {
  let scheduledCallback = null;
  let calls = 0;
  const scheduler = Scheduler.createScheduler({
    logger: quietLogger(),
    runNotification: async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary failure');
      return { sent: false };
    },
    setIntervalFn(callback) {
      scheduledCallback = callback;
      return {};
    },
    clearIntervalFn() {},
  });

  scheduler.start();
  const failed = await scheduler.waitForIdle();
  assert.ok(failed.error);
  assert.strictEqual(scheduler.isRunning(), true);

  scheduledCallback();
  await scheduler.waitForIdle();
  assert.strictEqual(calls, 2);
  assert.strictEqual(scheduler.isRunning(), true);
  await scheduler.stop();
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
