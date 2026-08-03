'use strict';

const fs = require('fs/promises');
const path = require('path');
const AnalystReport = require(
  '../indicators/ictWatchlistAnalystReport'
);
const GateStateStore = require(
  '../state/ictProductionGateStateStore'
);
const BeijingTime = require('../formatters/beijingTime');

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-production-replay-audit-v1.txt'
);

function clone(value) {
  return value === undefined || value === null
    ? value
    : JSON.parse(JSON.stringify(value));
}

function normalizeKline(value) {
  const source = Array.isArray(value)
    ? {
      openTime: value[0],
      open: value[1],
      high: value[2],
      low: value[3],
      close: value[4],
      volume: value[5],
      closeTime: value[6],
    }
    : value;
  if (!source || typeof source !== 'object') return null;
  const result = {
    openTime: Number(source.openTime),
    open: Number(source.open),
    high: Number(source.high),
    low: Number(source.low),
    close: Number(source.close),
    volume: Number(source.volume || 0),
    closeTime: Number(source.closeTime),
  };
  return Object.values(result).every(Number.isFinite)
    ? result
    : null;
}

function normalizeKlines(values) {
  const byOpenTime = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const kline = normalizeKline(value);
    if (kline) byOpenTime.set(kline.openTime, kline);
  }
  return Array.from(byOpenTime.values()).sort(
    (left, right) => left.openTime - right.openTime
  );
}

function withinRange(timestamp, startTime, endTime) {
  return (
    (!Number.isFinite(startTime) || timestamp >= startTime) &&
    (!Number.isFinite(endTime) || timestamp <= endTime)
  );
}

function progressOf(gate) {
  const value = gate && gate.progress || {};
  return {
    sweepCompleted: value.sweepCompleted === true,
    mssCompleted: value.mssCompleted === true,
    displacementCompleted:
      value.displacementCompleted === true,
    strictConfirmationCompleted:
      value.strictConfirmationCompleted === true,
  };
}

function frameFrom(report, timestamp, counts) {
  const current = report.current || {};
  const gate = current.decisionGate || {};
  return {
    status: 'SUCCESS',
    timestamp,
    availableH4Bars: counts.h4,
    available5mBars: counts.ltf5m,
    htfBias: current.fourHourAnalysis &&
      current.fourHourAnalysis.bias || 'UNAVAILABLE',
    opportunity: clone(current.opportunity || null),
    gateState: gate.state || 'DATA_UNAVAILABLE',
    gateDirection: gate.direction || null,
    activeOpportunity: clone(gate.activeOpportunity || null),
    progress: progressOf(gate),
    blockers: Array.isArray(gate.blockers)
      ? gate.blockers.slice()
      : [],
    reasonCode: gate.reasonCode || null,
    transition: clone(gate.transition || null),
  };
}

async function replay(input) {
  input = input || {};
  const symbol = typeof input.symbol === 'string'
    ? input.symbol.trim().toUpperCase()
    : '';
  if (!symbol) throw new Error('A replay symbol is required.');

  const h4Klines = normalizeKlines(input.h4Klines);
  const ltf5mKlines = normalizeKlines(input.ltf5mKlines);
  if (h4Klines.length === 0 || ltf5mKlines.length === 0) {
    throw new Error('Closed historical 4H and 5m Klines are required.');
  }

  const analystReport = input.analystReport || AnalystReport;
  const gateStateStore = input.gateStateStore ||
    GateStateStore.createMemoryStore();
  const frames = [];
  let h4Count = 0;
  let skippedBeforeH4 = 0;

  for (let index = 0; index < ltf5mKlines.length; index += 1) {
    const currentBar = ltf5mKlines[index];
    const currentTime = currentBar.closeTime + 1;
    while (
      h4Count < h4Klines.length &&
      h4Klines[h4Count].closeTime < currentTime
    ) {
      h4Count += 1;
    }
    if (!withinRange(
      currentBar.closeTime,
      input.startTime,
      input.endTime
    )) {
      continue;
    }
    if (h4Count === 0) {
      skippedBeforeH4 += 1;
      continue;
    }

    const previousGateState =
      await gateStateStore.load(symbol);
    try {
      const report = analystReport.analyze({
        symbol,
        h4Klines: h4Klines.slice(0, h4Count),
        ltf5mKlines: ltf5mKlines.slice(0, index + 1),
        previousGateState: previousGateState || null,
        retainSnapshots: false,
      });
      const gate = report.current &&
        report.current.decisionGate;
      if (!gate || typeof gate.state !== 'string') {
        throw new Error('Replay report has no Decision Gate state.');
      }
      await gateStateStore.save(symbol, gate);
      const frame = frameFrom(report, currentBar.closeTime, {
        h4: h4Count,
        ltf5m: index + 1,
      });
      frames.push(frame);
      if (typeof input.onFrame === 'function') {
        input.onFrame(clone(frame));
      }
    } catch (error) {
      frames.push({
        status: 'FAILED',
        timestamp: currentBar.closeTime,
        availableH4Bars: h4Count,
        available5mBars: index + 1,
        error: error.message,
      });
    }
  }

  return {
    protocol: 'ICT_PRODUCTION_REPLAY_AUDIT_V1',
    symbol,
    source: {
      h4Klines: h4Klines.length,
      ltf5mKlines: ltf5mKlines.length,
      startTime: Number.isFinite(input.startTime)
        ? input.startTime
        : null,
      endTime: Number.isFinite(input.endTime)
        ? input.endTime
        : null,
    },
    usesProductionAnalystReport: analystReport === AnalystReport,
    usesPersistentProductionState: false,
    prefixOnly: true,
    skippedBeforeH4,
    frames,
  };
}

