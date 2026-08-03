'use strict';

const fs = require('fs/promises');
const path = require('path');
const WatchlistLoader = require('../config/watchlistLoader');
const HtfBiasV3 = require('../indicators/ictHtfBiasEngineV3');
const LtfExecution = require(
  '../indicators/ictLtfExecutionEngine'
);
const OpportunityDetector = require(
  '../indicators/ictOpportunityDetector'
);
const WatchlistAnalyst = require(
  '../indicators/ictWatchlistAnalystReport'
);
const WatchlistRunner = require('./runWatchlistAnalyst');

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-daily-bias-opportunity-shadow-audit-v1.txt'
);

const REVIEW_SYMBOLS = Object.freeze([
  'BTCUSDT',
  'BNBUSDT',
  'ETHUSDT',
  'SNDKUSDT',
  'CLUSDT',
  'MUUSDT',
  'XAUUSDT',
  'SPCXUSDT',
]);

const CHANGE_REASONS = Object.freeze({
  UNCHANGED: 'UNCHANGED',
  DAILY_BIAS_DIRECTION_ACTIVATED:
    'DAILY_BIAS_DIRECTION_ACTIVATED',
  TRANSITION_SUPPRESSED_OPPORTUNITY:
    'TRANSITION_SUPPRESSED_OPPORTUNITY',
  WATCH_ZONE_ENTERED: 'WATCH_ZONE_ENTERED',
  WATCH_ZONE_EXITED: 'WATCH_ZONE_EXITED',
  ACTIVE_LIQUIDITY_CHANGED: 'ACTIVE_LIQUIDITY_CHANGED',
  OPPORTUNITY_DIRECTION_CHANGED:
    'OPPORTUNITY_DIRECTION_CHANGED',
  OPPORTUNITY_STATUS_CHANGED:
    'OPPORTUNITY_STATUS_CHANGED',
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
});

function currentOf(value) {
  return value && value.current ? value.current : value || {};
}

function normalizeDirection(value) {
  return value === 'BULLISH' || value === 'BEARISH'
    ? value
    : 'NEUTRAL';
}

function directional(value) {
  return value === 'BULLISH' || value === 'BEARISH';
}

function normalizeOpportunity(value) {
  value = value && typeof value === 'object' ? value : {};
  return {
    status: value.status === 'WATCH_ZONE'
      ? 'WATCH_ZONE'
      : 'WAITING',
    direction: directional(value.direction)
      ? value.direction
      : null,
    liquidityType: value.liquidityType || null,
    price: Number.isFinite(value.price) ? value.price : null,
    distancePercent: Number.isFinite(value.distancePercent)
      ? value.distancePercent
      : null,
    reason: value.reason || null,
  };
}

function observationStateOf(opportunity) {
  return opportunity.status === 'WATCH_ZONE'
    ? 'WATCH_ZONE'
    : 'WAITING_OPPORTUNITY';
}

function sameOpportunity(left, right) {
  return JSON.stringify(normalizeOpportunity(left)) ===
    JSON.stringify(normalizeOpportunity(right));
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
    : Array.isArray(value && value.roadmapLiquidity)
      ? value.roadmapLiquidity
      : [];

  return {
    symbol: value && value.symbol || current.symbol || 'UNKNOWN',
    oldDirection: normalizeDirection(h4.bias),
    newDirection: normalizeDirection(daily.marketBias),
    transitionDirection: directional(daily.transitionDirection)
      ? daily.transitionDirection
      : null,
    structurePhase: daily.structureState ||
      current.structurePhase && current.structurePhase.state ||
      'UNDETERMINED',
    currentPrice,
    liquidity,
    oldOpportunity: normalizeOpportunity(current.opportunity),
  };
}

function transitionOpportunityViolation(projection, opportunity) {
  return Boolean(
    projection.transitionDirection &&
    projection.newDirection === 'NEUTRAL' &&
    (
      opportunity.status === 'WATCH_ZONE' ||
      opportunity.direction !== null ||
      opportunity.liquidityType !== null
    )
  );
}

