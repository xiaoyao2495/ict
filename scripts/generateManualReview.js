'use strict';

const fs = require('fs/promises');
const path = require('path');
const WatchlistLoader = require(
  '../config/watchlistLoader'
);
const BeijingTime = require('../formatters/beijingTime');
const HistoryFormatter = require(
  '../formatters/ictOpportunityHistoryFormatter'
);
const OpportunityHistory = require(
  '../history/ictOpportunityHistory'
);
const OutcomeTracker = require(
  '../history/ictOpportunityOutcomeTracker'
);

const DEFAULT_OUTPUT_DIRECTORY = path.resolve(
  __dirname,
  '..',
  'reports',
  'manual-review'
);

function beijingDate(value) {
  const formatted = BeijingTime.formatBeijingTime(value);
  const date = formatted.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('A valid review date is required.');
  }
  return date;
}

function normalizeDate(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsed = Date.parse(trimmed + 'T00:00:00Z');
      if (Number.isFinite(parsed)) return trimmed;
    }
  }
  return beijingDate(
    value === undefined ? Date.now() : value
  );
}

function displayTime(value) {
  return value
    ? BeijingTime.formatBeijingTime(value)
    : '';
}

function displayValue(value) {
  return value === undefined || value === null
    ? ''
    : String(value);
}

function latestWatchZone(record) {
  if (!record) return null;
  const lifecycle = HistoryFormatter.recentLifecycle(
    record
  );
  for (let index = lifecycle.length - 1; index >= 0; index -= 1) {
    if (lifecycle[index].status === 'WATCH_ZONE') {
      return lifecycle[index];
    }
  }
  return null;
}

function selectOutcome(outcomes, symbol, date) {
  return outcomes
    .filter((outcome) => (
      outcome.symbol === symbol &&
      outcome.confirmedAt &&
      beijingDate(outcome.confirmedAt) === date
    ))
    .sort((left, right) => (
      Date.parse(right.confirmedAt) -
      Date.parse(left.confirmedAt)
    ))[0] || null;
}

function failedLabel(outcome) {
  if (!outcome) return '';
  if (outcome.failed === true) return '是';
  if (
    Number.isFinite(outcome.entryNearbyPrice) &&
    Number.isFinite(outcome.riskUnit)
  ) {
    return '否';
  }
  return '';
}

function buildReviewData(options) {
  const record = options.record || null;
  const current = record ? record.current : null;
  const watchZone = latestWatchZone(record);
  const outcome = options.outcome || null;

  return {
    symbol: options.symbol,
    date: options.date,
    h4Bias: current ? current.h4Bias : '',
    structure: '',
    primaryLiquidity:
      current && current.liquidityType
        ? current.liquidityType
        : '',
    opportunityStatus: current ? current.status : '',
    watchZoneTime: watchZone
      ? displayTime(watchZone.changedAt)
      : '',
    liquidityType:
      current && current.liquidityType
        ? current.liquidityType
        : '',
    liquidityPrice:
      current
        ? displayValue(current.liquidityPrice)
        : '',
    sweep: '',
    mss: '',
    displacement: '',
    oneR: outcome ? displayTime(outcome.oneRAt) : '',
    twoR: outcome ? displayTime(outcome.twoRAt) : '',
    threeR: outcome
      ? displayTime(outcome.threeRAt)
      : '',
    failed: failedLabel(outcome),
  };
}

