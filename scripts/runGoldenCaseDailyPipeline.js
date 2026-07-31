'use strict';

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

function captureOptions(options, currentTime) {
  var result = copyObject(options.captureOptions);
  setDefault(result, 'currentTime', currentTime);
  setDefault(result, 'casesDirectory', options.casesDirectory);
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
  var captureRunner = options.captureRunner ||
    AutoCaptureRunner;
  var outcomeRunner = options.outcomeRunner || OutcomeRunner;
  var statisticsRunner = options.statisticsRunner ||
    StatisticsRunner;
  var researchRunner = options.researchRunner ||
    ResearchRunner;
  var steps = {};

  return executeStep(function () {
    return invoke(
      captureRunner,
      'run',
      captureOptions(options, currentTime)
    );
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
  captureLines: captureLines,
  executeStep: executeStep,
  formatResult: formatResult,
  generationLines: generationLines,
  invoke: invoke,
  normalizeTime: normalizeTime,
  outcomeLines: outcomeLines,
  run: run,
};
