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

test('new Daily Bias State save defaults biasSourceVersion', async () => {
  const store = GateStateStore.createMemoryStore();
  const input = {
    state: 'WATCH_ZONE',
    direction: 'BEARISH',
  };

  await store.save('BTCUSDT', input);

  const saved = await store.load('BTCUSDT');
  assert.strictEqual(
    saved.biasSourceVersion,
    'daily_bias_v1'
  );
  assert.strictEqual(saved.state, 'WATCH_ZONE');
  assert.strictEqual(saved.direction, 'BEARISH');
});

test('legacy State load fills htf_bias_v3 without rewriting disk', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-gate-state-legacy-')
  );
  const filePath = path.join(directory, 'gate-state.json');
  const legacyBody = JSON.stringify({
    version: 1,
    symbols: {
      BTCUSDT: {
        state: 'WATCH_ZONE',
        direction: 'BEARISH',
      },
    },
  }, null, 2) + '\n';

  try {
    await fs.writeFile(filePath, legacyBody, 'utf8');
    const store = GateStateStore.createFileStore(filePath);

    assert.deepStrictEqual(await store.load('BTCUSDT'), {
      state: 'WATCH_ZONE',
      direction: 'BEARISH',
      activeOpportunity: null,
      progress: {},
      blockers: [],
      reasonCode: null,
      transition: null,
      biasSourceVersion: 'htf_bias_v3',
    });
    assert.strictEqual(
      await fs.readFile(filePath, 'utf8'),
      legacyBody
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('explicit htf_bias_v3 version is preserved', async () => {
  const store = GateStateStore.createMemoryStore();
  const input = gateState({
    biasSourceVersion: 'htf_bias_v3',
  });

  await store.save('BTCUSDT', input);

  assert.strictEqual(
    (await store.load('BTCUSDT')).biasSourceVersion,
    'htf_bias_v3'
  );
});

test('biasSourceVersion does not alter stored state data', async () => {
  const store = GateStateStore.createMemoryStore();
  const legacy = gateState({
    direction: 'BEARISH',
    biasSourceVersion: 'htf_bias_v3',
  });
  const daily = gateState({
    direction: 'BEARISH',
    biasSourceVersion: 'daily_bias_v1',
  });

  await Promise.all([
    store.save('BTCUSDT', legacy),
    store.save('BNBUSDT', daily),
  ]);

  const legacyLoaded = await store.load('BTCUSDT');
  const dailyLoaded = await store.load('BNBUSDT');
  delete legacyLoaded.biasSourceVersion;
  delete dailyLoaded.biasSourceVersion;
  // 版本不同不影响任何状态字段（state / direction / progress ...）
  assert.deepStrictEqual(
    dailyLoaded,
    legacyLoaded
  );
  assert.strictEqual(
    (await store.load('BTCUSDT')).biasSourceVersion,
    'htf_bias_v3'
  );
  assert.strictEqual(
    (await store.load('BNBUSDT')).biasSourceVersion,
    'daily_bias_v1'
  );
});

test('symbol isolation keeps independent biasSourceVersion', async () => {
  const store = GateStateStore.createMemoryStore();
  const btc = {
    state: 'WATCH_ZONE',
    direction: 'BULLISH',
  };
  const bnb = {
    state: 'WATCH_ZONE',
    direction: 'BEARISH',
    biasSourceVersion: 'htf_bias_v3',
  };

  await Promise.all([
    store.save('BTCUSDT', btc),
    store.save('BNBUSDT', bnb),
  ]);

  assert.strictEqual(
    (await store.load('BTCUSDT')).biasSourceVersion,
    'daily_bias_v1'
  );
  assert.strictEqual(
    (await store.load('BNBUSDT')).biasSourceVersion,
    'htf_bias_v3'
  );
  // 互不影响：覆盖 BNB 不影响 BTC
  await store.save('BNBUSDT', { state: 'CONFIRMING' });
  assert.strictEqual(
    (await store.load('BTCUSDT')).biasSourceVersion,
    'daily_bias_v1'
  );
});

test('deep copy keeps external mutation out of the store', async () => {
  const store = GateStateStore.createMemoryStore();
  const state = {
    state: 'WATCH_ZONE',
    activeOpportunity: {
      direction: 'BEARISH',
    },
  };

  await store.save('BTCUSDT', state);
  state.activeOpportunity.direction = 'BULLISH';

  const saved = await store.load('BTCUSDT');
  assert.strictEqual(
    saved.activeOpportunity.direction,
    'BEARISH'
  );
});

test('empty file load returns null', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-gate-state-empty-')
  );
  const filePath = path.join(directory, 'gate-state.json');

  try {
    await fs.writeFile(filePath, '{}\n', 'utf8');
    const store = GateStateStore.createFileStore(filePath);

    assert.strictEqual(await store.load('BTCUSDT'), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
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
