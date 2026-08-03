'use strict';

const fs = require('fs/promises');
const path = require('path');
const DecisionGate = require('../indicators/ictDecisionGate');
const HtfAlignment = require(
  '../indicators/ictHtfAlignmentAnalyzer'
);
const OpportunityDetector = require(
  '../indicators/ictOpportunityDetector'
);
const OpportunityShadow = require(
  './runDailyBiasOpportunityShadowAudit'
);

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-daily-bias-decision-gate-shadow-audit-v1.txt'
);

const TRANSITION_REASONS = Object.freeze({
  UNCHANGED: 'UNCHANGED',
  DAILY_BIAS_ACTIVATES_WATCH_ZONE:
    'DAILY_BIAS_ACTIVATES_WATCH_ZONE',
  DAILY_BIAS_ACTIVATES_WAITING_OPPORTUNITY:
    'DAILY_BIAS_ACTIVATES_WAITING_OPPORTUNITY',
  TRANSITION_BLOCKED_AS_WAITING_HTF:
    'TRANSITION_BLOCKED_AS_WAITING_HTF',
  TRANSITION_BLOCKED_AS_HTF_TRANSITION:
    'TRANSITION_BLOCKED_AS_HTF_TRANSITION',
  OLD_DIRECTION_REMOVED:
    'OLD_DIRECTION_REMOVED',
  UNSAFE_DIRECT_CONFIRMATION:
    'UNSAFE_DIRECT_CONFIRMATION',
  GATE_STATE_CHANGED: 'GATE_STATE_CHANGED',
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
});

const UNSAFE_DIRECT_STATES = new Set([
  'CONFIRMING',
  'READY_OBSERVATION',
]);

function clone(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function currentOf(value) {
  return value && value.current ? value.current : value || {};
}

function directional(value) {
  return value === 'BULLISH' || value === 'BEARISH';
}

function normalizeDirection(value) {
  return directional(value) ? value : 'NEUTRAL';
}

function phaseStateOf(value) {
  if (typeof value === 'string') return value;
  return value && (
    value.state || value.structurePhase || value.phase
  ) || 'UNDETERMINED';
}

function normalizeOpportunity(value) {
  value = value && typeof value === 'object' ? value : {};
  return {
    status: value.status || 'WAITING',
    direction: directional(value.direction)
      ? value.direction
      : null,
    liquidityType: value.liquidityType || null,
    price: Number.isFinite(value.price) ? value.price : null,
  };
}

function normalizeActiveOpportunity(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    id: value.id || null,
    direction: directional(value.direction)
      ? value.direction
      : null,
    liquidityType: value.liquidityType || null,
    price: Number.isFinite(value.price) ? value.price : null,
  };
}

function gateComparable(value) {
  value = value && typeof value === 'object' ? value : {};
  return {
    state: value.state || 'DATA_UNAVAILABLE',
    direction: directional(value.direction)
      ? value.direction
      : null,
    activeOpportunity: normalizeActiveOpportunity(
      value.activeOpportunity
    ),
    progress: clone(value.progress),
    reasonCode: value.reasonCode || null,
  };
}

function sameGate(left, right) {
  return JSON.stringify(gateComparable(left)) ===
    JSON.stringify(gateComparable(right));
}

function reportProjection(value) {
  const current = currentOf(value);
  const h4 = current.fourHourAnalysis || {};
  const daily = h4.dailyBias || {};
  const currentPrice = Number.isFinite(value && value.currentPrice)
    ? value.currentPrice
    : Number.isFinite(current.currentPrice)
      ? current.currentPrice
      : null;
  const liquidity = Array.isArray(value && value.liquidity)
    ? value.liquidity
    : [];
  return {
    symbol: value && value.symbol || current.symbol || 'UNKNOWN',
    current,
    oldHtfDirection: normalizeDirection(h4.bias),
    newHtfDirection: normalizeDirection(daily.marketBias),
    transitionDirection: directional(daily.transitionDirection)
      ? daily.transitionDirection
      : null,
    structurePhase: phaseStateOf(current.structurePhase),
    currentPrice,
    liquidity,
  };
}

