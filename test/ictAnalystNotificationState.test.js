'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const NotificationState = require(
  '../notifications/ictAnalystNotificationState'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function report(options) {
  options = options || {};
  const mss = options.mss === undefined
    ? null
    : options.mss;
  return {
    current: {
      fourHourAnalysis: {
        bias: options.bias || 'BULLISH',
      },
      oneHourAnalysis: {
        relationToH4: options.relation || 'ALIGNED',
      },
      fiveMinuteObservation: {
        latestConfirmed: { mss },
      },
    },
  };
}

function mss(index, direction) {
  return {
    direction: direction || 'BULLISH',
    availableIndex: index,
    time: 1000 + index,
  };
}

test('extracts only the three notification state fields', () => {
  assert.deepStrictEqual(
    NotificationState.extractState(report({
      bias: 'BEARISH',
      relation: 'RETRACEMENT',
      mss: mss(12, 'BEARISH'),
    })),
    {
      h4Bias: 'BEARISH',
      h1Relation: 'RETRACEMENT',
      latestMss: {
        direction: 'BEARISH',
        availableIndex: 12,
        time: 1012,
      },
    }
  );
});

test('first state notifies and identical state is suppressed', () => {
  const currentReport = report({ mss: mss(10) });
  const initial = NotificationState.evaluate(
    null,
    currentReport
  );
  const duplicate = NotificationState.evaluate(
    initial.currentState,
    currentReport
  );

  assert.strictEqual(initial.shouldNotify, true);
  assert.deepStrictEqual(initial.reasons, ['INITIAL_STATE']);
  assert.strictEqual(duplicate.shouldNotify, false);
  assert.deepStrictEqual(duplicate.reasons, []);
});

test('4H Bias and 1H relation changes notify', () => {
  const previous = NotificationState.extractState(report());
  const biasChange = NotificationState.evaluate(
    previous,
    report({ bias: 'BEARISH' })
  );
  const relationChange = NotificationState.evaluate(
    previous,
    report({ relation: 'RETRACEMENT' })
  );

  assert.deepStrictEqual(
    biasChange.reasons,
    ['H4_BIAS_CHANGED']
  );
  assert.deepStrictEqual(
    relationChange.reasons,
    ['H1_RELATION_CHANGED']
  );
});

test('new 5m MSS uses event identity instead of direction', () => {
  const previous = NotificationState.extractState(
    report({ mss: mss(10) })
  );
  const same = NotificationState.evaluate(
    previous,
    report({ mss: mss(10) })
  );
  const newerSameDirection = NotificationState.evaluate(
    previous,
    report({ mss: mss(20) })
  );
  const missing = NotificationState.evaluate(
    previous,
    report({ mss: null })
  );

  assert.strictEqual(same.shouldNotify, false);
  assert.deepStrictEqual(
    newerSameDirection.reasons,
    ['NEW_5M_MSS']
  );
  assert.strictEqual(missing.shouldNotify, false);
});

test('memory store preserves the last successful state', async () => {
  const store = NotificationState.createMemoryStore();
  const state = NotificationState.extractState(
    report({ mss: mss(7) })
  );

  assert.strictEqual(await store.load(), null);
  await store.save(state);
  assert.deepStrictEqual(await store.load(), state);
});

test('file store persists state across process-style instances', async () => {
  const filePath = path.join(
    os.tmpdir(),
    'ict-analyst-notification-state-' +
      process.pid + '-' + Date.now() + '.json'
  );
  const state = NotificationState.extractState(
    report({ mss: mss(9) })
  );

  try {
    const writer = NotificationState.createFileStore(filePath);
    assert.strictEqual(await writer.load(), null);
    await writer.save(state);

    const reader = NotificationState.createFileStore(filePath);
    assert.deepStrictEqual(await reader.load(), state);
  } finally {
    await fs.unlink(filePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
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
