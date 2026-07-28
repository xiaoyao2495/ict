'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WATCHLIST_PATH = path.resolve(
  __dirname,
  'watchlist.json'
);
const SYMBOL_PATTERN = /^[A-Z0-9]{5,30}$/;

function normalizeSymbol(value, index) {
  if (typeof value !== 'string') {
    throw new Error(
      'Watchlist symbol at index ' + index +
      ' must be a string.'
    );
  }
  const symbol = value.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new Error(
      'Watchlist symbol at index ' + index +
      ' is invalid: ' + value
    );
  }
  return symbol;
}

function parseWatchlist(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Array.isArray(value.symbols)
  ) {
    throw new Error(
      'Watchlist config must contain a symbols array.'
    );
  }

  const seen = new Set();
  const symbols = [];
  value.symbols.forEach((item, index) => {
    const symbol = normalizeSymbol(item, index);
    if (seen.has(symbol)) return;
    seen.add(symbol);
    symbols.push(symbol);
  });

  if (symbols.length === 0) {
    throw new Error(
      'Watchlist config must contain at least one symbol.'
    );
  }

  return Object.freeze({
    symbols: Object.freeze(symbols),
  });
}

function loadWatchlist(filePath) {
  const resolvedPath = path.resolve(
    filePath || DEFAULT_WATCHLIST_PATH
  );
  let parsed;
  try {
    parsed = JSON.parse(
      fs.readFileSync(resolvedPath, 'utf8')
    );
  } catch (error) {
    throw new Error(
      'Unable to load watchlist from ' +
      resolvedPath + ': ' + error.message
    );
  }
  return parseWatchlist(parsed);
}

module.exports = {
  DEFAULT_WATCHLIST_PATH,
  SYMBOL_PATTERN,
  loadWatchlist,
  normalizeSymbol,
  parseWatchlist,
};
