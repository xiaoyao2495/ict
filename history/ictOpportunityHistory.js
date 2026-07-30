'use strict';

const fs = require('fs/promises');
const path = require('path');
const HumanSummary = require(
  '../formatters/ictAnalystHumanSummary'
);

const DEFAULT_HISTORY_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-opportunity-history.json'
);

const VALID_STATUSES = new Set([
  'WAITING',
  'WATCH_ZONE',
  'CONFIRMING',
  'CONFIRMED',
]);

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function emptyHistory() {
  return {
    version: 1,
    symbols: {},
  };
}

function normalizeTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(
      'A valid opportunity history time is required.'
    );
  }
  return date.toISOString();
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object') return null;
  const status = VALID_STATUSES.has(value.status)
    ? value.status
    : 'WAITING';
  return {
    symbol: value.symbol,
    h4Bias: value.h4Bias || 'UNAVAILABLE',
    direction: (
      value.direction === 'BULLISH' ||
      value.direction === 'BEARISH'
    )
      ? value.direction
      : null,
    liquidityType:
      typeof value.liquidityType === 'string'
        ? value.liquidityType
        : null,
    liquidityPrice: Number.isFinite(
      value.liquidityPrice
    )
      ? value.liquidityPrice
      : null,
    status,
    changedAt: normalizeTime(value.changedAt),
  };
}

function normalizeHistory(value) {
  const result = emptyHistory();
  const symbols = value &&
    value.symbols &&
    typeof value.symbols === 'object' &&
    !Array.isArray(value.symbols)
    ? value.symbols
    : {};

  for (const [symbol, record] of Object.entries(symbols)) {
    if (!record || typeof record !== 'object') continue;
    const transitions = Array.isArray(record.transitions)
      ? record.transitions
        .map(normalizeEntry)
        .filter(Boolean)
      : [];
    const current = normalizeEntry(record.current) ||
      transitions[transitions.length - 1] ||
      null;
    if (!current) continue;
    result.symbols[symbol] = {
      current,
      transitions,
    };
  }
  return result;
}

function reportCurrent(result) {
  const report = result && result.report
    ? result.report
    : result;
  return report && report.current
    ? report.current
    : report;
}

function resultSymbol(result) {
  const report = result && result.report
    ? result.report
    : result;
  return result && result.symbol ||
    report && report.symbol ||
    null;
}

function extractEntry(result, recordedAt) {
  const current = reportCurrent(result);
  const symbol = resultSymbol(result);
  if (
    typeof symbol !== 'string' ||
    !current ||
    !current.fourHourAnalysis ||
    !current.fiveMinuteObservation
  ) {
    throw new Error(
      'A symbol and current Watchlist report are required.'
    );
  }

  const opportunity = current.opportunity || {};
  const h4Bias =
    current.fourHourAnalysis.bias || 'UNAVAILABLE';
  const stage = HumanSummary.opportunityStage({
    h4: current.fourHourAnalysis,
    opportunity,
    fiveMinute: current.fiveMinuteObservation,
  });
  const direction = (
    opportunity.direction === 'BULLISH' ||
    opportunity.direction === 'BEARISH'
  )
    ? opportunity.direction
    : h4Bias === 'BULLISH' || h4Bias === 'BEARISH'
      ? h4Bias
      : null;

  return normalizeEntry({
    symbol,
    h4Bias,
    direction,
    liquidityType: opportunity.liquidityType,
    liquidityPrice: opportunity.price,
    status: stage.status,
    changedAt:
      current.asOf === undefined ||
      current.asOf === null
        ? recordedAt
        : current.asOf,
  });
}

function sameOpportunity(left, right) {
  if (!left || !right) return false;
  return (
    left.symbol === right.symbol &&
    left.h4Bias === right.h4Bias &&
    left.direction === right.direction &&
    left.liquidityType === right.liquidityType &&
    left.liquidityPrice === right.liquidityPrice &&
    left.status === right.status
  );
}

async function recordResults(options) {
  options = options || {};
  const results = Array.isArray(options.results)
    ? options.results
    : [];
  const store = options.store ||
    createFileStore(options.historyFilePath);
  const recordedAt = options.recordedAt === undefined
    ? Date.now()
    : options.recordedAt;
  const state = normalizeHistory(await store.load());
  const changes = [];

  for (const result of results) {
    if (!result || result.status === 'FAILED') continue;
    const entry = extractEntry(result, recordedAt);
    const previous = state.symbols[entry.symbol];
    if (
      previous &&
      sameOpportunity(previous.current, entry)
    ) {
      continue;
    }
    const transitions = previous
      ? previous.transitions.slice()
      : [];
    transitions.push(entry);
    state.symbols[entry.symbol] = {
      current: entry,
      transitions,
    };
    changes.push({
      symbol: entry.symbol,
      previous: previous ? previous.current : null,
      current: entry,
    });
  }

  if (changes.length > 0) {
    await store.save(state);
  }
  return {
    changed: changes.length > 0,
    changes,
    state,
  };
}

function createMemoryStore(initialState) {
  let value = initialState
    ? clone(initialState)
    : null;
  return {
    async load() {
      return clone(value);
    },
    async save(nextState) {
      value = clone(nextState);
    },
  };
}

function createFileStore(filePath) {
  const resolvedPath = path.resolve(
    filePath || DEFAULT_HISTORY_PATH
  );
  return {
    filePath: resolvedPath,
    async load() {
      try {
        const content = await fs.readFile(
          resolvedPath,
          'utf8'
        );
        return JSON.parse(content);
      } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(nextState) {
      await fs.mkdir(path.dirname(resolvedPath), {
        recursive: true,
      });
      await fs.writeFile(
        resolvedPath,
        JSON.stringify(nextState, null, 2) + '\n',
        'utf8'
      );
    },
  };
}

module.exports = {
  DEFAULT_HISTORY_PATH,
  VALID_STATUSES,
  createFileStore,
  createMemoryStore,
  emptyHistory,
  extractEntry,
  normalizeEntry,
  normalizeHistory,
  normalizeTime,
  recordResults,
  sameOpportunity,
};
