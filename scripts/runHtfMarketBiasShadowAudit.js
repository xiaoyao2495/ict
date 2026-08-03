'use strict';

const fs = require('fs/promises');
const path = require('path');
const WatchlistLoader = require('../config/watchlistLoader');
const AvailabilityChecker = require(
  '../config/symbolAvailabilityChecker'
);
const Binance = require('../api/binance');
const WatchlistRunner = require('./runWatchlistAnalyst');
const AnalystReport = require(
  '../indicators/ictWatchlistAnalystReport'
);
const HtfBiasV3 = require('../indicators/ictHtfBiasEngineV3');
const Resolver = require(
  '../indicators/ictHtfMarketBiasResolver'
);

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-htf-market-bias-shadow-audit-v1.txt'
);

const DIFFERENCE_TYPES = Object.freeze({
  OLD_NEUTRAL_NEW_DIRECTION: 'OLD_NEUTRAL_NEW_DIRECTION',
  OLD_DIRECTION_NEW_TRANSITION: 'OLD_DIRECTION_NEW_TRANSITION',
  SAME: 'SAME',
  DIRECTION_CHANGED: 'DIRECTION_CHANGED',
});

function directionOf(value) {
  return value === 'BULLISH' || value === 'BEARISH'
    ? value
    : null;
}

function normalizeBias(value) {
  return directionOf(value) || 'NEUTRAL';
}

function classifyDifference(oldBias, shadow) {
  const oldValue = normalizeBias(oldBias);
  const newValue = normalizeBias(
    shadow && shadow.marketBias
  );
  if (oldValue === newValue) {
    return DIFFERENCE_TYPES.SAME;
  }
  if (!directionOf(oldValue) && directionOf(newValue)) {
    return DIFFERENCE_TYPES.OLD_NEUTRAL_NEW_DIRECTION;
  }
  if (
    directionOf(oldValue) &&
    !directionOf(newValue) &&
    directionOf(shadow && shadow.transitionDirection)
  ) {
    return DIFFERENCE_TYPES.OLD_DIRECTION_NEW_TRANSITION;
  }
  return DIFFERENCE_TYPES.DIRECTION_CHANGED;
}

function currentOf(report) {
  return report && report.current
    ? report.current
    : report;
}

function reportOf(value) {
  return value && value.report ? value.report : value;
}

function symbolOf(value, report) {
  return value && value.symbol ||
    report && report.symbol ||
    currentOf(report) && currentOf(report).symbol ||
    null;
}

function currentPriceOf(value, report) {
  if (value && Number.isFinite(value.currentPrice)) {
    return value.currentPrice;
  }
  const current = currentOf(report) || {};
  if (Number.isFinite(current.currentPrice)) {
    return current.currentPrice;
  }
  if (Number.isFinite(current.referencePrice)) {
    return current.referencePrice;
  }
  return null;
}

function shadowInputs(value, report) {
  const current = currentOf(report) || {};
  return {
    h4Bias: value && value.h4BiasAnalysis ||
      current.fourHourAnalysis || null,
    structurePhase:
      value && value.structurePhaseAnalysis ||
      current.structurePhase || null,
    currentPrice: currentPriceOf(value, report),
  };
}

function auditReport(value) {
  const report = reportOf(value);
  const current = currentOf(report) || {};
  const h4 = current.fourHourAnalysis || {};
  const shadow = Resolver.analyze(
    shadowInputs(value, report)
  );
  const oldBias = normalizeBias(h4.bias);
  const differenceType = classifyDifference(
    oldBias,
    shadow
  );
  return {
    symbol: symbolOf(value, report) || 'UNKNOWN',
    oldBias,
    newMarketBias: shadow.marketBias,
    legacyBias: shadow.legacyBias,
    transitionDirection: shadow.transitionDirection,
    structurePhase: shadow.structurePhase,
    location: shadow.location.state,
    rangeRelation: shadow.location.relationToRange,
    htfLocationReadiness: shadow.htfLocationReadiness,
    differenceType,
    changed: differenceType !== DIFFERENCE_TYPES.SAME,
  };
}

function emptyCounts() {
  return Object.values(DIFFERENCE_TYPES).reduce(
    (result, type) => ({ ...result, [type]: 0 }),
    {}
  );
}

function summarize(results) {
  const counts = emptyCounts();
  for (const result of results) {
    counts[result.differenceType] += 1;
  }
  return {
    symbols: results.length,
    same: counts[DIFFERENCE_TYPES.SAME],
    changed: results.length - counts[DIFFERENCE_TYPES.SAME],
    differenceTypes: counts,
  };
}

function analyzeReports(reports, options) {
  options = options || {};
  const source = Array.isArray(reports) ? reports : [];
  const results = source.map(auditReport);
  return {
    protocol: 'ICT_HTF_MARKET_BIAS_SHADOW_AUDIT_V1',
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

function formatAudit(audit) {
  const lines = [
    'Production HTF Market Bias Shadow Audit V1',
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
  for (const type of Object.values(DIFFERENCE_TYPES)) {
    lines.push(
      type + '：' + audit.summary.differenceTypes[type]
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
      'Location：' + result.location,
      'Range Relation：' + result.rangeRelation,
      'HTF Location Readiness：' +
        result.htfLocationReadiness,
      'Difference Type：' + result.differenceType
    );
  }
  return lines.join('\n') + '\n';
}

async function loadCurrentReports(options) {
  options = options || {};
  const currentTime = Number.isFinite(options.currentTime)
    ? options.currentTime
    : Date.now();
  const loader = options.watchlistLoader || WatchlistLoader;
  const watchlist = loader.loadWatchlist(
    options.watchlistPath
  );
  const checker = options.symbolAvailabilityChecker ||
    AvailabilityChecker;
  const marketData = options.marketData || Binance;
  const availability = await checker.checkSymbols(
    watchlist.symbols,
    { binanceApi: options.exchangeInfoApi || marketData }
  );
  const results = [];

  for (const symbol of availability.validSymbols) {
    const klines = await WatchlistRunner.getSymbolKlines(
      symbol,
      {
        currentTime,
        limit: options.limit,
        marketData,
      }
    );
    const h4BiasAnalysis = HtfBiasV3.analyze({
      h4Klines: klines.h4Klines,
    });
    const structurePhaseAnalysis =
      AnalystReport.analyzeStructurePhase(
        klines.h4Klines
      );
    const report = AnalystReport.analyze({
      symbol,
      h4Klines: klines.h4Klines,
      ltf5mKlines: klines.ltf5mKlines,
      previousGateState: null,
      retainSnapshots: false,
    });
    results.push({
      symbol,
      report,
      h4BiasAnalysis,
      structurePhaseAnalysis,
      currentPrice: klines.ltf5mKlines[
        klines.ltf5mKlines.length - 1
      ].close,
    });
  }
  return results;
}

async function run(options) {
  options = options || {};
  const reports = Array.isArray(options.reports)
    ? options.reports
    : await loadCurrentReports(options);
  const audit = analyzeReports(reports, options);
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
  return {
    audit,
    body,
    outputPath,
  };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  DIFFERENCE_TYPES,
  analyzeReports,
  auditReport,
  classifyDifference,
  formatAudit,
  loadCurrentReports,
  run,
  summarize,
};
