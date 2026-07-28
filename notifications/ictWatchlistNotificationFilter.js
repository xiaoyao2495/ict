'use strict';

const path = require('path');
const AnalystNotificationState = require(
  './ictAnalystNotificationState'
);

const DEFAULT_STATE_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'watchlist-notification-state.json'
);

const CHANGE_REASONS = Object.freeze({
  INITIAL_STATE: 'INITIAL_STATE',
  H4_BIAS_CHANGED: 'H4_BIAS_CHANGED',
  H1_DELIVERY_CHANGED: 'H1_DELIVERY_CHANGED',
  H1_RELATION_CHANGED: 'H1_RELATION_CHANGED',
  NEW_5M_MSS: 'NEW_5M_MSS',
});

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function normalizeSweep(sweep) {
  if (!sweep || typeof sweep !== 'object') return null;
  return {
    id: sweep.id || null,
    type: sweep.type || 'UNKNOWN',
    side: sweep.side || 'UNKNOWN',
    availableIndex: Number.isInteger(sweep.availableIndex)
      ? sweep.availableIndex
      : null,
    time: Number.isFinite(sweep.time) ? sweep.time : null,
  };
}

function normalizeMss(mss) {
  if (!mss || typeof mss !== 'object') return null;
  const level = mss.brokenStructureLevel;
  return {
    id: mss.id || null,
    direction: mss.direction || 'UNKNOWN',
    index: Number.isInteger(mss.index)
      ? mss.index
      : null,
    availableIndex: Number.isInteger(mss.availableIndex)
      ? mss.availableIndex
      : null,
    time: Number.isFinite(mss.time) ? mss.time : null,
    brokenStructureLevel: level && typeof level === 'object'
      ? {
        id: level.id || null,
        type: level.type || null,
        index: Number.isInteger(level.index)
          ? level.index
          : null,
        price: Number.isFinite(level.price)
          ? level.price
          : null,
      }
      : null,
  };
}

function structureLevelIdentity(level) {
  if (!level) return null;
  if (level.id) return 'ID:' + level.id;
  if (Number.isInteger(level.index)) {
    return [
      'INDEX',
      level.type,
      level.index,
      level.price,
    ].join('|');
  }
  return null;
}

function stableMssIdentity(mss) {
  if (!mss) return null;
  if (mss.id) return 'ID:' + mss.id;
  if (Number.isInteger(mss.index)) {
    return 'INDEX:' + mss.index;
  }
  return structureLevelIdentity(mss.brokenStructureLevel);
}

function isNewMss(previousMss, currentMss) {
  if (!currentMss) return false;
  if (!previousMss) return true;
  if (previousMss.direction !== currentMss.direction) {
    return true;
  }

  const previousIdentity =
    stableMssIdentity(previousMss);
  const currentIdentity =
    stableMssIdentity(currentMss);
  return Boolean(
    previousIdentity &&
    currentIdentity &&
    previousIdentity !== currentIdentity
  );
}

function extractSymbolState(input) {
  const report = input && input.report
    ? input.report
    : input;
  const current = report && report.current
    ? report.current
    : report;
  const symbol = input && input.symbol
    ? input.symbol
    : report && report.symbol;

  if (
    typeof symbol !== 'string' ||
    !current ||
    !current.fourHourAnalysis ||
    !current.oneHourAnalysis ||
    !current.fiveMinuteObservation
  ) {
    throw new Error(
      'A symbol and current ICT Analyst Report are required.'
    );
  }

  const latest = current.fiveMinuteObservation
    .latestConfirmed || {};
  return {
    symbol,
    h4Bias:
      current.fourHourAnalysis.bias || 'UNAVAILABLE',
    h1Relation:
      current.oneHourAnalysis.relationToH4 || 'UNCLEAR',
    h1DeliveryDirection:
      current.oneHourAnalysis.deliveryDirection ||
      'UNAVAILABLE',
    latestMss: normalizeMss(latest.mss),
    latestSweep: normalizeSweep(latest.liquiditySweep),
  };
}