function buildShadowCurrent(projection) {
  const current = clone(projection.current);
  const shadowOpportunity = OpportunityDetector.detect({
    currentPrice: projection.currentPrice,
    h4Bias: projection.newHtfDirection,
    liquidity: projection.liquidity,
  });
  const shadowAlignment = HtfAlignment.analyze({
    biasDirection: projection.newHtfDirection,
    structurePhase: current.structurePhase,
  });
  current.fourHourAnalysis = {
    ...current.fourHourAnalysis,
    bias: projection.newHtfDirection,
  };
  current.htfAlignment = shadowAlignment;
  current.opportunity = shadowOpportunity;
  delete current.decisionGate;
  return current;
}

function isTransition(projection) {
  return Boolean(
    projection.transitionDirection ||
    projection.structurePhase === 'BULLISH_MSS' ||
    projection.structurePhase === 'BEARISH_MSS'
  );
}

function transitionWatchViolation(projection, newGate) {
  return Boolean(
    isTransition(projection) &&
    (
      newGate.state === 'WATCH_ZONE' ||
      newGate.state === 'CONFIRMING' ||
      newGate.state === 'READY_OBSERVATION' ||
      newGate.activeOpportunity
    )
  );
}

function directConfirmationViolation(oldGate, newGate) {
  return Boolean(
    !UNSAFE_DIRECT_STATES.has(oldGate.state) &&
    UNSAFE_DIRECT_STATES.has(newGate.state)
  );
}

function transitionReasonOf(projection, oldGate, newGate) {
  if (directConfirmationViolation(oldGate, newGate)) {
    return TRANSITION_REASONS.UNSAFE_DIRECT_CONFIRMATION;
  }
  if (isTransition(projection)) {
    if (newGate.state === 'HTF_TRANSITION') {
      return TRANSITION_REASONS.TRANSITION_BLOCKED_AS_HTF_TRANSITION;
    }
    if (newGate.state === 'WAITING_HTF') {
      return TRANSITION_REASONS.TRANSITION_BLOCKED_AS_WAITING_HTF;
    }
  }
  if (
    oldGate.state !== 'WATCH_ZONE' &&
    newGate.state === 'WATCH_ZONE'
  ) {
    return TRANSITION_REASONS.DAILY_BIAS_ACTIVATES_WATCH_ZONE;
  }
  if (
    oldGate.state !== 'WAITING_OPPORTUNITY' &&
    newGate.state === 'WAITING_OPPORTUNITY'
  ) {
    return TRANSITION_REASONS
      .DAILY_BIAS_ACTIVATES_WAITING_OPPORTUNITY;
  }
  if (
    directional(oldGate.direction) &&
    !directional(newGate.direction)
  ) {
    return TRANSITION_REASONS.OLD_DIRECTION_REMOVED;
  }
  if (sameGate(oldGate, newGate)) {
    return TRANSITION_REASONS.UNCHANGED;
  }
  return TRANSITION_REASONS.GATE_STATE_CHANGED;
}

function unavailableResult(value) {
  const reason = value && value.reason ||
    'CURRENT_DATA_UNAVAILABLE';
  return {
    symbol: value && value.symbol || 'UNKNOWN',
    oldGateState: 'DATA_UNAVAILABLE',
    newGateState: 'DATA_UNAVAILABLE',
    oldDirection: null,
    newDirection: null,
    oldHtfDirection: 'NEUTRAL',
    newHtfDirection: 'NEUTRAL',
    oldOpportunity: null,
    newOpportunity: null,
    structurePhase: 'UNDETERMINED',
    transitionDirection: null,
    transitionReason: TRANSITION_REASONS.DATA_UNAVAILABLE,
    oldReasonCode: reason,
    newReasonCode: reason,
    transitionWatchViolation: false,
    directConfirmationViolation: false,
    productionParity: null,
  };
}

