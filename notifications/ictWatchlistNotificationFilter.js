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
  CONFIRMATION_STATUS_CHANGED:
    'CONFIRMATION_STATUS_CHANGED',
  ALIGNMENT_STATUS_CHANGED:
    'ALIGNMENT_STATUS_CHANGED',
  OPPORTUNITY_CHANGED: 'OPPORTUNITY_CHANGED',
  DECISION_GATE_TRANSITION: 'DECISION_GATE_TRANSITION',
});

const PRIORITY_GATE_STATES = new Set([
  'READY_OBSERVATION',
  'HTF_CONFLICT',
  'INVALIDATED',
]);

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

function normalizeConfirmation(value) {
  value = value && typeof value === 'object'
    ? value
    : {};
  let status = value.status;
  let direction = value.direction;

  if (status === 'CONFIRMED') {
    status = direction === 'BULLISH'
      ? 'CONFIRMED_BULLISH'
      : direction === 'BEARISH'
        ? 'CONFIRMED_BEARISH'
        : 'WAITING';
  }
  if (
    status !== 'CONFIRMED_BULLISH' &&
    status !== 'CONFIRMED_BEARISH'
  ) {
    status = 'WAITING';
  }
  if (status === 'CONFIRMED_BULLISH') {
    direction = 'BULLISH';
  } else if (status === 'CONFIRMED_BEARISH') {
    direction = 'BEARISH';
  } else {
    direction = null;
  }
  return { status, direction };
}

function normalizeAlignment(value) {
  value = value && typeof value === 'object'
    ? value
    : {};
  const status = [
    'ALIGNED',
    'CONFLICT',
    'WAITING',
  ].includes(value.status)
    ? value.status
    : 'WAITING';
  const direction = (
    value.direction === 'BULLISH' ||
    value.direction === 'BEARISH'
  )
    ? value.direction
    : null;
  return {
    status,
    direction,
    reason: typeof value.reason === 'string'
      ? value.reason
      : '',
  };
}

function normalizeOpportunity(value) {
  value = value && typeof value === 'object'
    ? value
    : {};
  return {
    status: value.status === 'WATCH_ZONE'
      ? 'WATCH_ZONE'
      : 'WAITING',
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
    price: Number.isFinite(value.price)
      ? value.price
      : null,
  };
}

function normalizeGateOpportunity(value) {
  if (!value || typeof value !== 'object') return null;
  const direction = (
    value.direction === 'BULLISH' ||
    value.direction === 'BEARISH'
  )
    ? value.direction
    : null;
  const liquidityType =
    typeof value.liquidityType === 'string'
      ? value.liquidityType
      : null;
  const price = Number.isFinite(value.price)
    ? value.price
    : null;
  if (!direction || !liquidityType || price === null) {
    return null;
  }
  return {
    id: [direction, liquidityType, price].join('|'),
    direction,
    liquidityType,
    price,
  };
}

function normalizeGateProgress(value) {
  value = value && typeof value === 'object'
    ? value
    : {};
  return {
    sweepCompleted: value.sweepCompleted === true,
    mssCompleted: value.mssCompleted === true,
    displacementCompleted:
      value.displacementCompleted === true,
    strictConfirmationCompleted:
      value.strictConfirmationCompleted === true,
  };
}

function normalizeGateTransition(value, state) {
  value = value && typeof value === 'object'
    ? value
    : {};
  return {
    changed: value.changed === true,
    from: typeof value.from === 'string'
      ? value.from
      : null,
    to: typeof value.to === 'string'
      ? value.to
      : state,
  };
}

function normalizeDecisionGate(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.state !== 'string'
  ) {
    return null;
  }
  const direction = (
    value.direction === 'BULLISH' ||
    value.direction === 'BEARISH'
  )
    ? value.direction
    : null;
  return {
    state: value.state,
    direction,
    activeOpportunity: normalizeGateOpportunity(
      value.activeOpportunity
    ),
    progress: normalizeGateProgress(value.progress),
    blockers: Array.isArray(value.blockers)
      ? value.blockers.filter(
        (blocker) => typeof blocker === 'string'
      )
      : [],
    reasonCode: typeof value.reasonCode === 'string'
      ? value.reasonCode
      : '',
    transition: normalizeGateTransition(
      value.transition,
      value.state
    ),
  };
}

