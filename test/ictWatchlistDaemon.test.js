'use strict';

const assert = require('assert');
const Daemon = require('../scripts/ictWatchlistDaemon');

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
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('daemon calls notification immediately and every 5 minutes', async () => {
  let scheduledCallback = null;
  let scheduledDelay = null;
  let clearedTimer = null;
  let calls = 0;
  const timerToken = {};
  const daemon = Daemon.createDaemon({
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

  assert.strictEqual(Daemon.INTERVAL_MINUTES, 5);
  assert.strictEqual(Daemon.INTERVAL_MS, 300000);
  assert.strictEqual(daemon.start(), true);
  assert.strictEqual(daemon.start(), false);
  await daemon.waitForIdle();
  assert.strictEqual(calls, 1);
  assert.strictEqual(scheduledDelay, Daemon.INTERVAL_MS);

  scheduledCallback();
  await daemon.waitForIdle();
  assert.strictEqual(calls, 2);

  await daemon.stop();
  assert.strictEqual(clearedTimer, timerToken);
  assert.strictEqual(daemon.isRunning(), false);
});

test('single-run errors are logged and next cycle continues', async () => {
  let scheduledCallback = null;
  let calls = 0;
  const errors = [];
  const daemon = Daemon.createDaemon({
    logger: {
      log() {},
      error(error) {
        errors.push(String(error));
      },
    },
    runNotification: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('temporary Watchlist failure');
      }
      return { sent: false };
    },
    setIntervalFn(callback) {
      scheduledCallback = callback;
      return {};
    },
    clearIntervalFn() {},
  });

  daemon.start();
  const failed = await daemon.waitForIdle();
  assert.ok(failed.error);
  assert.ok(errors[0].includes('temporary Watchlist failure'));
  assert.strictEqual(daemon.isRunning(), true);

  scheduledCallback();
  await daemon.waitForIdle();
  assert.strictEqual(calls, 2);
  assert.strictEqual(daemon.isRunning(), true);
  await daemon.stop();
});

test('overlapping intervals do not start duplicate runs', async () => {
  let scheduledCallback = null;
  let calls = 0;
  const pending = deferred();
  const daemon = Daemon.createDaemon({
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

  daemon.start();
  const overlap = await daemon.execute('manual');
  scheduledCallback();

  assert.strictEqual(overlap.skipped, true);
  assert.strictEqual(overlap.reason, 'RUN_IN_PROGRESS');
  assert.strictEqual(calls, 1);

  pending.resolve({ sent: false });
  await daemon.waitForIdle();
  await daemon.stop();
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