function auditSymbol(value) {
  if (
    value && (
      value.dataUnavailable === true ||
      value.status === 'FAILED'
    )
  ) {
    return unavailableResult(value);
  }
  const projection = reportProjection(value);
  if (!Number.isFinite(projection.currentPrice)) {
    return unavailableResult({
      symbol: projection.symbol,
      reason: 'CURRENT_PRICE_UNAVAILABLE',
    });
  }
  const oldGate = projection.current.decisionGate ||
    DecisionGate.analyze({
      current: projection.current,
      previousGateState: null,
    });
  const recalculatedOldGate = DecisionGate.analyze({
    current: projection.current,
    previousGateState: null,
  });
  const shadowCurrent = buildShadowCurrent(projection);
  const newGate = DecisionGate.analyze({
    current: shadowCurrent,
    previousGateState: null,
  });
  const unsafeProgress = directConfirmationViolation(
    oldGate,
    newGate
  );

  return {
    symbol: projection.symbol,
    oldGateState: oldGate.state,
    newGateState: newGate.state,
    oldDirection: oldGate.direction,
    newDirection: newGate.direction,
    oldHtfDirection: projection.oldHtfDirection,
    newHtfDirection: projection.newHtfDirection,
    oldOpportunity: normalizeOpportunity(
      projection.current.opportunity
    ),
    newOpportunity: normalizeOpportunity(
      shadowCurrent.opportunity
    ),
    structurePhase: projection.structurePhase,
    transitionDirection: projection.transitionDirection,
    transitionReason: transitionReasonOf(
      projection,
      oldGate,
      newGate
    ),
    oldReasonCode: oldGate.reasonCode,
    newReasonCode: newGate.reasonCode,
    transitionWatchViolation: transitionWatchViolation(
      projection,
      newGate
    ),
    directConfirmationViolation: unsafeProgress,
    productionParity: sameGate(oldGate, recalculatedOldGate),
  };
}

function summarize(results) {
  const gateTransitions = {};
  const transitionReasons = {};
  let unavailable = 0;
  let changed = 0;
  let transitionWatchViolations = 0;
  let directConfirmationViolations = 0;
  let parityFailures = 0;

  for (const result of results) {
    const transition = result.oldGateState + ' -> ' +
      result.newGateState;
    gateTransitions[transition] =
      (gateTransitions[transition] || 0) + 1;
    transitionReasons[result.transitionReason] =
      (transitionReasons[result.transitionReason] || 0) + 1;
    if (result.transitionReason === TRANSITION_REASONS.DATA_UNAVAILABLE) {
      unavailable += 1;
      continue;
    }
    if (result.oldGateState !== result.newGateState) changed += 1;
    if (result.transitionWatchViolation) {
      transitionWatchViolations += 1;
    }
    if (result.directConfirmationViolation) {
      directConfirmationViolations += 1;
    }
    if (result.productionParity === false) parityFailures += 1;
  }

  return {
    symbols: results.length,
    available: results.length - unavailable,
    unavailable,
    changed,
    unchanged: results.length - unavailable - changed,
    transitionWatchViolations,
    directConfirmationViolations,
    productionParityFailures: parityFailures,
    gateTransitions,
    transitionReasons,
  };
}

function analyzeReports(values, options) {
  options = options || {};
  const source = Array.isArray(values) ? values : [];
  const sourceTimes = source.map((value) => (
    currentOf(value).asOf
  )).filter(Number.isFinite);
  const inferredSourceAsOf = sourceTimes.length > 0
    ? new Date(Math.max(...sourceTimes)).toISOString()
    : null;
  const results = source.map(auditSymbol);
  return {
    protocol: 'ICT_DAILY_BIAS_DECISION_GATE_SHADOW_AUDIT_V1',
    generatedAt: new Date(
      Number.isFinite(options.currentTime)
        ? options.currentTime
        : Date.now()
    ).toISOString(),
    dataSource: options.dataSource || 'CURRENT_WATCHLIST_H4_5M',
    sourceAsOf: options.sourceAsOf || inferredSourceAsOf,
    productionBehaviorModified: false,
    shadowPreviousGateState: null,
    results,
    summary: summarize(results),
  };
}

function valueText(value) {
  return value === null || value === undefined
    ? 'null'
    : String(value);
}

function opportunityText(value) {
  if (!value) return 'NONE';
  return [
    value.status,
    valueText(value.direction),
    valueText(value.liquidityType),
    valueText(value.price),
  ].join(' / ');
}

function sortedEntries(value) {
  return Object.entries(value).sort(
    ([left], [right]) => left.localeCompare(right)
  );
}

