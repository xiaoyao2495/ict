'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const GateStateStore = require(
  '../state/ictProductionGateStateStore'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function gateState(overrides) {
  return {
    state: 'WATCH_ZONE',
    direction: 'BULLISH',
    activeOpportunity: {
      id: 'BULLISH|EQUAL_LOW|62782',
      direction: 'BULLISH',
      liquidityType: 'EQUAL_LOW',
      price: 62782,
      enteredAt: 1000,
      enteredAvailableIndex: 42,
    },
    progress: {
      sweepCompleted: false,
      mssCompleted: false,
      displacementCompleted: false,
      strictConfirmationCompleted: false,
    },
    blockers: ['WAITING_LTF_CONFIRMATION'],
    reasonCode: 'OPPORTUNITY_ACTIVE',
    transition: {
      changed: true,
      from: 'WAITING_OPPORTUNITY',
      to: 'WATCH_ZONE',
      reason: 'OPPORTUNITY_ACTIVE',
      occurredAt: 1000,
    },
    sourceState: {
      h4Bias: 'BULLISH',
    },
    informationalOnly: true,
    ...(overrides || {}),
  };
}

test('file store saves and loads the complete Gate state', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-gate-state-')
  );
  const filePath = path.join(directory, 'gate-state.json');
  const input = gateState();
  const expected = GateStateStore.normalizeGateState(input);

  try {
    const writer = GateStateStore.createFileStore(filePath);
    await writer.save('BTCUSDT', input);

    input.activeOpportunity.enteredAt = 9999;
    input.progress.sweepCompleted = true;

    const reader = GateStateStore.createFileStore(filePath);
    assert.deepStrictEqual(
      await reader.load('BTCUSDT'),
      expected
    );
    assert.strictEqual(
      expected.activeOpportunity.enteredAvailableIndex,
      42
    );
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(
        expected,
        'sourceState'
      ),
      false
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('load returns null when no state exists for a symbol', async () => {
  const store = GateStateStore.createMemoryStore();

  assert.strictEqual(await store.load('BTCUSDT'), null);
});

test('multiple symbols remain isolated', async () => {
  const store = GateStateStore.createMemoryStore();
  const btc = gateState();
  const eth = gateState({
    state: 'CONFIRMING',
    direction: 'BEARISH',
    activeOpportunity: {
      id: 'BEARISH|EQUAL_HIGH|4200',
      direction: 'BEARISH',
      liquidityType: 'EQUAL_HIGH',
      price: 4200,
      enteredAt: 2000,
      enteredAvailableIndex: 84,
    },
    progress: {
      sweepCompleted: true,
      mssCompleted: false,
      displacementCompleted: false,
      strictConfirmationCompleted: false,
    },
    blockers: ['WAITING_STRICT_CONFIRMATION'],
    reasonCode: 'SWEEP_COMPLETED',
  });

  await Promise.all([
    store.save('BTCUSDT', btc),
    store.save('ETHUSDT', eth),
  ]);

  assert.deepStrictEqual(
    await store.load('BTCUSDT'),
    GateStateStore.normalizeGateState(btc)
  );
  assert.deepStrictEqual(
    await store.load('ETHUSDT'),
    GateStateStore.normalizeGateState(eth)
  );
  assert.notDeepStrictEqual(
    await store.load('BTCUSDT'),
    await store.load('ETHUSDT')
  );
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
