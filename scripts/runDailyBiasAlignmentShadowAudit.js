'use strict';

const fs = require('fs/promises');
const path = require('path');
const WatchlistLoader = require('../config/watchlistLoader');
const HtfAlignment = require(
  '../indicators/ictHtfAlignmentAnalyzer'
);
const DailyBiasShadow = require(
  './runHtfDailyBiasShadowAudit'
);

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-daily-bias-alignment-shadow-audit-v1.txt'
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
  DAILY_BIAS_DIRECTION_RESTORED:
    'DAILY_BIAS_DIRECTION_RESTORED',
  DAILY_BIAS_TRANSITION_EXPOSED:
    'DAILY_BIAS_TRANSITION_EXPOSED',
  DAILY_BIAS_DIRECTION_CHANGED:
    'DAILY_BIAS_DIRECTION_CHANGED',
  ALIGNMENT_STATUS_CHANGED:
    'ALIGNMENT_STATUS_CHANGED',
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

function phaseStateOf(value) {
  const phase = value && value.current ? value.current : value;
  if (typeof phase === 'string') return phase;
  return phase && (
    phase.state || phase.structurePhase || phase.phase
  ) || 'UNDETERMINED';
}

function reportProjection(value) {
  const current = currentOf(value);
  const h4 = current.fourHourAnalysis || {};
  const daily = h4.dailyBias || {};
  const structurePhase = current.structurePhase ||
    value && value.structurePhaseAnalysis ||
    value && value.structurePhase ||
    null;

  if (
    typeof h4.bias === 'string' &&
    typeof daily.marketBias === 'string'
  ) {
    return {
      symbol: value && value.symbol || current.symbol || 'UNKNOWN',
      oldDirection: normalizeDirection(h4.bias),
      newDirection: normalizeDirection(daily.marketBias),
      transitionDirection: normalizeDirection(
        daily.transitionDirection
      ),
      structurePhase,
    };
  }

  const shadow = DailyBiasShadow.auditSymbol(value);
  return {
    symbol: shadow.symbol,
    oldDirection: normalizeDirection(shadow.oldBias),
    newDirection: normalizeDirection(shadow.newMarketBias),
    transitionDirection: normalizeDirection(
      shadow.transitionDirection
    ),
    structurePhase,
  };
}

function changedReasonOf(projection, oldAlignment, newAlignment) {
  if (
    projection.oldDirection === projection.newDirection &&
    oldAlignment.status === newAlignment.status
  ) {
    return CHANGE_REASONS.UNCHANGED;
  }
  if (
    !directional(projection.oldDirection) &&
    directional(projection.newDirection)
  ) {
    return CHANGE_REASONS.DAILY_BIAS_DIRECTION_RESTORED;
  }
  if (
    directional(projection.oldDirection) &&
    !directional(projection.newDirection) &&
    directional(projection.transitionDirection)
  ) {
    return CHANGE_REASONS.DAILY_BIAS_TRANSITION_EXPOSED;
  }
  if (projection.oldDirection !== projection.newDirection) {
    return CHANGE_REASONS.DAILY_BIAS_DIRECTION_CHANGED;
  }
  return CHANGE_REASONS.ALIGNMENT_STATUS_CHANGED;
}

function auditSymbol(value) {
  if (
    value && (
      value.dataUnavailable === true ||
      value.status === 'FAILED'
    )
  ) {
    return {
      symbol: value.symbol || 'UNKNOWN',
      oldAlignment: 'DATA_UNAVAILABLE',
      newAlignment: 'DATA_UNAVAILABLE',
      oldDirection: 'NEUTRAL',
      newDirection: 'NEUTRAL',
      changedReason: CHANGE_REASONS.DATA_UNAVAILABLE,
      structurePhase: 'UNDETERMINED',
      transitionDirection: null,
      oldReason: value.reason || 'CURRENT_DATA_UNAVAILABLE',
      newReason: value.reason || 'CURRENT_DATA_UNAVAILABLE',
    };
  }
  const projection = reportProjection(value);
  const oldAlignment = HtfAlignment.analyze({
    biasDirection: projection.oldDirection,
    structurePhase: projection.structurePhase,
  });
  const newAlignment = HtfAlignment.analyze({
    biasDirection: projection.newDirection,
    structurePhase: projection.structurePhase,
  });

  return {
    symbol: projection.symbol,
    oldAlignment: oldAlignment.status,
    newAlignment: newAlignment.status,
    oldDirection: projection.oldDirection,
    newDirection: projection.newDirection,
    changedReason: changedReasonOf(
      projection,
      oldAlignment,
      newAlignment
    ),
    structurePhase: phaseStateOf(projection.structurePhase),
    transitionDirection: directional(
      projection.transitionDirection
    ) ? projection.transitionDirection : null,
    oldReason: oldAlignment.reason,
    newReason: newAlignment.reason,
  };
}

function summarize(results) {
  const statusTransitions = {};
  const changedReasons = {};
  let changed = 0;
  let unavailable = 0;
  for (const result of results) {
    const transition = result.oldAlignment + ' -> ' +
      result.newAlignment;
    statusTransitions[transition] =
      (statusTransitions[transition] || 0) + 1;
    changedReasons[result.changedReason] =
      (changedReasons[result.changedReason] || 0) + 1;
    if (result.changedReason === CHANGE_REASONS.DATA_UNAVAILABLE) {
      unavailable += 1;
    } else if (result.changedReason !== CHANGE_REASONS.UNCHANGED) {
      changed += 1;
    }
  }
  return {
    symbols: results.length,
    available: results.length - unavailable,
    unavailable,
    changed,
    unchanged: results.length - changed - unavailable,
    statusTransitions,
    changedReasons,
  };
}

function analyzeReports(values, options) {
  options = options || {};
  const source = Array.isArray(values) ? values : [];
  const results = source.map(auditSymbol);
  return {
    protocol: 'ICT_DAILY_BIAS_ALIGNMENT_SHADOW_AUDIT_V1',
    generatedAt: new Date(
      Number.isFinite(options.currentTime)
        ? options.currentTime
        : Date.now()
    ).toISOString(),
    dataSource: options.dataSource || 'CURRENT_WATCHLIST_H4',
    sourceAsOf: options.sourceAsOf || null,
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
    'ICT Daily Bias Alignment Shadow Audit V1',
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
    'Alignment Changed：' + audit.summary.changed,
    'Alignment Unchanged：' + audit.summary.unchanged,
    '',
    'Alignment Transitions',
  ];
  for (const [transition, count] of sortedEntries(
    audit.summary.statusTransitions
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
      'Old Direction：' + result.oldDirection,
      'New Direction：' + result.newDirection,
      'Transition Direction：' + valueText(
        result.transitionDirection
      ),
      'Old Alignment：' + result.oldAlignment,
      'New Alignment：' + result.newAlignment,
      'Changed Reason：' + result.changedReason,
      'Old Reason：' + result.oldReason,
      'New Reason：' + result.newReason
    );
  }
  lines.push(
    '',
    '================================',
    '',
    'Comparison Table',
    '',
    'Symbol | Old Alignment | New Alignment | Old Direction | New Direction | Changed Reason'
  );
  for (const result of audit.results) {
    lines.push([
      result.symbol,
      result.oldAlignment,
      result.newAlignment,
      result.oldDirection,
      result.newDirection,
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

async function loadCurrentReports(options) {
  options = options || {};
  return DailyBiasShadow.loadCurrentReports({
    ...options,
    symbols: auditSymbols(options),
  });
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
  reportProjection,
  run,
  summarize,
};
