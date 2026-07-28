'use strict';

const assert = require('assert');
const Checker = require(
  '../config/symbolAvailabilityChecker'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function exchangeInfoApi() {
  return {
    async getExchangeInfo() {
      return {
        symbols: [
          {
            symbol: 'BTCUSDT',
            quoteAsset: 'USDT',
            status: 'TRADING',
          },
          {
            symbol: 'ETHUSDT',
            quoteAsset: 'USDT',
            status: 'TRADING',
          },
          {
            symbol: 'HALTEDUSDT',
            quoteAsset: 'USDT',
            status: 'SETTLING',
          },
          {
            symbol: 'BTCUSD',
            quoteAsset: 'USD',
            status: 'TRADING',
          },
        ],
      };
    },
  };
}

test('existing tradable USDT symbols are valid', async () => {
  const result = await Checker.checkSymbols(
    ['BTCUSDT', 'ETHUSDT'],
    { binanceApi: exchangeInfoApi() }
  );

  assert.deepStrictEqual(
    result.validSymbols,
    ['BTCUSDT', 'ETHUSDT']
  );
  assert.deepStrictEqual(result.invalidSymbols, []);
  assert.strictEqual(result.checkFailed, false);
});

test('missing halted and non-USDT symbols are invalid', async () => {
  const result = await Checker.checkSymbols([
    'BTCUSDT',
    'NOTEXISTUSDT',
    'HALTEDUSDT',
    'BTCUSD',
  ], {
    binanceApi: exchangeInfoApi(),
  });

  assert.deepStrictEqual(result.validSymbols, ['BTCUSDT']);
  assert.deepStrictEqual(result.invalidSymbols, [
    'NOTEXISTUSDT',
    'HALTEDUSDT',
    'BTCUSD',
  ]);
});

test('availability check does not mutate input symbols', async () => {
  const symbols = ['BTCUSDT', 'NOTEXISTUSDT'];
  const before = symbols.slice();

  await Checker.checkSymbols(symbols, {
    binanceApi: exchangeInfoApi(),
  });

  assert.deepStrictEqual(symbols, before);
});

test('API errors safely preserve the original watchlist', async () => {
  const symbols = ['BTCUSDT', 'ETHUSDT'];
  const result = await Checker.checkSymbols(symbols, {
    binanceApi: {
      async getExchangeInfo() {
        throw new Error('temporary Binance outage');
      },
    },
  });

  assert.deepStrictEqual(result.validSymbols, symbols);
  assert.notStrictEqual(result.validSymbols, symbols);
  assert.deepStrictEqual(result.invalidSymbols, []);
  assert.strictEqual(result.checkFailed, true);
  assert.match(result.error.message, /temporary Binance outage/);
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
