'use strict';

var fs = require('fs');
var path = require('path');
var Analyzer = require(
  '../history/ictGoldenCaseStatisticsAnalyzer'
);
var Formatter = require(
  '../formatters/ictGoldenCaseStatisticsFormatter'
);

var PROJECT_ROOT = path.resolve(__dirname, '..');
var DEFAULT_INPUT_DIRECTORY = path.join(
  PROJECT_ROOT,
  'reports',
  'cases'
);
var DEFAULT_OUTPUT_PATH = path.join(
  PROJECT_ROOT,
  'reports',
  'golden-case-statistics.txt'
);

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

function readFile(filePath) {
  return new Promise(function (resolve, reject) {
    fs.readFile(filePath, 'utf8', function (error, content) {
      if (error) reject(error);
      else resolve(content);
    });
  });
}

function readCases(inputDirectory) {
  return readDirectory(inputDirectory).then(function (files) {
    var jsonFiles = files.filter(function (fileName) {
      return /\.json$/i.test(fileName);
    }).sort();
    return Promise.all(jsonFiles.map(function (fileName) {
      var filePath = path.join(inputDirectory, fileName);
      return readFile(filePath).then(function (content) {
        return JSON.parse(content);
      });
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

function generateGoldenCaseStatistics(options) {
  options = options || {};
  var inputDirectory = path.resolve(
    options.inputDirectory || DEFAULT_INPUT_DIRECTORY
  );
  var outputPath = path.resolve(
    options.outputPath || DEFAULT_OUTPUT_PATH
  );
  var statistics;
  var text;

  return readCases(inputDirectory).then(function (cases) {
    statistics = Analyzer.analyze(cases);
    text = Formatter.format(statistics);
    return ensureDirectory(path.dirname(outputPath));
  }).then(function () {
    return writeFile(outputPath, text);
  }).then(function () {
    return {
      inputDirectory: inputDirectory,
      outputPath: outputPath,
      statistics: statistics,
      text: text,
    };
  });
}

if (require.main === module) {
  generateGoldenCaseStatistics().then(function (result) {
    console.log(result.text);
    console.log('Report written to: ' + result.outputPath);
  }).catch(function (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_INPUT_DIRECTORY: DEFAULT_INPUT_DIRECTORY,
  DEFAULT_OUTPUT_PATH: DEFAULT_OUTPUT_PATH,
  generateGoldenCaseStatistics:
    generateGoldenCaseStatistics,
  readCases: readCases,
};
