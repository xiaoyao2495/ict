'use strict';

const fs = require('fs/promises');
const path = require('path');
const Binance = require('../api/binance');
const WatchlistLoader = require('../config/watchlistLoader');
const AvailabilityChecker = require(
  '../config/symbolAvailabilityChecker'
);
const WatchlistRunner = require('./runWatchlistAnalyst');
const HtfBiasV3 = require('../indicators/ictHtfBiasEngineV3');
const HtfDailyBiasV1 = require(
  '../indicators/ictHtfDailyBiasEngineV1'
);
const WatchlistAnalyst = require(
  '../indicators/ictWatchlistAnalystReport'
);

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-htf-daily-bias-shadow-audit-v1.txt'
);

const ASSESSMENTS = Object.freeze({
  UNCHANGED: 'UNCHANGED',
  DIRECTION_LOCATION_SEPARATED:
    'DIRECTION_LOCATION_SEPARATED',
  TRANSITION_EXPOSED: 'TRANSITION_EXPOSED',
  DIRECTION_CHANGED_REVIEW_REQUIRED:
    'DIRECTION_CHANGED_REVIEW_REQUIRED',
});

function last(values) {
  return Array.isArray(values) && values.length > 0
    ? values[values.length - 1]
    : null;
}

function normalizeBias(value) {
  return value === 'BULLISH' || value === 'BEARISH'
    ? value
    : 'NEUTRAL';
}

function directional(value) {
  return value === 'BULLISH' || value === 'BEARISH';
}

function currentPhaseOf(value) {
  const phase = value && value.current ? value.current : value;
  return phase && typeof phase === 'object' ? phase : {};
}

function phaseStateOf(value) {
  const phase = currentPhaseOf(value);
  return phase.state ||
    phase.structurePhase ||
    phase.phase ||
    'UNDETERMINED';
}

function oldBiasOf(value) {
  if (value && typeof value.oldBias === 'string') {
    return normalizeBias(value.oldBias);
  }
  const state = value && value.htfBiasState ||
    last(value && value.htfBiasAnalysis &&
      value.htfBiasAnalysis.states);
  return normalizeBias(
    state && (
      state.bias ||
      state.narrative && state.narrative.bias
    )
  );
}

function classifySemanticChange(oldBias, dailyBias) {
  const oldValue = normalizeBias(oldBias);
  const newValue = normalizeBias(
    dailyBias && dailyBias.marketBias
  );
  if (oldValue === newValue) {
    return ASSESSMENTS.UNCHANGED;
  }
  if (!directional(oldValue) && directional(newValue)) {
    return ASSESSMENTS.DIRECTION_LOCATION_SEPARATED;
  }
  if (
    directional(oldValue) &&
    !directional(newValue) &&
    directional(dailyBias && dailyBias.transitionDirection)
  ) {
    return ASSESSMENTS.TRANSITION_EXPOSED;
  }
  return ASSESSMENTS.DIRECTION_CHANGED_REVIEW_REQUIRED;
}

function drawProjection(draw) {
  if (!draw) return null;
  return {
    side: draw.side || null,
    type: draw.type || null,
    price: Number.isFinite(draw.price) ? draw.price : null,
    distancePercent: Number.isFinite(draw.distancePercent)
      ? draw.distancePercent
      : null,
  };
}

function auditInputOf(value) {
  value = value || {};
  const htfState = value.htfBiasState ||
    last(value.htfBiasAnalysis && value.htfBiasAnalysis.states);
  const structurePhase = value.structurePhaseAnalysis ||
    value.structurePhase ||
    null;
  return {
    structurePhase,
    structureTimeline:
      value.structureTimeline ||
      structurePhase && structurePhase.states ||
      [],
    htfBiasState: htfState || null,
    liquidity: value.liquidity ||
      htfState && htfState.liquidity ||
      null,
    dealingRange: value.dealingRange ||
      htfState && htfState.dealingRange ||
      null,
    currentPrice: Number.isFinite(value.currentPrice)
      ? value.currentPrice
      : htfState && htfState.referencePrice,
  };
}

function auditSymbol(value) {
  value = value || {};
  const dailyBias = HtfDailyBiasV1.analyze(
    auditInputOf(value)
  );
  const oldBias = oldBiasOf(value);
  return {
    symbol: value.symbol || 'UNKNOWN',
    oldBias,
    newMarketBias: dailyBias.marketBias,
    legacyBias: dailyBias.legacyBias,
    transitionDirection: dailyBias.transitionDirection,
    structurePhase: dailyBias.structureState,
    structureContext:
      currentPhaseOf(
        value.structurePhaseAnalysis || value.structurePhase
      ).context || null,
    location: { ...dailyBias.location },
    drawOnLiquidity: drawProjection(
      dailyBias.drawOnLiquidity
    ),
    htfLocationReadiness:
      dailyBias.htfLocationReadiness,
    reasons: dailyBias.reasons.slice(),
    semanticAssessment: classifySemanticChange(
      oldBias,
      dailyBias
    ),
  };
}

