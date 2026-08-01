'use strict';

var WatchlistAnalystRunner = require('./runWatchlistAnalyst');
var LifecycleRecorder = require(
  '../history/ictOpportunityLifecycleRecorder'
);
var AutoCaptureRunner = require('./runGoldenCaseAutoCapture');
var OutcomeRunner = require('./updateGoldenCaseOutcome');
var StatisticsRunner = require(
  './generateGoldenCaseStatistics'
);
var ResearchRunner = require(
  './generateGoldenCaseResearchReport'
);
var BeijingTime = require('../formatters/beijingTime');

function copyObject(source) {
  var target = {};
  var key;
  source = source || {};
  for (key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      target[key] = source[key];
    }
  }
  return target;
}

function setDefault(target, key, value) {
  if (target[key] === undefined && value !== undefined) {
    target[key] = value;
  }
}

function normalizeTime(value) {
  var timestamp;
  if (value === undefined || value === null) return Date.now();
  if (value instanceof Date) timestamp = value.getTime();
  else if (typeof value === 'string') timestamp = Date.parse(value);
  else timestamp = value;
  if (typeof timestamp !== 'number' || !isFinite(timestamp)) {
    throw new Error('A valid pipeline time is required.');
  }
  return timestamp;
}

function invoke(runner, method, options) {
  if (typeof runner === 'function') {
    return runner(options);
  }
  if (runner && typeof runner[method] === 'function') {
    return runner[method](options);
  }
  throw new Error('Pipeline step does not expose ' + method + '().');
}

function executeStep(callback) {
  return Promise.resolve().then(callback).then(function (value) {
    return {
      status: 'SUCCESS',
      value: value,
      error: null,
    };
  }).catch(function (error) {
    return {
      status: 'FAILED',
      value: null,
      error: error,
    };
  });
}

function errorText(step) {
  if (!step || !step.error) return '未知错误';
  return step.error.message || String(step.error);
}

function watchlistLines(step) {
  if (step.status === 'FAILED') {
    return [
      'Watchlist Analyst:',
      '读取失败（' + errorText(step) + '）',
    ];
  }
  return [
    'Watchlist Analyst:',
    '读取交易对数量：' + Number(
      step.value && Array.isArray(step.value.results)
        ? step.value.results.length
        : 0
    ),
  ];
}

function lifecycleLines(step) {
  if (step.status === 'FAILED') {
    return [
      'Opportunity Lifecycle:',
      '记录失败（' + errorText(step) + '）',
    ];
  }
  return [
    'Opportunity Lifecycle:',
    '新增生命周期事件：' + Number(
      step.value && Array.isArray(step.value.changes)
        ? step.value.changes.length
        : 0
    ),
  ];
}

function captureLines(step) {
  if (step.status === 'FAILED') {
    return [
      'Capture:',
      '新增案例数量：失败（' + errorText(step) + '）',
    ];
  }
  return [
    'Capture:',
    '新增案例数量：' +
      Number(step.value && step.value.capturedCount || 0),
  ];
}

function outcomeLines(step) {
  if (step.status === 'FAILED') {
    return [
      'Outcome Update:',
      '更新案例数量：失败（' + errorText(step) + '）',
    ];
  }
  return [
    'Outcome Update:',
    '更新案例数量：' +
      Number(step.value && step.value.updatedCases || 0),
  ];
}

function generationLines(label, step) {
  return [
    label + ':',
    step.status === 'SUCCESS'
      ? '生成成功'
      : '生成失败（' + errorText(step) + '）',
  ];
}

function formatResult(result) {
  var steps = result.steps;
  var lines = [
    '========================',
    '',
    'Golden Case Daily Pipeline',
    '',
    '时间:',
    '北京时间 ' + BeijingTime.formatBeijingTime(
      result.currentTime
    ),
    '',
  ];
  if (steps.watchlistReport) {
    lines = lines.concat(watchlistLines(steps.watchlistReport));
    lines.push('');
  }
  if (steps.lifecycleRecorder) {
    lines = lines.concat(lifecycleLines(steps.lifecycleRecorder));
    lines.push('');
  }
  lines = lines.concat(captureLines(steps.capture));
  lines.push('');
  lines = lines.concat(outcomeLines(steps.outcomeUpdate));
  lines.push('');
  lines = lines.concat(generationLines(
    'Statistics',
    steps.statistics
  ));
  lines.push('');
  lines = lines.concat(generationLines(
    'Research Report',
    steps.researchReport
  ));
  lines.push('', '========================');
  return lines.join('\n');
}

function watchlistOptions(options, currentTime) {
  var result = copyObject(
    options.watchlistOptions || options.captureOptions
  );
  setDefault(result, 'currentTime', currentTime);
  setDefault(result, 'limit', options.limit);
  setDefault(result, 'marketData', options.marketData);
  setDefault(result, 'watchlistPath', options.watchlistPath);
  setDefault(result, 'watchlistLoader', options.watchlistLoader);
  setDefault(
    result,
    'symbolAvailabilityChecker',
    options.symbolAvailabilityChecker
  );
  setDefault(result, 'exchangeInfoApi', options.exchangeInfoApi);
  result.output = function () {};
  return result;
}