function changedReasonOf(projection, oldOpportunity, newOpportunity) {
  if (sameOpportunity(oldOpportunity, newOpportunity)) {
    return CHANGE_REASONS.UNCHANGED;
  }
  if (
    projection.transitionDirection &&
    projection.newDirection === 'NEUTRAL' &&
    (
      oldOpportunity.status === 'WATCH_ZONE' ||
      oldOpportunity.direction !== null
    )
  ) {
    return CHANGE_REASONS.TRANSITION_SUPPRESSED_OPPORTUNITY;
  }
  if (
    oldOpportunity.status !== 'WATCH_ZONE' &&
    newOpportunity.status === 'WATCH_ZONE'
  ) {
    return CHANGE_REASONS.WATCH_ZONE_ENTERED;
  }
  if (
    oldOpportunity.status === 'WATCH_ZONE' &&
    newOpportunity.status !== 'WATCH_ZONE'
  ) {
    return CHANGE_REASONS.WATCH_ZONE_EXITED;
  }
  if (
    oldOpportunity.liquidityType !==
      newOpportunity.liquidityType
  ) {
    return CHANGE_REASONS.ACTIVE_LIQUIDITY_CHANGED;
  }
  if (
    oldOpportunity.direction !== newOpportunity.direction
  ) {
    if (
      oldOpportunity.direction === null &&
      newOpportunity.direction !== null
    ) {
      return CHANGE_REASONS.DAILY_BIAS_DIRECTION_ACTIVATED;
    }
    return CHANGE_REASONS.OPPORTUNITY_DIRECTION_CHANGED;
  }
  return CHANGE_REASONS.OPPORTUNITY_STATUS_CHANGED;
}