function emptyCounts() {
  return Object.values(ASSESSMENTS).reduce(
    (counts, assessment) => ({
      ...counts,
      [assessment]: 0,
    }),
    {}
  );
}

function summarize(results) {
  const assessments = emptyCounts();
  for (const result of results) {
    assessments[result.semanticAssessment] += 1;
  }
  return {
    symbols: results.length,
    same: assessments[ASSESSMENTS.UNCHANGED],
    changed:
      results.length - assessments[ASSESSMENTS.UNCHANGED],
    assessments,
  };
}

function analyzeReports(values, options) {
  options = options || {};
  const source = Array.isArray(values) ? values : [];
  const results = source.map(auditSymbol);
  return {
    protocol: 'ICT_HTF_DAILY_BIAS_SHADOW_AUDIT_V1',
    generatedAt: new Date(
      Number.isFinite(options.currentTime)
        ? options.currentTime
        : Date.now()
    ).toISOString(),
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

function drawText(draw) {
  if (!draw) return 'NONE';
  return [
    valueText(draw.side),
    valueText(draw.type),
    numberText(draw.price),
  ].join(' / ');
}

function formatAudit(audit) {
  const lines = [
    'ICT Daily Bias V1 Shadow Audit',
    '',
    'Generated At：' + audit.generatedAt,
    'Production Behavior Modified：NO',
    '',
    'Summary',
    '',
    'Symbols：' + audit.summary.symbols,
    'Same：' + audit.summary.same,
    'Changed：' + audit.summary.changed,
  ];
  for (const assessment of Object.values(ASSESSMENTS)) {
    lines.push(
      assessment + '：' +
      audit.summary.assessments[assessment]
    );
  }
  for (const result of audit.results) {
    lines.push(
      '',
      '================================',
      '',
      'Symbol：' + result.symbol,
      'Old Bias：' + result.oldBias,
      'New Market Bias：' + result.newMarketBias,
      'Legacy Bias：' + valueText(result.legacyBias),
      'Transition Direction：' + valueText(
        result.transitionDirection
      ),
      'Structure Phase：' + result.structurePhase,
      'Structure Context：' + valueText(
        result.structureContext
      ),
      'Location：' + result.location.state,
      'Range Relation：' +
        result.location.relationToRange,
      'Dealing Range：' +
        numberText(result.location.rangeLow) + ' - ' +
        numberText(result.location.rangeHigh),
      'Equilibrium：' +
        numberText(result.location.equilibrium),
      'Draw On Liquidity：' +
        drawText(result.drawOnLiquidity),
      'HTF Location Readiness：' +
        result.htfLocationReadiness,
      'Semantic Assessment：' +
        result.semanticAssessment,
      'Reasons：' + result.reasons.join(' / ')
    );
  }
  lines.push(
    '',
    '================================',
    '',
    'Manual Review Table',
    '',
    'Symbol | Old Bias | New Bias | Structure Phase | Assessment'
  );
  for (const result of audit.results) {
    lines.push([
      result.symbol,
      result.oldBias,
      result.newMarketBias,
      result.structurePhase,
      result.semanticAssessment,
    ].join(' | '));
  }
  return lines.join('\n') + '\n';
}

async function loadCurrentReports(options) {
  options = options || {};
  const currentTime = Number.isFinite(options.currentTime)
    ? options.currentTime
    : Date.now();
  const loader = options.watchlistLoader || WatchlistLoader;
  const configured = Array.isArray(options.symbols)
    ? { symbols: options.symbols.slice() }
    : loader.loadWatchlist(options.watchlistPath);
  const checker = options.symbolAvailabilityChecker ||
    AvailabilityChecker;
  const marketData = options.marketData || Binance;
  const availability = await checker.checkSymbols(
    configured.symbols,
    { binanceApi: options.exchangeInfoApi || marketData }
  );
  const results = [];

  for (const symbol of availability.validSymbols) {
    const h4Klines = await WatchlistRunner.getKline(
      symbol,
      '4h',
      {
        currentTime,
        limit: options.limit,
        marketData,
      }
    );
    const htfBiasAnalysis = HtfBiasV3.analyze({ h4Klines });
    const structurePhaseAnalysis =
      WatchlistAnalyst.analyzeStructurePhase(h4Klines);
    const htfBiasState = last(htfBiasAnalysis.states);
    results.push({
      symbol,
      htfBiasAnalysis,
      htfBiasState,
      structurePhaseAnalysis,
      currentPrice: htfBiasState
        ? htfBiasState.referencePrice
        : null,
    });
  }
  return results;
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
  ASSESSMENTS,
  DEFAULT_OUTPUT_PATH,
  analyzeReports,
  auditInputOf,
  auditSymbol,
  classifySemanticChange,
  formatAudit,
  loadCurrentReports,
  run,
  summarize,
};