function confirmationFromCurrent(current) {
  const observed = current &&
    current.fiveMinuteObservation &&
    current.fiveMinuteObservation.currentConfirmed
    ? current.fiveMinuteObservation.currentConfirmed
      .confirmation
    : null;
  return normalizeConfirmation({
    status: current &&
      current.fiveMinuteConfirmationStatus
      ? current.fiveMinuteConfirmationStatus
      : observed && observed.status,
    direction: observed && observed.direction,
  });
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
    !current.fiveMinuteObservation
  ) {
    throw new Error(
      'A symbol and current ICT Analyst Report are required.'
    );
  }

  const latest = current.fiveMinuteObservation
    .latestConfirmed || {};
  const decisionGate = normalizeDecisionGate(
    current.decisionGate
  );
  return {
    symbol,
    h4Bias:
      current.fourHourAnalysis.bias || 'UNAVAILABLE',
    confirmation: confirmationFromCurrent(current),
    alignment: normalizeAlignment(current.alignment),
    opportunity: normalizeOpportunity(
      current.opportunity
    ),
    latestMss: normalizeMss(latest.mss),
    ...(decisionGate ? { decisionGate } : {}),
  };
}

function gateStableState(value) {
  if (!value) return null;
  return {
    state: value.state,
    activeOpportunity: value.activeOpportunity,
    progress: value.progress,
  };
}

function compareDecisionGates(previousGate, currentGate) {
  const reported = currentGate.transition || {};
  const stableChanged = !previousGate ||
    !isDeepStrictEqual(
      gateStableState(previousGate),
      gateStableState(currentGate)
    );
  const reportedTransitionIsConsistent = Boolean(
    previousGate &&
    reported.changed === true &&
    reported.from === previousGate.state &&
    reported.to === currentGate.state
  );
  const priorityTransition = Boolean(
    previousGate &&
    previousGate.state !== currentGate.state &&
    PRIORITY_GATE_STATES.has(currentGate.state)
  );
  const changed = stableChanged ||
    reportedTransitionIsConsistent ||
    priorityTransition;

  return {
    shouldNotify: changed,
    reasons: changed
      ? [CHANGE_REASONS.DECISION_GATE_TRANSITION]
      : [],
    decisionGateTransition: {
      changed,
      from: previousGate
        ? previousGate.state
        : reported.from,
      to: currentGate.state,
      direction: currentGate.direction,
      reasonCode: currentGate.reasonCode,
      activeOpportunity: clone(
        currentGate.activeOpportunity
      ),
      priority: PRIORITY_GATE_STATES.has(
        currentGate.state
      ),
    },
  };
}

function compareSymbolStates(previousState, currentState) {
  if (!previousState) {
    return {
      shouldNotify: true,
      reasons: [CHANGE_REASONS.INITIAL_STATE],
      decisionGateTransition: currentState.decisionGate
        ? compareDecisionGates(
          null,
          currentState.decisionGate
        ).decisionGateTransition
        : null,
    };
  }

  if (currentState.decisionGate) {
    return compareDecisionGates(
      previousState.decisionGate || null,
      currentState.decisionGate
    );
  }

  const reasons = [];
  if (previousState.h4Bias !== currentState.h4Bias) {
    reasons.push(CHANGE_REASONS.H4_BIAS_CHANGED);
  }
  if (
    previousState.confirmation.status !==
      currentState.confirmation.status ||
    previousState.confirmation.direction !==
      currentState.confirmation.direction
  ) {
    reasons.push(
      CHANGE_REASONS.CONFIRMATION_STATUS_CHANGED
    );
  }
  if (
    previousState.alignment.status !==
      currentState.alignment.status ||
    previousState.alignment.direction !==
      currentState.alignment.direction
  ) {
    reasons.push(
      CHANGE_REASONS.ALIGNMENT_STATUS_CHANGED
    );
  }
  if (
    previousState.opportunity.status !==
      currentState.opportunity.status ||
    previousState.opportunity.direction !==
      currentState.opportunity.direction ||
    previousState.opportunity.liquidityType !==
      currentState.opportunity.liquidityType
  ) {
    reasons.push(CHANGE_REASONS.OPPORTUNITY_CHANGED);
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
      confirmation: normalizeConfirmation(
        state.confirmation
      ),
      alignment: normalizeAlignment(state.alignment),
      opportunity: normalizeOpportunity(
        state.opportunity
      ),
      latestMss: normalizeMss(state.latestMss),
      ...(normalizeDecisionGate(state.decisionGate)
        ? {
          decisionGate: normalizeDecisionGate(
            state.decisionGate
          ),
        }
        : {}),
    };
  }

  return {
    version: 6,
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
      decisionGateTransition:
        comparison.decisionGateTransition || null,
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
  normalizeAlignment,
  normalizeConfirmation,
  normalizeDecisionGate,
  normalizeGateOpportunity,
  normalizeGateProgress,
  normalizeGateTransition,
  normalizeMss,
  normalizeOpportunity,
  normalizePersistedState,
  compareDecisionGates,
  processNotifications,
  stableMssIdentity,
  structureLevelIdentity,
  webhookSucceeded,
};
