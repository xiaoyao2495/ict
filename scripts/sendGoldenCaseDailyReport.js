'use strict';

var fs = require('fs');
var path = require('path');
var Pipeline = require('./runGoldenCaseDailyPipeline');
var ResearchGenerator = require(
  './generateGoldenCaseResearchReport'
);
var Reporter = require(
  '../notifications/goldenCaseDingTalkReporter'
);

var DEFAULT_RESEARCH_REPORT_PATH =
  ResearchGenerator.DEFAULT_OUTPUT_PATH || path.resolve(
    __dirname,
    '..',
    'reports',
    'golden-case-research-report.txt'
  );

function copyObject(source) {
  var result = {};
  var key;
  source = source || {};
  for (key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = source[key];
    }
  }
  return result;
}

function readFile(filePath) {
  return new Promise(function (resolve, reject) {
    fs.readFile(filePath, 'utf8', function (error, content) {
      if (error) reject(error);
      else resolve(content);
    });
  });
}

function fallbackResearchText(pipelineResult) {
  var steps = pipelineResult && pipelineResult.steps;
  var step = steps && steps.researchReport;
  var value = step && step.value;
  return value && typeof value.text === 'string'
    ? value.text
    : '';
}

function readResearchReport(filePath, pipelineResult) {
  return readFile(filePath).catch(function () {
    return fallbackResearchText(pipelineResult);
  });
}

function pipelineOptions(options) {
  var result = copyObject(options.pipelineOptions);
  if (
    result.currentTime === undefined &&
    options.currentTime !== undefined
  ) {
    result.currentTime = options.currentTime;
  }
  return result;
}

function run(options) {
  options = options || {};
  var pipelineRunner = options.pipelineRunner || Pipeline;
  var reporter = options.reporter || Reporter;
  var researchReportPath = path.resolve(
    options.researchReportPath ||
      DEFAULT_RESEARCH_REPORT_PATH
  );
  var pipelineResult;

  return Promise.resolve(
    pipelineRunner.run(pipelineOptions(options))
  ).then(function (result) {
    pipelineResult = result;
    return readResearchReport(
      researchReportPath,
      pipelineResult
    );
  }).then(function (researchReportText) {
    return reporter.sendReport({
      currentTime: pipelineResult.currentTime,
      pipelineResult: pipelineResult,
      researchReportText: researchReportText,
      focusSymbols: options.focusSymbols,
      webhookUrl: options.webhookUrl,
      httpClient: options.httpClient,
    });
  }).then(function (delivery) {
    return {
      pipelineResult: pipelineResult,
      delivery: delivery,
      sent: delivery.sent,
      message: delivery.message,
      payload: delivery.payload,
      response: delivery.response,
      error: delivery.error,
    };
  });
}

if (require.main === module) {
  run().then(function (result) {
    if (result.sent) {
      console.log('Golden Case daily report sent.');
      return;
    }
    console.log(
      'Golden Case daily pipeline completed; report not sent: ' +
      result.delivery.reason
    );
    if (result.error) {
      console.error(result.error.message || String(result.error));
    }
  }).catch(function (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_RESEARCH_REPORT_PATH: DEFAULT_RESEARCH_REPORT_PATH,
  fallbackResearchText: fallbackResearchText,
  pipelineOptions: pipelineOptions,
  readResearchReport: readResearchReport,
  run: run,
};
