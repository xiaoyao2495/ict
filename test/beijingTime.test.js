'use strict';

const assert = require('assert');
const BeijingTime = require('../formatters/beijingTime');

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

test('UTC ISO input is displayed as UTC+8', () => {
  assert.strictEqual(
    BeijingTime.formatBeijingTime(
      '2026-07-28T00:00:00.000Z'
    ),
    '2026-07-28 08:00:00'
  );
});

test('UTC timestamp and Date inputs use Asia Shanghai', () => {
  const timestamp = Date.UTC(2026, 6, 28, 16, 30, 45);
  assert.strictEqual(
    BeijingTime.formatBeijingTime(timestamp),
    '2026-07-29 00:30:45'
  );
  assert.strictEqual(
    BeijingTime.formatBeijingTime(new Date(timestamp)),
    '2026-07-29 00:30:45'
  );
  assert.strictEqual(BeijingTime.TIME_ZONE, 'Asia/Shanghai');
});

test('invalid display time returns unavailable', () => {
  assert.strictEqual(
    BeijingTime.formatBeijingTime('not-a-time'),
    '不可用'
  );
  assert.strictEqual(
    BeijingTime.formatBeijingTime(null),
    '不可用'
  );
});

console.log('\n' + testsPassed + ' tests passed.');