function opportunityText(frame) {
  const opportunity = frame.activeOpportunity || frame.opportunity;
  if (!opportunity) return 'NONE';
  return [
    opportunity.liquidityType || 'UNSPECIFIED',
    Number.isFinite(opportunity.price)
      ? String(opportunity.price)
      : '--',
    opportunity.direction || frame.gateDirection || 'UNDETERMINED',
  ].join(' | ');
}

function progressText(progress) {
  const value = progress || {};
  return [
    'Sweep ' + (value.sweepCompleted ? '✓' : '□'),
    'MSS ' + (value.mssCompleted ? '✓' : '□'),
    'Displacement ' +
      (value.displacementCompleted ? '✓' : '□'),
    'Strict Confirmation ' +
      (value.strictConfirmationCompleted ? '✓' : '□'),
  ].join(' | ');
}

function transitionText(transition) {
  if (!transition) return 'UNAVAILABLE';
  return String(transition.from || 'NONE') + ' → ' +
    String(transition.to || 'UNKNOWN') +
    (transition.changed === true ? '（CHANGED）' : '（UNCHANGED）');
}

function formatTimeline(audit) {
  const lines = [
    'ICT Production Replay Audit V1',
    '',
    'Symbol：' + audit.symbol,
    '4H Klines：' + audit.source.h4Klines,
    '5m Klines：' + audit.source.ltf5mKlines,
    'Replay Frames：' + audit.frames.length,
    'Prefix Only：true',
    'Production State File Used：false',
  ];

  audit.frames.forEach((frame) => {
    lines.push('', '================================', '');
    lines.push(
      '时间：' + BeijingTime.formatBeijingTime(frame.timestamp)
    );
    if (frame.status === 'FAILED') {
      lines.push('状态：FAILED', '错误：' + frame.error);
      return;
    }
    lines.push(
      '4H交易背景：' + frame.htfBias,
      'Opportunity：' + opportunityText(frame),
      'Gate State：' + frame.gateState,
      'Gate Direction：' +
        (frame.gateDirection || 'UNDETERMINED'),
      'Progress：' + progressText(frame.progress),
      'Reason：' + (frame.reasonCode || 'NONE'),
      'Transition：' + transitionText(frame.transition)
    );
  });
  return lines.join('\n') + '\n';
}

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function run(options) {
  options = options || {};
  const h4Klines = options.h4Klines ||
    await loadJson(options.h4Path);
  const ltf5mKlines = options.ltf5mKlines ||
    await loadJson(options.ltf5mPath);
  const audit = await replay({
    ...options,
    h4Klines,
    ltf5mKlines,
  });
  const text = formatTimeline(audit);
  const outputPath = path.resolve(
    options.outputPath || DEFAULT_OUTPUT_PATH
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, text, 'utf8');
  return { ...audit, outputPath, text };
}

if (require.main === module) {
  const symbol = process.argv[2];
  const h4Path = process.argv[3];
  const ltf5mPath = process.argv[4];
  const outputPath = process.argv[5];
  if (!symbol || !h4Path || !ltf5mPath) {
    console.error(
      'Usage: node scripts/runProductionReplayAuditV1.js ' +
      '<symbol> <4h.json> <5m.json> [output.txt]'
    );
    process.exitCode = 1;
  } else {
    run({ symbol, h4Path, ltf5mPath, outputPath })
      .then((result) => console.log(result.outputPath))
      .catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
      });
  }
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  clone,
  formatTimeline,
  frameFrom,
  normalizeKline,
  normalizeKlines,
  progressOf,
  replay,
  run,
  transitionText,
  withinRange,
};
