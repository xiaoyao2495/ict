'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Tracker = require(
  '../history/ictOpportunityOutcomeTracker'
);
const Runner = require(
  '../scripts/runOpportunityOutcomeTracker'
);

const FIVE_MINUTES = Tracker.FIVE_MINUTES;
const START = Date.UTC(2026, 6, 30, 0);
const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function bar(index, close, high, low) {
  return {
    openTime: START + index * FIVE_MINUTES,
    closeTime: START + (index + 1) *
      FIVE_MINUTES - 1,
    open: close,
    high,
    low,
    close,
  };
}

function confirmedEntry(symbol, direction, liquidityPrice) {
  return {
    symbol,
    h4Bias: direction,
    direction,
    liquidityType:
      direction === 'BULLISH' ? 'PDL' : 'PDH',
    liquidityPrice,
    status: 'CONFIRMED',
    changedAt: new Date(
      START + FIVE_MINUTES - 1
    ).toISOString(),
  };
}

function history(entriesBySymbol) {
  const symbols = {};
  for (const [symbol, transitions] of Object.entries(
    entriesBySymbol
  )) {
    symbols[symbol] = {
      current: transitions[transitions.length - 1],
      transitions,
    };
  }
  return { version: 1, symbols };
}

test('extracts CONFIRMED events only', () => {
  const confirmed = confirmedEntry(
    'BTCUSDT',
    'BULLISH',
    99
  );
  const input = history({
    BTCUSDT: [
      { ...confirmed, status: 'WATCH_ZONE' },
      confirmed,
    ],
  });
  const events = Tracker.extractConfirmedEvents(input);

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].symbol, 'BTCUSDT');
  assert.strictEqual(events[0].direction, 'BULLISH');
});

test('bullish outcome records nearby price and 1R 2R 3R times', () => {
  const event = Tracker.extractConfirmedEvents(history({
    BTCUSDT: [
      confirmedEntry('BTCUSDT', 'BULLISH', 99),
    ],
  }))[0];
  const klines = [
    bar(0, 100, 100.2, 99.5),
    bar(1, 100.8, 101.1, 100),
    bar(2, 101.8, 102.1, 100.7),
    bar(3, 102.8, 103.1, 101.7),
  ];
  const outcome = Tracker.evaluate(event, klines);

  assert.strictEqual(outcome.entryNearbyPrice, 100);
  assert.strictEqual(outcome.riskUnit, 1);
  assert.strictEqual(
    outcome.oneRAt,
    new Date(klines[1].closeTime).toISOString()
  );
  assert.strictEqual(
    outcome.twoRAt,
    new Date(klines[2].closeTime).toISOString()
  );
  assert.strictEqual(
    outcome.threeRAt,
    new Date(klines[3].closeTime).toISOString()
  );
  assert.strictEqual(outcome.failed, false);
  assert.strictEqual(outcome.trackingStatus, 'COMPLETED');
});

test('bearish outcome mirrors the R path', () => {
  const event = Tracker.extractConfirmedEvents(history({
    ETHUSDT: [
      confirmedEntry('ETHUSDT', 'BEARISH', 101),
    ],
  }))[0];
  const klines = [
    bar(0, 100, 100.5, 99.8),
    bar(1, 99.5, 100, 98.9),
    bar(2, 98.5, 99, 97.9),
    bar(3, 97.5, 98, 96.9),
  ];
  const outcome = Tracker.evaluate(event, klines);

  assert.strictEqual(outcome.entryNearbyPrice, 100);
  assert.strictEqual(outcome.riskUnit, 1);
  assert.ok(outcome.oneRAt);
  assert.ok(outcome.twoRAt);
  assert.ok(outcome.threeRAt);
  assert.strictEqual(outcome.failed, false);
});

test('failure wins conservatively when target and failure share a bar', () => {
  const event = Tracker.extractConfirmedEvents(history({
    BTCUSDT: [
      confirmedEntry('BTCUSDT', 'BULLISH', 99),
    ],
  }))[0];
  const outcome = Tracker.evaluate(event, [
    bar(0, 100, 100.2, 99.5),
    bar(1, 100, 101.2, 98.9),
  ]);

  assert.strictEqual(outcome.failed, true);
  assert.ok(outcome.failedAt);
  assert.strictEqual(outcome.oneRAt, null);
  assert.strictEqual(outcome.trackingStatus, 'FAILED');
});

test('tracking is idempotent and persists independent JSON', async () => {
  const confirmed = confirmedEntry(
    'BTCUSDT',
    'BULLISH',
    99
  );
  const input = history({ BTCUSDT: [confirmed] });
  const filePath = path.join(
    os.tmpdir(),
    'ict-opportunity-outcome-' +
      process.pid + '-' + Date.now() + '.json'
  );
  const store = Tracker.createFileStore(filePath);
  const klinesBySymbol = {
    BTCUSDT: [
      bar(0, 100, 100.2, 99.5),
      bar(1, 100.8, 101.1, 100),
    ],
  };

  try {
    const first = await Tracker.track({
      history: input,
      klinesBySymbol,
      store,
    });
    const second = await Tracker.track({
      history: input,
      klinesBySymbol,
      store,
    });
    const saved = JSON.parse(
      await fs.readFile(filePath, 'utf8')
    );

    assert.strictEqual(first.changed, true);
    assert.strictEqual(second.changed, false);
    assert.strictEqual(saved.outcomes.length, 1);
    assert.ok(saved.outcomes[0].oneRAt);
  } finally {
    await fs.unlink(filePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
});

test('standalone runner reads history and requests only 5m data', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-outcome-runner-')
  );
  const historyPath = path.join(directory, 'history.json');
  const outputPath = path.join(directory, 'outcomes.json');
  const calls = [];
  const input = history({
    BTCUSDT: [
      confirmedEntry('BTCUSDT', 'BULLISH', 99),
    ],
  });

  try {
    await fs.writeFile(
      historyPath,
      JSON.stringify(input),
      'utf8'
    );
    const result = await Runner.run({
      historyPath,
      outcomeFilePath: outputPath,
      marketData: {
        async getKlines(symbol, interval, limit) {
          calls.push({ symbol, interval, limit });
          return [
            bar(0, 100, 100.2, 99.5),
            bar(1, 100.8, 101.1, 100),
          ];
        },
      },
    });

    assert.deepStrictEqual(calls, [{
      symbol: 'BTCUSDT',
      interval: '5m',
      limit: Runner.DEFAULT_KLINE_LIMIT,
    }]);
    assert.strictEqual(result.state.outcomes.length, 1);
    assert.strictEqual(
      JSON.parse(
        await fs.readFile(outputPath, 'utf8')
      ).outcomes.length,
      1
    );
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true,
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