function renderManualReview(data) {
  return [
    '# ICT Manual Review',
    '',
    'Symbol: ' + data.symbol,
    '',
    'Date: ' + data.date,
    '',
    '## 4H HTF Bias',
    '',
    '方向: ' + data.h4Bias,
    '',
    '结构: ' + data.structure,
    '',
    '主要流动性: ' + data.primaryLiquidity,
    '',
    '## Opportunity',
    '',
    '状态: ' + data.opportunityStatus,
    '',
    'WATCH_ZONE时间: ' + data.watchZoneTime,
    '',
    '关注流动性: ' + data.liquidityType,
    '',
    '价格: ' + data.liquidityPrice,
    '',
    '## 5M Confirmation',
    '',
    'Sweep: ' + data.sweep,
    '',
    'MSS: ' + data.mss,
    '',
    'Displacement: ' + data.displacement,
    '',
    '## Outcome',
    '',
    '1R: ' + data.oneR,
    '',
    '2R: ' + data.twoR,
    '',
    '3R: ' + data.threeR,
    '',
    '失败: ' + data.failed,
    '',
    '## 人工复盘',
    '',
    '为什么交易/不交易:',
    '',
    '截图:',
    '',
    '备注:',
    '',
  ].join('\n');
}

async function readJsonOrDefault(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function configuredSymbols(options, history) {
  if (Array.isArray(options.symbols)) {
    return Array.from(new Set(options.symbols.map(
      (symbol, index) => (
        WatchlistLoader.normalizeSymbol(symbol, index)
      )
    )));
  }

  let watchlistSymbols = [];
  try {
    const loader = options.watchlistLoader ||
      WatchlistLoader;
    watchlistSymbols = loader.loadWatchlist(
      options.watchlistPath
    ).symbols.slice();
  } catch (error) {
    watchlistSymbols = [];
  }
  return Array.from(new Set(
    watchlistSymbols.concat(
      Object.keys(history.symbols)
    )
  ));
}

async function generateManualReview(options) {
  options = options || {};
  const historyInput = options.history ||
    await readJsonOrDefault(
      options.historyPath ||
        OpportunityHistory.DEFAULT_HISTORY_PATH,
      OpportunityHistory.emptyHistory()
    );
  const outcomeInput = options.outcomeState ||
    await readJsonOrDefault(
      options.outcomePath ||
        OutcomeTracker.DEFAULT_OUTCOME_PATH,
      OutcomeTracker.emptyOutcomeState()
    );
  const history = OpportunityHistory.normalizeHistory(
    historyInput
  );
  const outcomeState =
    OutcomeTracker.normalizeOutcomeState(outcomeInput);
  const date = normalizeDate(
    options.date === undefined
      ? options.generatedAt
      : options.date
  );
  const symbols = configuredSymbols(options, history);
  const outputDirectory = path.resolve(
    options.outputDirectory ||
      DEFAULT_OUTPUT_DIRECTORY
  );
  const files = [];

  await fs.mkdir(outputDirectory, { recursive: true });
  for (const symbol of symbols) {
    const outcome = selectOutcome(
      outcomeState.outcomes,
      symbol,
      date
    );
    const data = buildReviewData({
      symbol,
      date,
      record: history.symbols[symbol] || null,
      outcome,
    });
    const text = renderManualReview(data);
    const filePath = path.join(
      outputDirectory,
      date + '-' + symbol + '.md'
    );
    let written = true;

    try {
      await fs.writeFile(filePath, text, {
        encoding: 'utf8',
        flag: options.overwrite === true ? 'w' : 'wx',
      });
    } catch (error) {
      if (
        error &&
        error.code === 'EEXIST' &&
        options.overwrite !== true
      ) {
        written = false;
      } else {
        throw error;
      }
    }
    files.push({
      symbol,
      path: filePath,
      written,
      data,
      text,
    });
  }

  return {
    date,
    outputDirectory,
    files,
  };
}

if (require.main === module) {
  generateManualReview()
    .then((result) => {
      for (const file of result.files) {
        console.log(
          (file.written ? 'Created: ' : 'Kept: ') +
          file.path
        );
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_OUTPUT_DIRECTORY,
  beijingDate,
  buildReviewData,
  configuredSymbols,
  displayTime,
  failedLabel,
  generateManualReview,
  latestWatchZone,
  normalizeDate,
  readJsonOrDefault,
  renderManualReview,
  selectOutcome,
};
