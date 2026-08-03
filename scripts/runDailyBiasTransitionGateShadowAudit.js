'use strict';

const fs = require('fs/promises');
const path = require('path');
const DecisionGate = require('../indicators/ictDecisionGate');
const GateShadow = require(
  './runDailyBiasDecisionGateShadowAudit'
);

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-daily-bias-transition-gate-shadow-audit-v1.txt'
);

const REASONS = Object.freeze({
  TRANSITION_SEMANTIC_APPLIED:
    'TRANSITION_SEMANTIC_APPLIED',
  EXISTING_GATE_PRESERVED:
    'EXISTING_GATE_PRESERVED',
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
});

const FORBIDDEN_TRANSITION_STATES = new Set([
  'WATCH_ZONE',
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

function phaseStateOf(value) {
  if (typeof value === 'string') return value;
  return value && (
    value.state || value.structurePhase || value.phase
  ) || 'UNDETERMINED';
}

function phaseContextOf(value) {
  return value && typeof value === 'object'
    ? value.context || null
    : null;
}

function transitionInputOf(value) {
  const current = currentOf(value);
  const h4 = current.fourHourAnalysis || {};
  const daily = h4.dailyBias || {};
  const structurePhase = current.structurePhase || {};
  return {
    marketBias: daily.marketBias || 'NEUTRAL',
    legacyBias: directional(daily.legacyBias)
      ? daily.legacyBias
      : null,
    transitionDirection: directional(daily.transitionDirection)
      ? daily.transitionDirection
      : null,
    structurePhase: phaseStateOf(structurePhase),
    structureContext: phaseContextOf(structurePhase),
  };
}

function shouldApplyTransitionSemantic(input) {
  return Boolean(
    input.marketBias === 'NEUTRAL' &&
    input.transitionDirection &&
    input.structureContext === 'POST_MSS'
  );
}

function emptyProgress() {
  return {
    sweepCompleted: false,
    mssCompleted: false,
    displacementCompleted: false,
    strictConfirmationCompleted: false,
  };
}

function currentTimeOf(current) {
  if (!current || typeof current !== 'object') return null;
  if (Number.isFinite(current.asOf)) return current.asOf;
  if (Number.isFinite(current.time)) return current.time;
  return null;
}

function applyTransitionSemantic(existingGate, current, input) {
  const result = clone(existingGate);
  if (!shouldApplyTransitionSemantic(input)) return result;
  return {
    ...result,
    state: 'HTF_TRANSITION',
    direction: null,
    activeOpportunity: null,
    progress: emptyProgress(),
    sourceState: {
      ...(result.sourceState || {}),
      dailyBiasMarketBias: input.marketBias,
      legacyBias: input.legacyBias,
      transitionDirection: input.transitionDirection,
      structurePhase: input.structurePhase,
      structureContext: input.structureContext,
    },
    blockers: ['WAITING_STRUCTURE_CONFIRMATION'],
    reasonCode: 'HTF_STRUCTURE_TRANSITION',
    transition: {
      changed: result.state !== 'HTF_TRANSITION',
      from: result.state || null,
      to: 'HTF_TRANSITION',
      reason: 'HTF_STRUCTURE_TRANSITION',
      occurredAt: currentTimeOf(current),
    },
    informationalOnly: true,
  };
}

function sameGate(left, right) {
  return JSON.stringify(
    GateShadow.gateComparable(left)
  ) === JSON.stringify(
    GateShadow.gateComparable(right)
  );
}

function transitionSafetyViolation(input, gate) {
  return Boolean(
    shouldApplyTransitionSemantic(input) &&
    (
      FORBIDDEN_TRANSITION_STATES.has(gate.state) ||
      gate.activeOpportunity ||
      Object.values(gate.progress || {}).some(Boolean)
    )
  );
}

function confirmedTrendChanged(input, existingGate, shadowGate) {
  return Boolean(
    !shouldApplyTransitionSemantic(input) &&
    !sameGate(existingGate, shadowGate)
  );
}

function unavailableResult(value) {
  const reason = value && value.reason ||
    'CURRENT_DATA_UNAVAILABLE';
  return {
    symbol: value && value.symbol || 'UNKNOWN',
    marketBias: 'NEUTRAL',
    legacyBias: null,
    transitionDirection: null,
    structurePhase: 'UNDETERMINED',
    structureContext: null,
    currentGateState: 'DATA_UNAVAILABLE',
    shadowGateState: 'DATA_UNAVAILABLE',
    currentDirection: null,
    shadowDirection: null,
    reason: REASONS.DATA_UNAVAILABLE,
    currentReasonCode: reason,
    shadowReasonCode: reason,
    semanticApplied: false,
    transitionSafetyViolation: false,
    confirmedTrendChanged: false,
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
  const projection = GateShadow.reportProjection(value);
  if (!Number.isFinite(projection.currentPrice)) {
    return unavailableResult({
      symbol: projection.symbol,
      reason: 'CURRENT_PRICE_UNAVAILABLE',
    });
  }
  const dailyCurrent = GateShadow.buildShadowCurrent(projection);
  const existingGate = DecisionGate.analyze({
    current: dailyCurrent,
    previousGateState: null,
  });
  const input = transitionInputOf(value);
  const shadowGate = applyTransitionSemantic(
    existingGate,
    dailyCurrent,
    input
  );
  const applied = shouldApplyTransitionSemantic(input);

  return {
    symbol: projection.symbol,
    marketBias: input.marketBias,
    legacyBias: input.legacyBias,
    transitionDirection: input.transitionDirection,
    structurePhase: input.structurePhase,
    structureContext: input.structureContext,
    currentGateState: existingGate.state,
    shadowGateState: shadowGate.state,
    currentDirection: existingGate.direction,
    shadowDirection: shadowGate.direction,
    reason: applied
      ? REASONS.TRANSITION_SEMANTIC_APPLIED
      : REASONS.EXISTING_GATE_PRESERVED,
    currentReasonCode: existingGate.reasonCode,
    shadowReasonCode: shadowGate.reasonCode,
    semanticApplied: applied,
    transitionSafetyViolation: transitionSafetyViolation(
      input,
      shadowGate
    ),
    confirmedTrendChanged: confirmedTrendChanged(
      input,
      existingGate,
      shadowGate
    ),
  };
}

function summarize(results) {
  const stateTransitions = {};
  const reasons = {};
  let unavailable = 0;
  let changed = 0;
  let semanticApplied = 0;
  let transitionSafetyViolations = 0;
  let confirmedTrendChanges = 0;

  for (const result of results) {
    const transition = result.currentGateState + ' -> ' +
      result.shadowGateState;
    stateTransitions[transition] =
      (stateTransitions[transition] || 0) + 1;
    reasons[result.reason] = (reasons[result.reason] || 0) + 1;
    if (result.reason === REASONS.DATA_UNAVAILABLE) {
      unavailable += 1;
      continue;
    }
    if (result.currentGateState !== result.shadowGateState) {
      changed += 1;
    }
    if (result.semanticApplied) semanticApplied += 1;
    if (result.transitionSafetyViolation) {
      transitionSafetyViolations += 1;
    }
    if (result.confirmedTrendChanged) {
      confirmedTrendChanges += 1;
    }
  }

  return {
    symbols: results.length,
    available: results.length - unavailable,
    unavailable,
    changed,
    unchanged: results.length - unavailable - changed,
    semanticApplied,
    transitionSafetyViolations,
    confirmedTrendChanges,
    stateTransitions,
    reasons,
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
    protocol:
      'ICT_DAILY_BIAS_TRANSITION_GATE_SHADOW_AUDIT_V1',
    generatedAt: new Date(
      Number.isFinite(options.currentTime)
        ? options.currentTime
        : Date.now()
    ).toISOString(),
    dataSource: options.dataSource || 'CURRENT_WATCHLIST_H4_5M',
    sourceAsOf: options.sourceAsOf || inferredSourceAsOf,
    productionBehaviorModified: false,
    results,
    summary: summarize(results),
  };
}

function valueText(value) {
  return value === null || value === undefined
    ? 'null'
    : String(value);
}

function sortedEntries(value) {
  return Object.entries(value).sort(
    ([left], [right]) => left.localeCompare(right)
  );
}

function formatAudit(audit) {
  const lines = [
    'ICT Daily Bias Transition Gate Shadow Audit V1',
    '',
    'Generated At：' + audit.generatedAt,
    'Data Source：' + audit.dataSource,
    'Source As Of：' + valueText(audit.sourceAsOf),
    'Production Behavior Modified：NO',
    '',
    'Summary',
    '',
    'Symbols：' + audit.summary.symbols,
    'Available：' + audit.summary.available,
    'Unavailable：' + audit.summary.unavailable,
    'Gate State Changed：' + audit.summary.changed,
    'Gate State Unchanged：' + audit.summary.unchanged,
    'Transition Semantic Applied：' +
      audit.summary.semanticApplied,
    'Transition Safety Violations：' +
      audit.summary.transitionSafetyViolations,
    'Confirmed Trend Changes：' +
      audit.summary.confirmedTrendChanges,
    '',
    'Gate State Transitions',
  ];
  for (const [transition, count] of sortedEntries(
    audit.summary.stateTransitions
  )) {
    lines.push(transition + '：' + count);
  }
  lines.push('', 'Reasons');
  for (const [reason, count] of sortedEntries(
    audit.summary.reasons
  )) {
    lines.push(reason + '：' + count);
  }
  for (const result of audit.results) {
    lines.push(
      '',
      '================================',
      '',
      'Symbol：' + result.symbol,
      'Market Bias：' + result.marketBias,
      'Legacy Bias：' + valueText(result.legacyBias),
      'Transition Direction：' + valueText(
        result.transitionDirection
      ),
      'Structure Phase：' + result.structurePhase,
      'Structure Context：' + valueText(
        result.structureContext
      ),
      'Current Gate State：' + result.currentGateState,
      'Shadow Gate State：' + result.shadowGateState,
      'Current Direction：' + valueText(
        result.currentDirection
      ),
      'Shadow Direction：' + valueText(
        result.shadowDirection
      ),
      'Reason：' + result.reason,
      'Current Reason Code：' + result.currentReasonCode,
      'Shadow Reason Code：' + result.shadowReasonCode,
      'Transition Safety Violation：' + (
        result.transitionSafetyViolation ? 'YES' : 'NO'
      ),
      'Confirmed Trend Changed：' + (
        result.confirmedTrendChanged ? 'YES' : 'NO'
      )
    );
  }
  lines.push(
    '',
    '================================',
    '',
    'Comparison Table',
    '',
    'Symbol | Market Bias | Transition | Phase | Context | Current Gate | Shadow Gate | Reason'
  );
  for (const result of audit.results) {
    lines.push([
      result.symbol,
      result.marketBias,
      valueText(result.transitionDirection),
      result.structurePhase,
      valueText(result.structureContext),
      result.currentGateState,
      result.shadowGateState,
      result.reason,
    ].join(' | '));
  }
  return lines.join('\n') + '\n';
}

async function loadCurrentReports(options) {
  return GateShadow.loadCurrentReports(options || {});
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
  FORBIDDEN_TRANSITION_STATES,
  REASONS,
  analyzeReports,
  applyTransitionSemantic,
  auditSymbol,
  confirmedTrendChanged,
  formatAudit,
  loadCurrentReports,
  run,
  shouldApplyTransitionSemantic,
  summarize,
  transitionInputOf,
  transitionSafetyViolation,
};
