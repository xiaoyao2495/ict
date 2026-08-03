'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Replay = require(
  '../scripts/runProductionReplayAuditV1'
);
const GateStateStore = require(
  '../state/ictProductionGateStateStore'
);

const tests = [];
let passed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function bar(openTime, closeTime, close) {
  return {
    openTime,
    closeTime,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1,
  };
}

function fixture() {
  return {
    h4Klines: [
      bar(0, 99, 100),
      bar(100, 199, 110),
    ],
    ltf5mKlines: [
      bar(0, 100, 101),
      bar(101, 150, 102),
      bar(151, 200, 103),
    ],
  };
}

function fakeAnalyst(inputs) {
  return {
    analyze(input) {
      inputs.push({
        previousGateState: input.previousGateState,
        h4CloseTimes: input.h4Klines.map(
          (item) => item.closeTime
        ),
        ltfCloseTimes: input.ltf5mKlines.map(
          (item) => item.closeTime
        ),
      });
      const previous = input.previousGateState;
      const enteredAt = previous && previous.activeOpportunity
        ? previous.activeOpportunity.enteredAt
        : input.ltf5mKlines[
          input.ltf5mKlines.length - 1
        ].closeTime;
      const from = previous ? previous.state : null;
      return {
        current: {
          fourHourAnalysis: {
            bias: input.h4Klines.length === 1
              ? 'BULLISH'
              : 'BEARISH',
          },
          opportunity: {
            status: 'WATCH_ZONE',
            direction: 'BULLISH',
            liquidityType: 'EQUAL_LOW',
            price: 99,
          },
          decisionGate: {
            state: 'WATCH_ZONE',
            direction: 'BULLISH',
            activeOpportunity: {
              id: 'BULLISH|EQUAL_LOW|99',
              direction: 'BULLISH',
              liquidityType: 'EQUAL_LOW',
              price: 99,
              enteredAt,
              enteredAvailableIndex: 0,
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
              changed: !previous,
              from,
              to: 'WATCH_ZONE',
            },
          },
        },
      };
    },
  };
}

test('replay uses only closed prefixes and carries Gate state', async () => {
  const data = fixture();
  const before = JSON.stringify(data);
  const inputs = [];
  const audit = await Replay.replay({
    symbol: 'BTCUSDT',
    ...data,
    analystReport: fakeAnalyst(inputs),
    gateStateStore: GateStateStore.createMemoryStore(),
  });

  assert.strictEqual(audit.frames.length, 3);
  assert.strictEqual(inputs[0].previousGateState, null);
  assert.deepStrictEqual(
    inputs.map((item) => item.h4CloseTimes),
    [[99], [99], [99, 199]]
  );
  assert.deepStrictEqual(
    inputs.map((item) => item.ltfCloseTimes),
    [[100], [100, 150], [100, 150, 200]]
  );
  assert.strictEqual(
    inputs[1].previousGateState.activeOpportunity.enteredAt,
    100
  );
  assert.strictEqual(
    audit.frames[2].activeOpportunity.enteredAt,
    100
  );
  assert.strictEqual(audit.frames[0].htfBias, 'BULLISH');
  assert.strictEqual(audit.frames[2].htfBias, 'BEARISH');
  assert.strictEqual(JSON.stringify(data), before);
});

test('replay range filters output without removing preheat prefixes', async () => {
  const data = fixture();
  const inputs = [];
  const audit = await Replay.replay({
    symbol: 'BTCUSDT',
    ...data,
    startTime: 150,
    endTime: 150,
    analystReport: fakeAnalyst(inputs),
  });

  assert.strictEqual(audit.frames.length, 1);
  assert.deepStrictEqual(inputs[0].ltfCloseTimes, [100, 150]);
  assert.deepStrictEqual(inputs[0].h4CloseTimes, [99]);
});

test('failed frames do not overwrite the previous Gate state', async () => {
  const data = fixture();
  const store = GateStateStore.createMemoryStore();
  let calls = 0;
  const analyst = fakeAnalyst([]);
  const audit = await Replay.replay({
    symbol: 'BTCUSDT',
    ...data,
    gateStateStore: store,
    analystReport: {
      analyze(input) {
        calls += 1;
        if (calls === 2) throw new Error('synthetic failure');
        return analyst.analyze(input);
      },
    },
  });

  assert.deepStrictEqual(
    audit.frames.map((frame) => frame.status),
    ['SUCCESS', 'FAILED', 'SUCCESS']
  );
  assert.strictEqual(
    audit.frames[2].activeOpportunity.enteredAt,
    100
  );
});

test('runner writes the complete timeline report', async () => {
  const data = fixture();
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-production-replay-')
  );
  const outputPath = path.join(directory, 'timeline.txt');
  try {
    const result = await Replay.run({
      symbol: 'BTCUSDT',
      ...data,
      outputPath,
      analystReport: fakeAnalyst([]),
    });
    const text = await fs.readFile(outputPath, 'utf8');
    for (const expected of [
      'ICT Production Replay Audit V1',
      '4H交易背景：BULLISH',
      'Opportunity：EQUAL_LOW | 99 | BULLISH',
      'Gate State：WATCH_ZONE',
      'Progress：Sweep □ | MSS □ | Displacement □',
      'Transition：NONE → WATCH_ZONE（CHANGED）',
      'Production State File Used：false',
    ]) {
      assert.ok(text.includes(expected), expected);
    }
    assert.strictEqual(result.outputPath, outputPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

(async () => {
  for (const item of tests) {
    try {
      await item.callback();
      passed += 1;
      console.log('PASS:', item.name);
    } catch (error) {
      console.error('FAIL:', item.name);
      throw error;
    }
  }
  console.log('\n' + passed + ' tests passed.');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
