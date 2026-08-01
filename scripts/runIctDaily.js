'use strict';

var GoldenCasePipeline = require(
  './runGoldenCaseDailyPipeline'
);
var LifecycleResearch = require(
  './generateGoldenCaseLifecycleResearch'
);
var ResearchDashboard = require(
  './generateIctResearchDashboard'
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
    throw new Error('A valid ICT daily run time is required.');
  }
  return timestamp;
}

function invoke(runner, method, options) {
  if (typeof runner === 'function') return runner(options);
  if (runner && typeof runner[method] === 'function') {
    return runner[method](options);
  }
  throw new Error('Daily step does not expose ' + method + '().');
}

function executeStep(name, callback) {
  return Promise.resolve().then(callback).then(function (value) {
    return {
      name: name,
      status: 'SUCCESS',
      value: value,
      error: null,
    };
  }).catch(function (error) {
    return {
      name: name,
      status: 'FAILED',
      value: null,
      error: error,
    };
  });
}

function pipelineOptions(options, currentTime) {
  var result = copyObject(options.pipelineOptions);
  setDefault(result, 'currentTime', currentTime);
  setDefault(result, 'casesDirectory', options.casesDirectory);
  setDefault(result, 'lifecycleFilePath', options.lifecycleFilePath);
  setDefault(result, 'outcomeFilePath', options.outcomeFilePath);
  setDefault(
    result,
    'statisticsOutputPath',
    options.statisticsOutputPath
  );
  setDefault(
    result,
    'researchOutputPath',
    options.goldenCaseResearchOutputPath
  );
  if (typeof result.output !== 'function') {
    result.output = function () {};
  }
  return result;
}

function lifecycleResearchOptions(options) {
  var result = copyObject(options.lifecycleResearchOptions);
  setDefault(result, 'casesDirectory', options.casesDirectory);
  setDefault(result, 'lifecycleFilePath', options.lifecycleFilePath);
  setDefault(
    result,
    'outputPath',
    options.lifecycleResearchOutputPath
  );
  return result;
}

function dashboardOptions(options) {
  var result = copyObject(options.dashboardOptions);
  setDefault(result, 'casesDirectory', options.casesDirectory);
  setDefault(result, 'lifecycleFilePath', options.lifecycleFilePath);
  setDefault(result, 'outputPath', options.dashboardOutputPath);
  return result;
}

function errorText(step) {
  if (!step || !step.error) return 'Unknown error';
  return step.error.message || String(step.error);
}

function formatSummary(result) {
  var labels = {
    goldenCasePipeline: 'Golden Case Pipeline',
    lifecycleResearch: 'Lifecycle Research',
    researchDashboard: 'Research Dashboard',
  };
  var order = [
    'goldenCasePipeline',
    'lifecycleResearch',
    'researchDashboard',
  ];
  var lines = [
    '================================',
    'ICT Daily Run',
    BeijingTime.formatBeijingTime(result.currentTime),
    '================================',
    '',
  ];
  order.forEach(function (key) {
    var step = result.steps[key];
    lines.push(labels[key] + ':');
    lines.push(step.status);
    if (step.status === 'FAILED') {
      lines.push('Error: ' + errorText(step));
    }
    lines.push('');
  });
  lines.push(
    'Summary',
    '',
    'Succeeded: ' + result.succeeded,
    'Failed: ' + result.failed,
    '================================'
  );
  return lines.join('\n');
}

function run(options) {
  options = options || {};
  var currentTime = normalizeTime(options.currentTime);
  var output = typeof options.output === 'function'
    ? options.output
    : console.log;
  var pipelineRunner = options.pipelineRunner ||
    GoldenCasePipeline;
  var lifecycleResearchRunner =
    options.lifecycleResearchRunner || LifecycleResearch;
  var dashboardRunner = options.dashboardRunner ||
    ResearchDashboard;
  var steps = {};

  return executeStep('goldenCasePipeline', function () {
    return invoke(
      pipelineRunner,
      'run',
      pipelineOptions(options, currentTime)
    );
  }).then(function (step) {
    steps.goldenCasePipeline = step;
    return executeStep('lifecycleResearch', function () {
      return invoke(
        lifecycleResearchRunner,
        'generateGoldenCaseLifecycleResearch',
        lifecycleResearchOptions(options)
      );
    });
  }).then(function (step) {
    steps.lifecycleResearch = step;
    return executeStep('researchDashboard', function () {
      return invoke(
        dashboardRunner,
        'generateIctResearchDashboard',
        dashboardOptions(options)
      );
    });
  }).then(function (step) {
    var keys;
    var result;
    steps.researchDashboard = step;
    keys = Object.keys(steps);
    result = {
      currentTime: currentTime,
      steps: steps,
      succeeded: keys.filter(function (key) {
        return steps[key].status === 'SUCCESS';
      }).length,
      failed: keys.filter(function (key) {
        return steps[key].status === 'FAILED';
      }).length,
    };
    result.message = formatSummary(result);
    output(result.message);
    return result;
  });
}

if (require.main === module) {
  run().then(function (result) {
    if (result.failed > 0) process.exitCode = 1;
  }).catch(function (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  dashboardOptions: dashboardOptions,
  executeStep: executeStep,
  formatSummary: formatSummary,
  invoke: invoke,
  lifecycleResearchOptions: lifecycleResearchOptions,
  normalizeTime: normalizeTime,
  pipelineOptions: pipelineOptions,
  run: run,
};