function compareSymbolStates(previousState, currentState) {
  if (!previousState) {
    return {
      shouldNotify: true,
      reasons: [CHANGE_REASONS.INITIAL_STATE],
    };
  }

  const reasons = [];
  if (previousState.h4Bias !== currentState.h4Bias) {
    reasons.push(CHANGE_REASONS.H4_BIAS_CHANGED);
  }
  if (
    previousState.h1DeliveryDirection !==
    currentState.h1DeliveryDirection
  ) {
    reasons.push(CHANGE_REASONS.H1_DELIVERY_CHANGED);
  }
  if (
    previousState.h1Relation !== currentState.h1Relation
  ) {
    reasons.push(CHANGE_REASONS.H1_RELATION_CHANGED);
  }

  if (isNewMss(
    previousState.latestMss,
    currentState.latestMss
  )) {
    reasons.push(CHANGE_REASONS.NEW_5M_MSS);
  }

  return {
    shouldNotify: reasons.length > 0,
    reasons,
  };
}

function normalizePersistedState(value) {
  const symbols = value &&
    value.symbols &&
    typeof value.symbols === 'object' &&
    !Array.isArray(value.symbols)
    ? clone(value.symbols)
    : {};
  return {
    version: 1,
    symbols,
  };
}

function evaluate(results, persistedState) {
  if (!Array.isArray(results)) {
    throw new Error(
      'Watchlist Analyst results must be an array.'
    );
  }

  const previous = normalizePersistedState(persistedState);
  const nextState = normalizePersistedState(previous);
  const changes = [];

  for (const result of results) {
    if (
      !result ||
      result.status === 'FAILED'
    ) {
      continue;
    }
    const currentState = extractSymbolState(result);
    const previousState =
      previous.symbols[currentState.symbol] || null;
    const comparison = compareSymbolStates(
      previousState,
      currentState
    );
    if (!comparison.shouldNotify) continue;

    changes.push({
      symbol: currentState.symbol,
      reasons: comparison.reasons,
      previousState,
      currentState,
      result,
    });
    nextState.symbols[currentState.symbol] = currentState;
  }

  return {
    shouldNotify: changes.length > 0,
    changes,
    previousState: previous,
    nextState,
  };
}

function webhookSucceeded(response) {
  if (
    response &&
    response.data &&
    Object.prototype.hasOwnProperty.call(
      response.data,
      'errcode'
    )
  ) {
    return response.data.errcode === 0;
  }
  return true;
}

async function processNotifications(options) {
  options = options || {};
  const store = options.store ||
    createFileStore(options.stateFilePath);
  const previousState = await store.load();
  const decision = evaluate(
    options.results,
    previousState
  );

  if (!decision.shouldNotify) {
    return {
      ...decision,
      sent: false,
      response: null,
    };
  }
  if (typeof options.send !== 'function') {
    throw new Error(
      'A notification send callback is required for changes.'
    );
  }

  const response = await options.send(
    decision.changes,
    decision
  );
  if (!webhookSucceeded(response)) {
    throw new Error(
      'DingTalk webhook did not accept the notification.'
    );
  }
  await store.save(decision.nextState);

  return {
    ...decision,
    sent: true,
    response,
  };
}

function createFileStore(filePath) {
  return AnalystNotificationState.createFileStore(
    filePath || DEFAULT_STATE_PATH
  );
}

function createMemoryStore(initialState) {
  return AnalystNotificationState.createMemoryStore(
    initialState
  );
}

module.exports = {
  CHANGE_REASONS,
  DEFAULT_STATE_PATH,
  compareSymbolStates,
  createFileStore,
  createMemoryStore,
  evaluate,
  extractSymbolState,
  isNewMss,
  normalizeMss,
  normalizePersistedState,
  normalizeSweep,
  processNotifications,
  stableMssIdentity,
  structureLevelIdentity,
  webhookSucceeded,
};
