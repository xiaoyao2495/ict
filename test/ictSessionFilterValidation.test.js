'use strict';

const assert = require('assert');
const Validation = require(
  '../backtest/ictSessionFilterValidation'
);

let testsPassed = 0;

function test(name, callback) {
  try {
    callback();
    testsPassed += 1;
    console.log('PASS:', name);
  } catch (error) {
    console.error('FAIL:', name);
    throw error;
  }
}

function at(hour, minute) {
  return Date.UTC(2024, 5, 1, hour, minute);
}

function outcome(success, hit, mfe, mae) {
  return {
    directionSuccess: success,
    primaryDrawHit: hit,
    mfe,
    mae,
  };
}

function event(hour, minute, year, bullish) {
  return {
    time: Date.UTC(year || 2024, 5, 1, hour, minute),
    year: year || 2024,
    bias: bullish === false ? 'BEARISH' : 'BULLISH',
    outcomes: {
      '24h': outcome(true, false, 2, 1),
      '48h': outcome(false, true, 3, 2),
      '72h': outcome(true, true, 4, 3),
    },
  };
}

test('London Killzone uses fixed UTC half-open boundaries', () => {
  assert.strictEqual(
    Validation.inSession(at(6, 59), 'LONDON'),
    false
  );
  assert.strictEqual(
    Validation.inSession(at(7, 0), 'LONDON'),
    true
  );
  assert.strictEqual(
    Validation.inSession(at(9, 59), 'LONDON'),
    true
  );
  assert.strictEqual(
    Validation.inSession(at(10, 0), 'LONDON'),
    false
  );
});

test('New York Killzone uses fixed UTC half-open boundaries', () => {
  assert.strictEqual(
    Validation.inSession(at(11, 59), 'NEW_YORK'),
    false
  );
  assert.strictEqual(
    Validation.inSession(at(12, 0), 'NEW_YORK'),
    true
  );
  assert.strictEqual(
    Validation.inSession(at(14, 59), 'NEW_YORK'),
    true
  );
  assert.strictEqual(
    Validation.inSession(at(15, 0), 'NEW_YORK'),
    false
  );
});

test('Combined session is the unique London and New York union', () => {
  const events = [
    event(7, 30),
    event(12, 30),
    event(18, 0),
  ];
  const combined = Validation.filterSession(
    events,
    'LONDON_NEW_YORK'
  );

  assert.strictEqual(combined.length, 2);
  assert.strictEqual(new Set(combined).size, 2);
});

test('All-day group preserves every upstream event', () => {
  const events = [
    event(0, 0),
    event(8, 0),
    event(13, 0),
    event(23, 59),
  ];
  assert.deepStrictEqual(
    Validation.filterSession(events, 'ALL_DAY'),
    events
  );
});

test('Session summary reuses attached delivery outcomes', () => {
  const events = [
    event(7, 30, 2023, true),
    event(8, 30, 2024, false),
    event(13, 0, 2024, true),
  ];
  const summary = Validation.summarizeSession(
    events,
    'LONDON',
    [2023, 2024],
    [24, 48, 72]
  );

  assert.strictEqual(summary.events, 2);
  assert.strictEqual(summary.yearly['2023'].events, 1);
  assert.strictEqual(summary.yearly['2024'].events, 1);
  assert.strictEqual(
    summary.horizons['24h'].directionSuccessRate,
    1
  );
  assert.strictEqual(
    summary.horizons['48h'].primaryDrawHitRate,
    1
  );
});

console.log('\n' + testsPassed + ' tests passed.');
