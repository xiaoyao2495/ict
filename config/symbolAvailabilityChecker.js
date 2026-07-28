'use strict';

const Binance = require('../api/binance');

function validateSymbols(symbols) {
  if (!Array.isArray(symbols)) {
    throw new Error(
      'Symbol availability input must be an array.'
    );
  }
  return symbols.slice();
}

function getTradableUsdtSymbols(exchangeInfo) {
  if (
    !exchangeInfo ||
    !Array.isArray(exchangeInfo.symbols)
  ) {
    throw new Error(
      'Binance exchangeInfo response has no symbols array.'
    );
  }

  return new Set(
    exchangeInfo.symbols
      .filter((item) => (
        item &&
        item.status === 'TRADING' &&
        item.quoteAsset === 'USDT' &&
        typeof item.symbol === 'string'
      ))
      .map((item) => item.symbol)
  );
}

async function checkSymbols(symbols, options) {
  options = options || {};
  const input = validateSymbols(symbols);
  const binanceApi = options.binanceApi || Binance;

  if (
    !binanceApi ||
    typeof binanceApi.getExchangeInfo !== 'function'
  ) {
    return {
      validSymbols: input,
      invalidSymbols: [],
      checkFailed: true,
      error: new Error(
        'Binance exchangeInfo API is unavailable.'
      ),
    };
  }

  try {
    const exchangeInfo =
      await binanceApi.getExchangeInfo();
    const tradable = getTradableUsdtSymbols(exchangeInfo);
    return {
      validSymbols: input.filter(
        (symbol) => tradable.has(symbol)
      ),
      invalidSymbols: input.filter(
        (symbol) => !tradable.has(symbol)
      ),
      checkFailed: false,
      error: null,
    };
  } catch (error) {
    return {
      validSymbols: input,
      invalidSymbols: [],
      checkFailed: true,
      error,
    };
  }
}

module.exports = {
  checkSymbols,
  getTradableUsdtSymbols,
  validateSymbols,
};
