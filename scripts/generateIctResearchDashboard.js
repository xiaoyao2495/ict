'use strict';

var fs = require('fs');
var path = require('path');
var GoldenCaseStatistics = require(
  '../history/ictGoldenCaseStatisticsAnalyzer'
);
var GoldenCaseResearch = require(
  '../history/ictGoldenCaseResearchAggregator'
);
var LifecycleResearch = require(
  '../history/ictGoldenCaseLifecycleResearchAnalyzer'
);
var ReviewFeedback = require(
  '../history/ictGoldenCaseReviewFeedbackAnalyzer'
);
var DashboardAnalyzer = require(
  '../history/ictResearchDashboardAnalyzer'
);
var DashboardFormatter = require(
  '../formatters/ictResearchDashboardFormatter'
);
var LifecycleRecorder = require(
  '../history/ictOpportunityLifecycleRecorder'
);

var PROJECT_ROOT = path.resolve(__dirname, '..');
var DEFAULT_CASES_DIRECTORY = path.join(
  PROJECT_ROOT,
  'reports',
  'cases'
);
var DEFAULT_LIFECYCLE_PATH =
  LifecycleRecorder.DEFAULT_LIFECYCLE_PATH;
var DEFAULT_OUTPUT_PATH = path.join(
  PROJECT_ROOT,
  'reports',
  'ict-research-dashboard.txt'
);
var INPUT_KEYS = [
  'goldenCaseStatistics',
  'goldenCaseResearch',
  'lifecycleResearch',
  'reviewFeedback',
];

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function readJson(filePath, fallback) {
  return new Promise(function (resolve, reject) {
    fs.readFile(filePath, 'utf8', function (error, content) {
      if (error && error.code === 'ENOENT') {
        resolve(fallback);
        return;
      }
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(content));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

function readDirectory(directory) {
  return new Promise(function (resolve, reject) {
    fs.readdir(directory, function (error, files) {
      if (error && error.code === 'ENOENT') {
        resolve([]);
        return;
      }
      if (error) reject(error);
      else resolve(files);
    });
  });
}

function readCases(directory) {
  return readDirectory(directory).then(function (files) {
    return Promise.all(files.filter(function (fileName) {
      return /\.json$/i.test(fileName);
    }).sort().map(function (fileName) {
      return readJson(path.join(directory, fileName), {});
    }));
  });
}

function ensureDirectory(directory) {
  return new Promise(function (resolve, reject) {
    fs.mkdir(directory, { recursive: true }, function (error) {
      if (error) reject(error);
      else resolve();
    });
  });
}

function writeFile(filePath, content) {
  return new Promise(function (resolve, reject) {
    fs.writeFile(filePath, content, 'utf8', function (error) {
      if (error) reject(error);
      else resolve();
    });
  });
}

function providedInputs(options) {
  var source = isObject(options.inputs) ? options.inputs : options;
  var provided = {};
  var hasAny = false;
  INPUT_KEYS.forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      provided[key] = source[key];
      hasAny = true;
    }
  });
  return hasAny ? provided : null;
}

function analyzeSources(cases, lifecycle) {
  return {
    goldenCaseStatistics: GoldenCaseStatistics.analyze(cases),
    goldenCaseResearch: GoldenCaseResearch.analyze(cases),
    lifecycleResearch: LifecycleResearch.analyze({
      lifecycle: lifecycle,
      cases: cases,
    }),
    reviewFeedback: ReviewFeedback.analyze(cases),
  };
}

function loadAnalyzedInputs(options) {
  var direct = providedInputs(options);
  var casesDirectory;
  var lifecycleFilePath;
  if (direct) return Promise.resolve(direct);
  casesDirectory = path.resolve(
    options.casesDirectory || DEFAULT_CASES_DIRECTORY
  );
  lifecycleFilePath = path.resolve(
    options.lifecycleFilePath || DEFAULT_LIFECYCLE_PATH
  );
  return Promise.all([
    readCases(casesDirectory),
    readJson(lifecycleFilePath, null),
  ]).then(function (values) {
    return analyzeSources(values[0], values[1]);
  });
}

function generateIctResearchDashboard(options) {
  options = options || {};
  var outputPath = path.resolve(
    options.outputPath || DEFAULT_OUTPUT_PATH
  );
  var inputs;
  var dashboard;
  var text;
  return loadAnalyzedInputs(options).then(function (loaded) {
    inputs = loaded;
    dashboard = DashboardAnalyzer.analyze(inputs);
    text = DashboardFormatter.format(dashboard);
    return ensureDirectory(path.dirname(outputPath));
  }).then(function () {
    return writeFile(outputPath, text);
  }).then(function () {
    return {
      outputPath: outputPath,
      inputs: inputs,
      dashboard: dashboard,
      text: text,
    };
  });
}

if (require.main === module) {
  generateIctResearchDashboard().then(function (result) {
    console.log(result.text);
    console.log('Dashboard written to: ' + result.outputPath);
  }).catch(function (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_CASES_DIRECTORY: DEFAULT_CASES_DIRECTORY,
  DEFAULT_LIFECYCLE_PATH: DEFAULT_LIFECYCLE_PATH,
  DEFAULT_OUTPUT_PATH: DEFAULT_OUTPUT_PATH,
  analyzeSources: analyzeSources,
  generateIctResearchDashboard: generateIctResearchDashboard,
  loadAnalyzedInputs: loadAnalyzedInputs,
  providedInputs: providedInputs,
  readCases: readCases,
  readJson: readJson,
};