function analysisValue(step, currentTime) {
  if (
    step &&
    step.status === 'SUCCESS' &&
    step.value &&
    Array.isArray(step.value.results)
  ) {
    return step.value;
  }
  return {
    currentTime: currentTime,
    results: [],
  };
}

function lifecycleOptions(options, currentTime, analysis) {
  var result = copyObject(options.lifecycleOptions);
  setDefault(result, 'recordedAt', currentTime);
  setDefault(result, 'store', options.lifecycleStore);
  setDefault(
    result,
    'lifecycleFilePath',
    options.lifecycleFilePath
  );
  result.results = analysis.results;
  return result;
}

function captureOptions(options, currentTime, analysis) {
  var result = copyObject(options.captureOptions);
  setDefault(result, 'currentTime', currentTime);
  setDefault(result, 'casesDirectory', options.casesDirectory);
  result.watchlistAnalyst = {
    run: function () {
      return Promise.resolve(analysis);
    },
  };
  result.output = function () {};
  return result;
}

function outcomeOptions(options) {
  var result = copyObject(options.outcomeOptions);
  setDefault(result, 'casesDirectory', options.casesDirectory);
  setDefault(result, 'outcomeFilePath', options.outcomeFilePath);
  setDefault(result, 'matchWindowMs', options.matchWindowMs);
  result.output = function () {};
  return result;
}

function statisticsOptions(options) {
  var result = copyObject(options.statisticsOptions);
  setDefault(result, 'inputDirectory', options.casesDirectory);
  setDefault(result, 'outputPath', options.statisticsOutputPath);
  return result;
}

function researchOptions(options) {
  var result = copyObject(options.researchOptions);
  setDefault(result, 'inputDirectory', options.casesDirectory);
  setDefault(result, 'outputPath', options.researchOutputPath);
  return result;
}

function run(options) {
  options = options || {};
  var currentTime = normalizeTime(options.currentTime);
  var output = typeof options.output === 'function'
    ? options.output
    : console.log;
  var watchlistRunner = options.watchlistRunner ||
    options.watchlistAnalyst ||
    WatchlistAnalystRunner;
  var lifecycleRunner = options.lifecycleRunner ||
    options.lifecycleRecorder ||
    LifecycleRecorder;
  var captureRunner = options.captureRunner ||
    AutoCaptureRunner;
  var outcomeRunner = options.outcomeRunner || OutcomeRunner;
  var statisticsRunner = options.statisticsRunner ||
    StatisticsRunner;
  var researchRunner = options.researchRunner ||
    ResearchRunner;
  var steps = {};
  var analysis;

  return executeStep(function () {
    return invoke(
      watchlistRunner,
      'run',
      watchlistOptions(options, currentTime)
    );
  }).then(function (watchlistReport) {
    steps.watchlistReport = watchlistReport;
    analysis = analysisValue(watchlistReport, currentTime);
    return executeStep(function () {
      return invoke(
        lifecycleRunner,
        'recordResults',
        lifecycleOptions(options, currentTime, analysis)
      );
    });
  }).then(function (lifecycleRecorder) {
    steps.lifecycleRecorder = lifecycleRecorder;
    return executeStep(function () {
      return invoke(
        captureRunner,
        'run',
        captureOptions(options, currentTime, analysis)
      );
    });
  }).then(function (capture) {
    steps.capture = capture;
    return executeStep(function () {
      return invoke(
        outcomeRunner,
        'run',
        outcomeOptions(options)
      );
    });
  }).then(function (outcomeUpdate) {
    steps.outcomeUpdate = outcomeUpdate;
    return executeStep(function () {
      return invoke(
        statisticsRunner,
        'generateGoldenCaseStatistics',
        statisticsOptions(options)
      );
    });
  }).then(function (statistics) {
    steps.statistics = statistics;
    return executeStep(function () {
      return invoke(
        researchRunner,
        'generateGoldenCaseResearchReport',
        researchOptions(options)
      );
    });
  }).then(function (researchReport) {
    var result;
    steps.researchReport = researchReport;
    result = {
      currentTime: currentTime,
      steps: steps,
    };
    result.message = formatResult(result);
    output(result.message);
    return result;
  });
}

if (require.main === module) {
  run().catch(function (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  analysisValue: analysisValue,
  captureLines: captureLines,
  captureOptions: captureOptions,
  executeStep: executeStep,
  formatResult: formatResult,
  generationLines: generationLines,
  invoke: invoke,
  lifecycleLines: lifecycleLines,
  lifecycleOptions: lifecycleOptions,
  normalizeTime: normalizeTime,
  outcomeLines: outcomeLines,
  run: run,
  watchlistLines: watchlistLines,
  watchlistOptions: watchlistOptions,
};