function formatAudit(audit) {
  const lines = [
    'ICT Daily Bias Decision Gate Shadow Audit V1',
    '',
    'Generated At：' + audit.generatedAt,
    'Data Source：' + audit.dataSource,
    'Source As Of：' + valueText(audit.sourceAsOf),
    'Production Behavior Modified：NO',
    'Shadow Previous Gate State：NONE',
    '',
    'Summary',
    '',
    'Symbols：' + audit.summary.symbols,
    'Available：' + audit.summary.available,
    'Unavailable：' + audit.summary.unavailable,
    'Gate State Changed：' + audit.summary.changed,
    'Gate State Unchanged：' + audit.summary.unchanged,
    'Transition Watch Violations：' +
      audit.summary.transitionWatchViolations,
    'Direct Confirmation Violations：' +
      audit.summary.directConfirmationViolations,
    'Production Parity Failures：' +
      audit.summary.productionParityFailures,
    '',
    'Gate State Transitions',
  ];
  for (const [transition, count] of sortedEntries(
    audit.summary.gateTransitions
  )) {
    lines.push(transition + '：' + count);
  }
  lines.push('', 'Transition Reasons');
  for (const [reason, count] of sortedEntries(
    audit.summary.transitionReasons
  )) {
    lines.push(reason + '：' + count);
  }
  for (const result of audit.results) {
    lines.push(
      '',
      '================================',
      '',
      'Symbol：' + result.symbol,
      'Structure Phase：' + result.structurePhase,
      'Transition Direction：' + valueText(
        result.transitionDirection
      ),
      'Old HTF Direction：' + result.oldHtfDirection,
      'New HTF Direction：' + result.newHtfDirection,
      'Old Gate State：' + result.oldGateState,
      'New Gate State：' + result.newGateState,
      'Old Direction：' + valueText(result.oldDirection),
      'New Direction：' + valueText(result.newDirection),
      'Old Opportunity：' + opportunityText(
        result.oldOpportunity
      ),
      'New Opportunity：' + opportunityText(
        result.newOpportunity
      ),
      'Transition Reason：' + result.transitionReason,
      'Old Reason Code：' + result.oldReasonCode,
      'New Reason Code：' + result.newReasonCode,
      'Transition Watch Violation：' + (
        result.transitionWatchViolation ? 'YES' : 'NO'
      ),
      'Direct Confirmation Violation：' + (
        result.directConfirmationViolation ? 'YES' : 'NO'
      ),
      'Old Production Parity：' + valueText(
        result.productionParity
      )
    );
  }
  lines.push(
    '',
    '================================',
    '',
    'Comparison Table',
    '',
    'Symbol | Old Gate | New Gate | Old Direction | New Direction | Old Opportunity | New Opportunity | Transition Reason'
  );
  for (const result of audit.results) {
    lines.push([
      result.symbol,
      result.oldGateState,
      result.newGateState,
      valueText(result.oldDirection),
      valueText(result.newDirection),
      opportunityText(result.oldOpportunity),
      opportunityText(result.newOpportunity),
      result.transitionReason,
    ].join(' | '));
  }
  return lines.join('\n') + '\n';
}

async function loadCurrentReports(options) {
  return OpportunityShadow.loadCurrentReports(options || {});
}

async function run(options) {
  options = options || {};
  const values = Array.isArray(options.reports)
    ? options.reports
    : await loadCurrentReports(options);
  const audit = analyzeReports(values, options);
  const body = formatAudit(audit);
  const outputPath = path.resolve(
    options.outputPath || DEFAULT_OUTPUT_PATH
  );
  await fs.mkdir(path.dirname(outputPath), {
    recursive: true,
  });
  await fs.writeFile(outputPath, body, 'utf8');
  const output = typeof options.output === 'function'
    ? options.output
    : console.log;
  output(body.trimEnd());
  return { audit, body, outputPath };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  TRANSITION_REASONS,
  analyzeReports,
  auditSymbol,
  buildShadowCurrent,
  directConfirmationViolation,
  formatAudit,
  gateComparable,
  loadCurrentReports,
  normalizeOpportunity,
  reportProjection,
  run,
  sameGate,
  summarize,
  transitionReasonOf,
  transitionWatchViolation,
};
