'use strict';

const path = require('path');
const { isDeepStrictEqual } = require('util');
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

const DYNAMIC_STATE_FIELDS = Object.freeze([
  'reportTime',
  'analysisTime',
  'generatedAt',
  'time',
  'timestamp',
  'availableIndex',
]);

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function debugNotificationEnabled(options) {
  if (
    options &&
    typeof options.debugNotification === 'boolean'
  ) {
    return options.debugNotification;
  }
  return String(
    process.env.DEBUG_NOTIFICATION || ''
  ).toLowerCase() === 'true';
}

function debugLog(logger, value) {
  if (logger && typeof logger.log === 'function') {
    logger.log(value);
  }
}

function printableValue(value) {
  if (value === undefined) return 'undefined';
  if (
    value === null ||
    typeof value === 'object'
  ) {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function changedFieldNames(previousState, currentState) {
  const names = new Set([
    ...Object.keys(previousState || {}),
    ...Object.keys(currentState || {}),
  ]);
  names.delete('symbol');
  return Array.from(names).filter((name) => (
    !isDeepStrictEqual(
      previousState
        ? previousState[name]
        : undefined,
      currentState
        ? currentState[name]
        : undefined
    )
  ));
}

function collectDynamicFields(value, detected) {
  if (!value || typeof value !== 'object') return;
  for (const [name, child] of Object.entries(value)) {
    if (DYNAMIC_STATE_FIELDS.includes(name)) {
      detected.add(name);
    }
    collectDynamicFields(child, detected);
  }
}

function logStateLoad(
  logger,
  stateFilePath,
  loadSuccess,
  previousState
) {
  debugLog(logger, 'State File:');
  debugLog(logger, stateFilePath);
  debugLog(logger, '');
  debugLog(logger, 'Load Success:');
  debugLog(logger, String(loadSuccess));
  debugLog(logger, '');
  debugLog(logger, 'Previous State Exists:');
  debugLog(logger, String(Boolean(previousState)));
}

function logComparedStates(
  logger,
  previousSymbols,
  currentSymbols,
  symbolComparisons
) {
  debugLog(
    logger,
    '========== Previous Watchlist State =========='
  );
  debugLog(
    logger,
    JSON.stringify(previousSymbols, null, 2)
  );
  debugLog(
    logger,
    '========== Current Watchlist State =========='
  );
  debugLog(
    logger,
    JSON.stringify(currentSymbols, null, 2)
  );

  for (const comparison of symbolComparisons) {
    const changedFields = changedFieldNames(
      comparison.previousState,
      comparison.currentState
    );
    debugLog(
      logger,
      '================================'
    );
    debugLog(logger, '');
    debugLog(logger, 'Symbol:');
    debugLog(logger, comparison.currentState.symbol);
    debugLog(logger, '');
    debugLog(logger, 'Changed Fields:');
    debugLog(
      logger,
      changedFields.length
        ? changedFields.join('\n')
        : 'NONE'
    );

    for (const field of changedFields) {
      debugLog(logger, '');
      debugLog(logger, field);
      debugLog(logger, '');
      debugLog(logger, 'Previous:');
      debugLog(
        logger,
        printableValue(
          comparison.previousState
            ? comparison.previousState[field]
            : undefined
        )
      );
      debugLog(logger, '');
      debugLog(logger, 'Current:');
      debugLog(
        logger,
        printableValue(comparison.currentState[field])
      );
    }
    debugLog(logger, '');
    debugLog(
      logger,
      '================================'
    );
  }

  const detected = new Set();
  collectDynamicFields(previousSymbols, detected);
  collectDynamicFields(currentSymbols, detected);
  for (const field of DYNAMIC_STATE_FIELDS) {
    if (!detected.has(field)) continue;
    debugLog(logger, 'WARNING:');
    debugLog(logger, '');
    debugLog(logger, 'Dynamic field detected:');
    debugLog(logger, field);
  }
}

function logDecision(logger, decision) {
  const changedSymbols = decision.changes.map(
    (change) => change.symbol
  );
  debugLog(logger, '================================');
  debugLog(logger, '');
  debugLog(logger, 'Notification Decision');
  debugLog(logger, '');
  debugLog(logger, 'shouldNotify:');
  debugLog(logger, String(decision.shouldNotify));
  debugLog(logger, '');
  debugLog(logger, 'Reason:');
  debugLog(
    logger,
    changedSymbols.length
      ? changedSymbols.join(', ') + ' changed'
      : 'No state changed'
  );
  debugLog(logger, '');
  debugLog(logger, '================================');

  if (!decision.shouldNotify) return;
  debugLog(logger, '');
  debugLog(logger, 'Changed Symbols:');
  debugLog(
    logger,
    JSON.stringify(changedSymbols, null, 2)
  );
}

function normalizeMss(mss) {
  if (!mss || typeof mss !== 'object') return null;
  const level = mss.brokenStructureLevel;
  return {
    direction: mss.direction || 'UNKNOWN',
    brokenStructureLevel: level && typeof level === 'object'
      ? {
        type: level.type || null,
        price: Number.isFinite(level.price)
          ? level.price
          : null,
      }
      : null,
  };
}

function structureLevelIdentity(level) {
  if (!level) return null;
  if (!Number.isFinite(level.price)) return null;
  return [
    'STRUCTURE',
    level.type || 'UNKNOWN',
    level.price,
  ].join('|');
}

function stableMssIdentity(mss) {
  if (!mss) return null;
  const structureIdentity = structureLevelIdentity(
    mss.brokenStructureLevel
  );
  return structureIdentity
    ? [
      mss.direction || 'UNKNOWN',
      structureIdentity,
    ].join('|')
    : null;
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
  const sourceSymbols = value &&
    value.symbols &&
    typeof value.symbols === 'object' &&
    !Array.isArray(value.symbols)
    ? value.symbols
    : {};
  const symbols = {};

  for (const [symbol, state] of Object.entries(
    sourceSymbols
  )) {
    if (!state || typeof state !== 'object') continue;
    symbols[symbol] = {
      symbol: state.symbol || symbol,
      h4Bias: state.h4Bias || 'UNAVAILABLE',
      h1Relation: state.h1Relation || 'UNCLEAR',
      h1DeliveryDirection:
        state.h1DeliveryDirection || 'UNAVAILABLE',
      latestMss: normalizeMss(state.latestMss),
    };
  }

  return {
    version: 1,
    symbols,
  };
}

function evaluate(results, persistedState, debugComparison) {
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
    if (debugComparison) {
      debugComparison.previousSymbols[
        currentState.symbol
      ] = previousState;
      debugComparison.currentSymbols[
        currentState.symbol
      ] = currentState;
      debugComparison.symbolComparisons.push({
        symbol: currentState.symbol,
        previousState,
        currentState,
      });
    }
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

  const changedSymbols = changes.map(
    (change) => change.symbol
  );
  return {
    shouldNotify: changes.length > 0,
    changes,
    changedSymbols,
    notificationSymbols: changedSymbols.slice(),
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
  const debugEnabled =
    debugNotificationEnabled(options);
  const logger = options.logger || console;
  const stateFilePath = store.filePath ||
    options.stateFilePath ||
    '<memory/custom store>';
  const debugComparison = debugEnabled
    ? {
      previousSymbols: {},
      currentSymbols: {},
      symbolComparisons: [],
    }
    : null;
  let previousState;

  try {
    previousState = await store.load();
    if (debugEnabled) {
      logStateLoad(
        logger,
        stateFilePath,
        true,
        previousState
      );
    }
  } catch (error) {
    if (debugEnabled) {
      logStateLoad(
        logger,
        stateFilePath,
        false,
        null
      );
    }
    throw error;
  }

  const decision = evaluate(
    options.results,
    previousState,
    debugComparison
  );

  if (debugEnabled) {
    logComparedStates(
      logger,
      debugComparison.previousSymbols,
      debugComparison.currentSymbols,
      debugComparison.symbolComparisons
    );
    logDecision(logger, decision);
  }

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
  if (debugEnabled) {
    debugLog(logger, '');
    debugLog(logger, 'Notification Symbols:');
    debugLog(
      logger,
      JSON.stringify(
        decision.changes.map(
          (change) => change.symbol
        ),
        null,
        2
      )
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
  DYNAMIC_STATE_FIELDS,
  changedFieldNames,
  collectDynamicFields,
  compareSymbolStates,
  createFileStore,
  createMemoryStore,
  debugNotificationEnabled,
  evaluate,
  extractSymbolState,
  isNewMss,
  normalizeMss,
  normalizePersistedState,
  processNotifications,
  stableMssIdentity,
  structureLevelIdentity,
  webhookSucceeded,
};
