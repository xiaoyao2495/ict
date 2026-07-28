'use strict';

const assert = require('assert');
const Watchlist = require('../config/watchlistLoader');

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

test('default watchlist loads configured symbols', () => {
  const watchlist = Watchlist.loadWatchlist();

  assert.deepStrictEqual(watchlist.symbols, [
    'BTCUSDT',
    'SNDKUSDT',
    'MUUSDT',
    'XAUUSDT',
    'CLUSDT',
    'SPCXUSDT',
  ]);
  assert.strictEqual(Object.isFrozen(watchlist), true);
  assert.strictEqual(
    Object.isFrozen(watchlist.symbols),
    true
  );
});

test('symbols are normalized and deduplicated in order', () => {
  const watchlist = Watchlist.parseWatchlist({
    symbols: [
      ' btcusdt ',
      'ETHUSDT',
      'BTCUSDT',
      ' solusdt ',
    ],
  });

  assert.deepStrictEqual(
    watchlist.symbols,
    ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
  );
});

test('invalid watchlist structures are rejected', () => {
  assert.throws(
    () => Watchlist.parseWatchlist(null),
    /symbols array/
  );
  assert.throws(
    () => Watchlist.parseWatchlist({ symbols: [] }),
    /at least one symbol/
  );
  assert.throws(
    () => Watchlist.parseWatchlist({
      symbols: ['BTC-USDT'],
    }),
    /is invalid/
  );
  assert.throws(
    () => Watchlist.parseWatchlist({
      symbols: [123],
    }),
    /must be a string/
  );
});

test('parsing returns new data without mutating input', () => {
  const input = {
    symbols: [' btcusdt ', 'ETHUSDT'],
  };
  const before = JSON.parse(JSON.stringify(input));

  Watchlist.parseWatchlist(input);

  assert.deepStrictEqual(input, before);
});

console.log('\n' + testsPassed + ' tests passed.');
