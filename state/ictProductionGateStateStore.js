'use strict';

const fs = require('fs/promises');
const path = require('path');

const STATE_VERSION = 1;
const DEFAULT_STATE_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'watchlist-gate-state.json'
);

function isObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function normalizeSymbol(value) {
  const symbol = typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
  if (!/^[A-Z0-9]{5,30}$/.test(symbol)) {
    throw new Error('A valid Watchlist symbol is required.');
  }
  return symbol;
}

function normalizeGateState(value) {
  if (!isObject(value) || typeof value.state !== 'string') {
    throw new Error('A valid Decision Gate state is required.');
  }
  return {
    state: value.state,
    direction:
      value.direction === 'BULLISH' ||
      value.direction === 'BEARISH'
        ? value.direction
        : null,
    activeOpportunity: isObject(value.activeOpportunity)
      ? clone(value.activeOpportunity)
      : null,
    progress: isObject(value.progress)
      ? clone(value.progress)
      : {},
    blockers: Array.isArray(value.blockers)
      ? clone(value.blockers)
      : [],
    reasonCode: typeof value.reasonCode === 'string'
      ? value.reasonCode
      : null,
    transition: isObject(value.transition)
      ? clone(value.transition)
      : null,
  };
}

function emptyState() {
  return {
    version: STATE_VERSION,
    symbols: {},
  };
}

function normalizeFileState(value) {
  const result = emptyState();
  const symbols = isObject(value) && isObject(value.symbols)
    ? value.symbols
    : {};

  for (const [symbol, gateState] of Object.entries(symbols)) {
    try {
      result.symbols[normalizeSymbol(symbol)] =
        normalizeGateState(gateState);
    } catch (error) {
      // Ignore malformed persisted symbol entries without affecting
      // the remaining independent symbol states.
    }
  }
  return result;
}

function createMemoryStore(initialState) {
  let value = normalizeFileState(initialState);
  return {
    async load(symbol) {
      const normalizedSymbol = normalizeSymbol(symbol);
      return value.symbols[normalizedSymbol]
        ? clone(value.symbols[normalizedSymbol])
        : null;
    },
    async save(symbol, gateState) {
      const normalizedSymbol = normalizeSymbol(symbol);
      const normalizedState = normalizeGateState(gateState);
      value.symbols[normalizedSymbol] = normalizedState;
      return clone(normalizedState);
    },
  };
}

function createFileStore(filePath) {
  const resolvedPath = path.resolve(
    filePath || DEFAULT_STATE_PATH
  );
  let pendingWrite = Promise.resolve();

  async function readFileState() {
    try {
      const content = await fs.readFile(resolvedPath, 'utf8');
      return normalizeFileState(JSON.parse(content));
    } catch (error) {
      if (error && error.code === 'ENOENT') return emptyState();
      throw error;
    }
  }

  async function writeFileState(value) {
    await fs.mkdir(path.dirname(resolvedPath), {
      recursive: true,
    });
    await fs.writeFile(
      resolvedPath,
      JSON.stringify(value, null, 2) + '\n',
      'utf8'
    );
  }

  return {
    filePath: resolvedPath,
    async load(symbol) {
      const normalizedSymbol = normalizeSymbol(symbol);
      await pendingWrite.catch(() => {});
      const value = await readFileState();
      return value.symbols[normalizedSymbol]
        ? clone(value.symbols[normalizedSymbol])
        : null;
    },
    save(symbol, gateState) {
      const normalizedSymbol = normalizeSymbol(symbol);
      const normalizedState = normalizeGateState(gateState);
      const operation = pendingWrite
        .catch(() => {})
        .then(async () => {
          const value = await readFileState();
          value.symbols[normalizedSymbol] = normalizedState;
          await writeFileState(value);
          return clone(normalizedState);
        });
      pendingWrite = operation;
      return operation;
    },
  };
}

const defaultStore = createFileStore(DEFAULT_STATE_PATH);

function load(symbol) {
  return defaultStore.load(symbol);
}

function save(symbol, state) {
  return defaultStore.save(symbol, state);
}

module.exports = {
  DEFAULT_STATE_PATH,
  STATE_VERSION,
  createFileStore,
  createMemoryStore,
  emptyState,
  load,
  normalizeFileState,
  normalizeGateState,
  normalizeSymbol,
  save,
};
