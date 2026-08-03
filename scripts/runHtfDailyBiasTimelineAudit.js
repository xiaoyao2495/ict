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
const DailyBiasV1 = require(
  '../indicators/ictHtfDailyBiasEngineV1'
);
const WatchlistAnalyst = require(
  '../indicators/ictWatchlistAnalystReport'
);

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-htf-daily-bias-timeline-audit-v1.txt'
);
const DEFAULT_PREFIX_STEP = 50;

function clone(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function eventAvailableIndex(value) {
  if (!value || typeof value !== 'object') return null;
  for (const field of [
    'availableIndex',
    'confirmationIndex',
    'phaseAvailableIndex',
  ]) {
    if (Number.isInteger(value[field])) return value[field];
  }
  return null;
}

function phaseStateOf(value) {
  return value && (
    value.state || value.structurePhase || value.phase
  ) || 'UNDETERMINED';
}

function projectDraw(draw) {
  if (!draw) return null;
  return {
    side: draw.side || null,
    type: draw.type || null,
    price: Number.isFinite(draw.price) ? draw.price : null,
    availableIndex: Number.isInteger(draw.availableIndex)
      ? draw.availableIndex
      : null,
    distancePercent: Number.isFinite(draw.distancePercent)
      ? draw.distancePercent
      : null,
  };
}

function buildTimelineFromAnalyses(
  h4Klines,
  htfBiasAnalysis,
  structurePhaseAnalysis
) {
  const htfStates = htfBiasAnalysis &&
    Array.isArray(htfBiasAnalysis.states)
    ? htfBiasAnalysis.states
    : [];
  const phaseStates = structurePhaseAnalysis &&
    Array.isArray(structurePhaseAnalysis.states)
    ? structurePhaseAnalysis.states
    : [];
  const length = Math.min(
    h4Klines.length,
    htfStates.length,
    phaseStates.length
  );
  const timeline = [];

  for (let index = 0; index < length; index += 1) {
    const htfState = htfStates[index];
    const phase = phaseStates[index];
    const daily = DailyBiasV1.analyze({
      structurePhase: phase,
      structureTimeline: phaseStates.slice(0, index + 1),
      htfBiasState: htfState,
      liquidity: htfState.liquidity,
      dealingRange: htfState.dealingRange,
      currentPrice: htfState.referencePrice,
    });
    timeline.push({
      index,
      timestamp: h4Klines[index].closeTime,
      availableIndex: index,
      structurePhase: daily.structureState,
      structureContext: phase.context || null,
      phaseAvailableIndex:
        Number.isInteger(phase.phaseAvailableIndex)
          ? phase.phaseAvailableIndex
          : null,
      sourceEvent: clone(phase.sourceEvent),
      mssEvent: clone(phase.mssEvent),
      confirmationBos: clone(phase.confirmationBos),
      marketBias: daily.marketBias,
      legacyBias: daily.legacyBias,
      transitionDirection: daily.transitionDirection,
      location: clone(daily.location),
      htfLocationReadiness: daily.htfLocationReadiness,
      drawOnLiquidity: projectDraw(daily.drawOnLiquidity),
      reasons: daily.reasons.slice(),
    });
  }
  return timeline;
}

function buildDailyBiasTimeline(h4Klines) {
  const htfBiasAnalysis = HtfBiasV3.analyze({ h4Klines });
  const structurePhaseAnalysis =
    WatchlistAnalyst.analyzeStructurePhase(h4Klines);
  return {
    htfBiasAnalysis,
    structurePhaseAnalysis,
    timeline: buildTimelineFromAnalyses(
      h4Klines,
      htfBiasAnalysis,
      structurePhaseAnalysis
    ),
  };
}

function comparableState(state) {
  return {
    timestamp: state.timestamp,
    availableIndex: state.availableIndex,
    structurePhase: state.structurePhase,
    structureContext: state.structureContext,
    phaseAvailableIndex: state.phaseAvailableIndex,
    marketBias: state.marketBias,
    legacyBias: state.legacyBias,
    transitionDirection: state.transitionDirection,
    location: state.location,
    htfLocationReadiness: state.htfLocationReadiness,
    drawOnLiquidity: state.drawOnLiquidity,
    reasons: state.reasons,
  };
}

function sameState(left, right) {
  return JSON.stringify(comparableState(left)) ===
    JSON.stringify(comparableState(right));
}

function changeIndexes(timeline) {
  const result = [];
  for (let index = 1; index < timeline.length; index += 1) {
    const previous = timeline[index - 1];
    const current = timeline[index];
    if (
      previous.structurePhase !== current.structurePhase ||
      previous.marketBias !== current.marketBias ||
      previous.transitionDirection !== current.transitionDirection
    ) {
      result.push(index);
    }
  }
  return result;
}

function prefixLengths(timeline, step) {
  if (timeline.length === 0) return [];
  const lengths = new Set([timeline.length]);
  const interval = Number.isInteger(step) && step > 0
    ? step
    : DEFAULT_PREFIX_STEP;
  for (let length = interval; length < timeline.length; length += interval) {
    lengths.add(length);
  }
  for (const index of changeIndexes(timeline)) {
    lengths.add(index + 1);
  }
  return [...lengths]
    .filter((length) => length > 0 && length <= timeline.length)
    .sort((left, right) => left - right);
}

function verifyPrefixInvariance(h4Klines, fullTimeline, options) {
  options = options || {};
  const checkpoints = prefixLengths(
    fullTimeline,
    options.prefixStep
  );
  const mismatches = [];
  for (const length of checkpoints) {
    const prefix = h4Klines.slice(0, length);
    const prefixTimeline = buildDailyBiasTimeline(prefix).timeline;
    for (let index = 0; index < prefixTimeline.length; index += 1) {
      if (!sameState(prefixTimeline[index], fullTimeline[index])) {
        mismatches.push({
          prefixLength: length,
          index,
          prefix: comparableState(prefixTimeline[index]),
          full: comparableState(fullTimeline[index]),
        });
        break;
      }
    }
  }
  return {
    pass: mismatches.length === 0,
    checkpoints,
    checkedPrefixes: checkpoints.length,
    mismatches,
  };
}

function causalReferences(state) {
  return [
    ['PHASE', state.phaseAvailableIndex],
    ['SOURCE_EVENT', eventAvailableIndex(state.sourceEvent)],
    ['MSS_EVENT', eventAvailableIndex(state.mssEvent)],
    ['CONFIRMATION_BOS', eventAvailableIndex(
      state.confirmationBos
    )],
    ['DRAW', state.drawOnLiquidity &&
      state.drawOnLiquidity.availableIndex],
  ];
}

function auditCausality(timeline) {
  const violations = [];
  for (const state of timeline) {
    for (const [source, availableIndex] of causalReferences(state)) {
      if (
        Number.isInteger(availableIndex) &&
        availableIndex > state.availableIndex
      ) {
        violations.push({
          index: state.index,
          source,
          availableIndex,
        });
      }
    }
  }
  return {
    pass: violations.length === 0,
    violations,
  };
}

function latestTimelineIndexAtOrBefore(timeline, timestamp) {
  let low = 0;
  let high = timeline.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timeline[middle].timestamp <= timestamp) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function mapFiveMinuteBars(timeline, ltf5mKlines) {
  const mappings = [];
  const violations = [];
  for (let index = 0; index < ltf5mKlines.length; index += 1) {
    const ltf = ltf5mKlines[index];
    const h4Index = latestTimelineIndexAtOrBefore(
      timeline,
      ltf.closeTime
    );
    const h4 = h4Index >= 0 ? timeline[h4Index] : null;
    const next = h4Index + 1 < timeline.length
      ? timeline[h4Index + 1]
      : null;
    const valid = !h4 || (
      h4.timestamp <= ltf.closeTime &&
      (!next || next.timestamp > ltf.closeTime)
    );
    if (!valid) {
      violations.push({
        ltfIndex: index,
        ltfTimestamp: ltf.closeTime,
        mappedH4Index: h4Index,
      });
    }
    mappings.push({
      ltfIndex: index,
      ltfTimestamp: ltf.closeTime,
      h4Index: h4 ? h4.index : null,
      h4Timestamp: h4 ? h4.timestamp : null,
      marketBias: h4 ? h4.marketBias : null,
      transitionDirection: h4
        ? h4.transitionDirection
        : null,
    });
  }
  return {
    pass: violations.length === 0,
    mappings,
    mappedBars: mappings.filter(
      (mapping) => mapping.h4Index !== null
    ).length,
    unmappedBars: mappings.filter(
      (mapping) => mapping.h4Index === null
    ).length,
    violations,
  };
}

function auditTransitionSemantics(timeline) {
  const transitionStates = timeline.filter(
    (state) => state.transitionDirection !== null
  );
  const violations = transitionStates.filter((state) => (
    state.marketBias !== 'NEUTRAL' ||
    (
      state.structurePhase !== 'BULLISH_MSS' &&
      state.structurePhase !== 'BEARISH_MSS' &&
      state.structureContext !== 'POST_MSS'
    )
  ));
  return {
    pass: violations.length === 0,
    transitionStates: transitionStates.length,
    violations: violations.map(comparableState),
  };
}

function phaseDirection(state) {
  if (state.structurePhase.indexOf('BULLISH_') === 0) {
    return 'BULLISH';
  }
  if (state.structurePhase.indexOf('BEARISH_') === 0) {
    return 'BEARISH';
  }
  return null;
}

function establishedPhase(state) {
  return (
    state.structurePhase.endsWith('_CONTINUATION') ||
    state.structurePhase.endsWith('_CONFIRMED') ||
    (
      state.structurePhase.endsWith('_PULLBACK') &&
      state.structureContext === 'CONTINUATION'
    )
  );
}

function auditDirectionReadiness(timeline) {
  const violations = timeline.filter((state) => (
    establishedPhase(state) &&
    state.marketBias !== phaseDirection(state)
  ));
  const directionalWaitStates = timeline.filter((state) => (
    (state.marketBias === 'BULLISH' ||
      state.marketBias === 'BEARISH') &&
    state.htfLocationReadiness === 'WAIT'
  ));
  return {
    pass: violations.length === 0,
    directionalWaitStates: directionalWaitStates.length,
    violations: violations.map(comparableState),
  };
}

function timelineChanges(timeline) {
  if (timeline.length === 0) return [];
  const result = [timeline[0]];
  for (const index of changeIndexes(timeline)) {
    result.push(timeline[index]);
  }
  return result;
}

function auditSymbol(value, options) {
  options = options || {};
  const h4Klines = value.h4Klines || [];
  const ltf5mKlines = value.ltf5mKlines || [];
  const analysis = buildDailyBiasTimeline(h4Klines);
  const timeline = analysis.timeline;
  const prefix = verifyPrefixInvariance(
    h4Klines,
    timeline,
    options
  );
  const causality = auditCausality(timeline);
  const ltfMapping = mapFiveMinuteBars(timeline, ltf5mKlines);
  const transition = auditTransitionSemantics(timeline);
  const directionReadiness = auditDirectionReadiness(timeline);
  return {
    symbol: value.symbol || 'UNKNOWN',
    h4Bars: h4Klines.length,
    ltf5mBars: ltf5mKlines.length,
    timelineStates: timeline.length,
    changes: timelineChanges(timeline),
    prefix,
    causality,
    ltfMapping,
    transition,
    directionReadiness,
    pass: [
      prefix,
      causality,
      ltfMapping,
      transition,
      directionReadiness,
    ].every((audit) => audit.pass),
  };
}

function summarize(results) {
  return {
    symbols: results.length,
    passed: results.filter((result) => result.pass).length,
    failed: results.filter((result) => !result.pass).length,
    timelineStates: results.reduce(
      (total, result) => total + result.timelineStates,
      0
    ),
    prefixChecks: results.reduce(
      (total, result) => total + result.prefix.checkedPrefixes,
      0
    ),
    transitionStates: results.reduce(
      (total, result) =>
        total + result.transition.transitionStates,
      0
    ),
    directionalWaitStates: results.reduce(
      (total, result) =>
        total + result.directionReadiness.directionalWaitStates,
      0
    ),
  };
}

function analyzeInputs(values, options) {
  const source = Array.isArray(values) ? values : [];
  const results = source.map(
    (value) => auditSymbol(value, options)
  );
  return {
    protocol: 'ICT_HTF_DAILY_BIAS_TIMELINE_AUDIT_V1',
    generatedAt: new Date(
      options && Number.isFinite(options.currentTime)
        ? options.currentTime
        : Date.now()
    ).toISOString(),
    productionBehaviorModified: false,
    results,
    summary: summarize(results),
    pass: results.every((result) => result.pass),
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

function formatState(state) {
  const draw = state.drawOnLiquidity;
  return [
    new Date(state.timestamp).toISOString(),
    'index=' + state.index,
    'availableIndex=' + state.availableIndex,
    'phase=' + state.structurePhase,
    'context=' + valueText(state.structureContext),
    'marketBias=' + state.marketBias,
    'legacyBias=' + valueText(state.legacyBias),
    'transition=' + valueText(state.transitionDirection),
    'location=' + state.location.state,
    'relation=' + state.location.relationToRange,
    'readiness=' + state.htfLocationReadiness,
    'draw=' + (
      draw
        ? draw.side + '/' + draw.type + '/' +
          numberText(draw.price)
        : 'NONE'
    ),
  ].join(' | ');
}

function formatAudit(audit) {
  const lines = [
    'ICT HTF Daily Bias Timeline Audit V1',
    '',
    'Generated At：' + audit.generatedAt,
    'Production Behavior Modified：NO',
    'Overall：' + (audit.pass ? 'PASS' : 'FAIL'),
    '',
    'Summary',
    '',
    'Symbols：' + audit.summary.symbols,
    'Passed：' + audit.summary.passed,
    'Failed：' + audit.summary.failed,
    'Timeline States：' + audit.summary.timelineStates,
    'Prefix Checks：' + audit.summary.prefixChecks,
    'Transition States：' + audit.summary.transitionStates,
    'Directional WAIT States：' +
      audit.summary.directionalWaitStates,
  ];
  for (const result of audit.results) {
    lines.push(
      '',
      '================================',
      '',
      'Symbol：' + result.symbol,
      'Result：' + (result.pass ? 'PASS' : 'FAIL'),
      '4H Bars：' + result.h4Bars,
      '5m Bars：' + result.ltf5mBars,
      'Timeline States：' + result.timelineStates,
      'Prefix Invariance：' +
        (result.prefix.pass ? 'PASS' : 'FAIL'),
      'Prefix Checkpoints：' +
        result.prefix.checkedPrefixes,
      'Prefix Mismatches：' +
        result.prefix.mismatches.length,
      'AvailableIndex Causality：' +
        (result.causality.pass ? 'PASS' : 'FAIL'),
      'Causality Violations：' +
        result.causality.violations.length,
      '5m Mapping：' +
        (result.ltfMapping.pass ? 'PASS' : 'FAIL'),
      '5m Mapped Bars：' + result.ltfMapping.mappedBars,
      '5m Unmapped Bars：' + result.ltfMapping.unmappedBars,
      '5m Mapping Violations：' +
        result.ltfMapping.violations.length,
      'HTF Transition Semantics：' +
        (result.transition.pass ? 'PASS' : 'FAIL'),
      'Transition States：' +
        result.transition.transitionStates,
      'Direction + Readiness Separation：' +
        (result.directionReadiness.pass ? 'PASS' : 'FAIL'),
      'Directional WAIT States：' +
        result.directionReadiness.directionalWaitStates,
      '',
      'Timeline Changes'
    );
    for (const state of result.changes) {
      lines.push(formatState(state));
    }
  }
  return lines.join('\n') + '\n';
}

async function loadCurrentInputs(options) {
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
    const values = await Promise.all([
      WatchlistRunner.getKline(symbol, '4h', {
        currentTime,
        limit: options.limit,
        marketData,
      }),
      WatchlistRunner.getKline(symbol, '5m', {
        currentTime,
        limit: options.limit,
        marketData,
      }),
    ]);
    results.push({
      symbol,
      h4Klines: values[0],
      ltf5mKlines: values[1],
    });
  }
  return results;
}

async function run(options) {
  options = options || {};
  const values = Array.isArray(options.inputs)
    ? options.inputs
    : await loadCurrentInputs(options);
  const audit = analyzeInputs(values, options);
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
  DEFAULT_PREFIX_STEP,
  analyzeInputs,
  auditCausality,
  auditDirectionReadiness,
  auditSymbol,
  auditTransitionSemantics,
  buildDailyBiasTimeline,
  buildTimelineFromAnalyses,
  changeIndexes,
  comparableState,
  formatAudit,
  latestTimelineIndexAtOrBefore,
  loadCurrentInputs,
  mapFiveMinuteBars,
  prefixLengths,
  run,
  sameState,
  summarize,
  timelineChanges,
  verifyPrefixInvariance,
};