function unavailableResult(value) {
  const reason = value && value.reason ||
    'CURRENT_DATA_UNAVAILABLE';
  return {
    symbol: value && value.symbol || 'UNKNOWN',
    oldDirection: 'NEUTRAL',
    newDirection: 'NEUTRAL',
    transitionDirection: null,
    structurePhase: 'UNDETERMINED',
    oldOpportunityStatus: 'DATA_UNAVAILABLE',
    newOpportunityStatus: 'DATA_UNAVAILABLE',
    oldObservationState: 'DATA_UNAVAILABLE',
    newObservationState: 'DATA_UNAVAILABLE',
    oldOpportunityDirection: null,
    newOpportunityDirection: null,
    oldLiquidityType: null,
    newLiquidityType: null,
    oldPrice: null,
    newPrice: null,
    changedReason: CHANGE_REASONS.DATA_UNAVAILABLE,
    transitionOpportunityViolation: false,
    productionParity: null,
    oldReason: reason,
    newReason: reason,
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
  const oldOpportunity = projection.oldOpportunity;
  const recalculatedOld = normalizeOpportunity(
    OpportunityDetector.detect({
      currentPrice: projection.currentPrice,
      h4Bias: projection.oldDirection,
      liquidity: projection.liquidity,
    })
  );
  const newOpportunity = normalizeOpportunity(
    OpportunityDetector.detect({
      currentPrice: projection.currentPrice,
      h4Bias: projection.newDirection,
      liquidity: projection.liquidity,
    })
  );

  return {
    symbol: projection.symbol,
    oldDirection: projection.oldDirection,
    newDirection: projection.newDirection,
    transitionDirection: projection.transitionDirection,
    structurePhase: projection.structurePhase,
    oldOpportunityStatus: oldOpportunity.status,
    newOpportunityStatus: newOpportunity.status,
    oldObservationState: observationStateOf(oldOpportunity),
    newObservationState: observationStateOf(newOpportunity),
    oldOpportunityDirection: oldOpportunity.direction,
    newOpportunityDirection: newOpportunity.direction,
    oldLiquidityType: oldOpportunity.liquidityType,
    newLiquidityType: newOpportunity.liquidityType,
    oldPrice: oldOpportunity.price,
    newPrice: newOpportunity.price,
    changedReason: changedReasonOf(
      projection,
      oldOpportunity,
      newOpportunity
    ),
    transitionOpportunityViolation:
      transitionOpportunityViolation(
        projection,
        newOpportunity
      ),
    productionParity: sameOpportunity(
      oldOpportunity,
      recalculatedOld
    ),
    oldReason: oldOpportunity.reason,
    newReason: newOpportunity.reason,
  };
}

function summarize(results) {
  const stateTransitions = {};
  const changedReasons = {};
  let changed = 0;
  let unavailable = 0;
  let directionChanges = 0;
  let liquidityChanges = 0;
  let transitionViolations = 0;
  let parityFailures = 0;

  for (const result of results) {
    const transition = result.oldObservationState + ' -> ' +
      result.newObservationState;
    stateTransitions[transition] =
      (stateTransitions[transition] || 0) + 1;
    changedReasons[result.changedReason] =
      (changedReasons[result.changedReason] || 0) + 1;
    if (result.changedReason === CHANGE_REASONS.DATA_UNAVAILABLE) {
      unavailable += 1;
      continue;
    }
    if (result.changedReason !== CHANGE_REASONS.UNCHANGED) {
      changed += 1;
    }
    if (
      result.oldOpportunityDirection !==
      result.newOpportunityDirection
    ) {
      directionChanges += 1;
    }
    if (result.oldLiquidityType !== result.newLiquidityType) {
      liquidityChanges += 1;
    }
    if (result.transitionOpportunityViolation) {
      transitionViolations += 1;
    }
    if (result.productionParity === false) parityFailures += 1;
  }

  return {
    symbols: results.length,
    available: results.length - unavailable,
    unavailable,
    changed,
    unchanged: results.length - unavailable - changed,
    directionChanges,
    liquidityChanges,
    transitionViolations,
    productionParityFailures: parityFailures,
    stateTransitions,
    changedReasons,
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
    protocol: 'ICT_DAILY_BIAS_OPPORTUNITY_SHADOW_AUDIT_V1',
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

function numberText(value) {
  return Number.isFinite(value)
    ? String(Number(value.toFixed(8)))
    : 'null';
}

function sortedEntries(value) {
  return Object.entries(value).sort(
    ([left], [right]) => left.localeCompare(right)
  );
}

function formatAudit(audit) {
  const lines = [
    'ICT Daily Bias Opportunity Shadow Audit V1',
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
    'Opportunity Changed：' + audit.summary.changed,
    'Opportunity Unchanged：' + audit.summary.unchanged,
    'Direction Changes：' + audit.summary.directionChanges,
    'Liquidity Type Changes：' + audit.summary.liquidityChanges,
    'Transition Opportunity Violations：' +
      audit.summary.transitionViolations,
    'Production Parity Failures：' +
      audit.summary.productionParityFailures,
    '',
    'Observation State Transitions',
  ];
  for (const [transition, count] of sortedEntries(
    audit.summary.stateTransitions
  )) {
    lines.push(transition + '：' + count);
  }
  lines.push('', 'Changed Reasons');
  for (const [reason, count] of sortedEntries(
    audit.summary.changedReasons
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
      'Old HTF Direction：' + result.oldDirection,
      'New Daily Bias Direction：' + result.newDirection,
      'Transition Direction：' + valueText(
        result.transitionDirection
      ),
      'Old Opportunity：' + result.oldObservationState,
      'New Opportunity：' + result.newObservationState,
      'Old Opportunity Direction：' + valueText(
        result.oldOpportunityDirection
      ),
      'New Opportunity Direction：' + valueText(
        result.newOpportunityDirection
      ),
      'Old Active Liquidity：' + valueText(
        result.oldLiquidityType
      ) + ' / ' + numberText(result.oldPrice),
      'New Active Liquidity：' + valueText(
        result.newLiquidityType
      ) + ' / ' + numberText(result.newPrice),
      'Changed Reason：' + result.changedReason,
      'Transition Opportunity Violation：' + (
        result.transitionOpportunityViolation ? 'YES' : 'NO'
      ),
      'Old Production Parity：' + valueText(
        result.productionParity
      ),
      'Old Reason：' + valueText(result.oldReason),
      'New Reason：' + valueText(result.newReason)
    );
  }
  lines.push(
    '',
    '================================',
    '',
    'Comparison Table',
    '',
    'Symbol | Old State | New State | Old Direction | New Direction | Old Liquidity | New Liquidity | Changed Reason'
  );
  for (const result of audit.results) {
    lines.push([
      result.symbol,
      result.oldObservationState,
      result.newObservationState,
      valueText(result.oldOpportunityDirection),
      valueText(result.newOpportunityDirection),
      valueText(result.oldLiquidityType),
      valueText(result.newLiquidityType),
      result.changedReason,
    ].join(' | '));
  }
  return lines.join('\n') + '\n';
}

function uniqueSymbols(values) {
  return [...new Set(values.filter(Boolean))];
}

function auditSymbols(options) {
  options = options || {};
  if (Array.isArray(options.symbols)) {
    return uniqueSymbols(options.symbols);
  }
  const loader = options.watchlistLoader || WatchlistLoader;
  const watchlist = loader.loadWatchlist(options.watchlistPath);
  return uniqueSymbols(
    REVIEW_SYMBOLS.concat(watchlist.symbols)
  );
}

async function loadSymbolReport(symbol, options) {
  try {
    const klines = await WatchlistRunner.getSymbolKlines(
      symbol,
      options
    );
    const report = WatchlistAnalyst.analyze({
      symbol,
      h4Klines: klines.h4Klines,
      ltf5mKlines: klines.ltf5mKlines,
      previousGateState: null,
      retainSnapshots: false,
    });
    const currentTime = klines.ltf5mKlines[
      klines.ltf5mKlines.length - 1
    ].closeTime;
    const currentPrice = klines.ltf5mKlines[
      klines.ltf5mKlines.length - 1
    ].close;
    const h4 = HtfBiasV3.analyze({
      h4Klines: klines.h4Klines,
    });
    const ltf = LtfExecution.analyze({
      ltfKlines: klines.ltf5mKlines,
      intervalMilliseconds: LtfExecution.FIVE_MINUTES,
      h4BiasSnapshots: h4.states,
      retainStates: true,
    });
    const h4State = WatchlistAnalyst.latestStateAtOrBefore(
      h4.states,
      currentTime
    );
    const ltfState = WatchlistAnalyst.latestStateAtOrBefore(
      ltf.states,
      currentTime
    );
    return {
      symbol,
      current: report.current,
      currentPrice,
      liquidity: WatchlistAnalyst.collectRoadmapLiquidity(
        h4State,
        ltfState
      ),
    };
  } catch (error) {
    return {
      symbol,
      dataUnavailable: true,
      reason: error && error.message || 'CURRENT_DATA_UNAVAILABLE',
    };
  }
}

async function loadCurrentReports(options) {
  options = options || {};
  const symbols = auditSymbols(options);
  const values = [];
  for (const symbol of symbols) {
    values.push(await loadSymbolReport(symbol, options));
  }
  return values;
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
  CHANGE_REASONS,
  DEFAULT_OUTPUT_PATH,
  REVIEW_SYMBOLS,
  analyzeReports,
  auditSymbol,
  auditSymbols,
  changedReasonOf,
  formatAudit,
  loadCurrentReports,
  loadSymbolReport,
  normalizeOpportunity,
  observationStateOf,
  reportProjection,
  run,
  sameOpportunity,
  summarize,
  transitionOpportunityViolation,
};
