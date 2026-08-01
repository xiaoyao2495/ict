'use strict';

var fs = require('fs');
var path = require('path');
var LifecycleRecorder = require(
  '../history/ictOpportunityLifecycleRecorder'
);
var Analyzer = require(
  '../history/ictGoldenCaseLifecycleResearchAnalyzer'
);
var Formatter = require(
  '../formatters/ictGoldenCaseLifecycleResearchFormatter'
);

var PROJECT_ROOT = path.resolve(__dirname, '..');
var DEFAULT_LIFECYCLE_PATH =
  LifecycleRecorder.DEFAULT_LIFECYCLE_PATH;
var DEFAULT_CASES_DIRECTORY = path.join(
  PROJECT_ROOT,
  'reports',
  'cases'
);
var DEFAULT_OUTPUT_PATH = path.join(
  PROJECT_ROOT,
  'reports',
  'golden-case-lifecycle-research.txt'
);

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
    var jsonFiles = files.filter(function (fileName) {
      return /\.json$/i.test(fileName);
    }).sort();
    return Promise.all(jsonFiles.map(function (fileName) {
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

function generateGoldenCaseLifecycleResearch(options) {
  options = options || {};
  var lifecycleFilePath = path.resolve(
    options.lifecycleFilePath || DEFAULT_LIFECYCLE_PATH
  );
  var casesDirectory = path.resolve(
    options.casesDirectory || DEFAULT_CASES_DIRECTORY
  );
  var outputPath = path.resolve(
    options.outputPath || DEFAULT_OUTPUT_PATH
  );
  var research;
  var text;

  return Promise.all([
    readJson(lifecycleFilePath, null),
    readCases(casesDirectory),
  ]).then(function (inputs) {
    research = Analyzer.analyze({
      lifecycle: inputs[0],
      cases: inputs[1],
    });
    text = Formatter.format(research);
    return ensureDirectory(path.dirname(outputPath));
  }).then(function () {
    return writeFile(outputPath, text);
  }).then(function () {
    return {
      lifecycleFilePath: lifecycleFilePath,
      casesDirectory: casesDirectory,
      outputPath: outputPath,
      research: research,
      text: text,
    };
  });
}

if (require.main === module) {
  generateGoldenCaseLifecycleResearch().then(function (result) {
    console.log(result.text);
    console.log('Report written to: ' + result.outputPath);
  }).catch(function (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_CASES_DIRECTORY: DEFAULT_CASES_DIRECTORY,
  DEFAULT_LIFECYCLE_PATH: DEFAULT_LIFECYCLE_PATH,
  DEFAULT_OUTPUT_PATH: DEFAULT_OUTPUT_PATH,
  generateGoldenCaseLifecycleResearch:
    generateGoldenCaseLifecycleResearch,
  generateGoldenCaseLifecycleResearchReport:
    generateGoldenCaseLifecycleResearch,
  readCases: readCases,
  readJson: readJson,
};
