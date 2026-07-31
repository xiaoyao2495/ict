'use strict';

var fs = require('fs');
var path = require('path');
var Recorder = require('./ictGoldenCaseRecorder');

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function currentFrom(report) {
  if (!isObject(report)) return {};
  if (isObject(report.current)) return report.current;
  if (isObject(report.report)) return currentFrom(report.report);
  return report;
}

function captureReason(report) {
  var current = currentFrom(report);
  var h4 = isObject(current.fourHourAnalysis)
    ? current.fourHourAnalysis
    : {};
  var opportunity = isObject(current.opportunity)
    ? current.opportunity
    : {};
  var alignment = isObject(current.htfAlignment)
    ? current.htfAlignment
    : {};
  return {
    opportunityStatus: opportunity.status || null,
    htfBias: h4.bias || null,
    alignmentStatus: alignment.status || null,
  };
}

function isEligible(report) {
  var reason = captureReason(report);
  return (
    reason.opportunityStatus === 'WATCH_ZONE' ||
    reason.opportunityStatus === 'CONFIRMING'
  ) && (
    reason.htfBias === 'BULLISH' ||
    reason.htfBias === 'BEARISH'
  ) && reason.alignmentStatus === 'ALIGNED';
}

function normalizeSymbol(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function timestampFor(report, supplied) {
  var current = currentFrom(report);
  var value = supplied;
  var parsed;
  if (value === undefined || value === null) {
    value = current.asOf === undefined
      ? Date.now()
      : current.asOf;
  }
  if (value instanceof Date) parsed = value.getTime();
  else if (typeof value === 'string') parsed = Date.parse(value);
  else parsed = value;
  if (typeof parsed !== 'number' || !isFinite(parsed)) {
    throw new Error('A valid capture timestamp is required.');
  }
  return parsed;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function caseExistsForDay(directory, symbol, timestamp) {
  var date = Recorder.beijingDate(timestamp);
  var pattern = new RegExp(
    '^' + escapeRegExp(date + '-' + symbol) +
    '(?:-.+)?\\.json$',
    'i'
  );
  return readDirectory(directory).then(function (files) {
    return files.some(function (fileName) {
      return pattern.test(fileName);
    });
  });
}

function recorderFunction(recorder) {
  if (typeof recorder === 'function') return recorder;
  if (recorder && typeof recorder.recordCase === 'function') {
    return recorder.recordCase.bind(recorder);
  }
  throw new Error('A Golden Case recorder is required.');
}

function skipped(symbol, reason) {
  return {
    symbol: symbol,
    status: 'SKIPPED',
    reason: reason,
  };
}

function captureOne(options) {
  options = options || {};
  var report = options.report;
  var symbol = normalizeSymbol(
    options.symbol || (report && report.symbol)
  );
  var casesDirectory = path.resolve(
    options.casesDirectory ||
      Recorder.DEFAULT_CASES_DIRECTORY
  );
  var timestamp;
  var reason;
  var record;

  if (!symbol || !isObject(report)) {
    return Promise.resolve(skipped(
      symbol || 'UNKNOWN',
      'REPORT_UNAVAILABLE'
    ));
  }
  if (!isEligible(report)) {
    return Promise.resolve(skipped(symbol, 'NOT_ELIGIBLE'));
  }
  timestamp = timestampFor(report, options.timestamp);
  reason = captureReason(report);
  record = recorderFunction(options.recorder || Recorder);

  return caseExistsForDay(
    casesDirectory,
    symbol,
    timestamp
  ).then(function (exists) {
    if (exists) return skipped(symbol, 'ALREADY_CAPTURED_TODAY');
    return Promise.resolve(record({
      symbol: symbol,
      report: report,
      timestamp: timestamp,
      outputDirectory: casesDirectory,
      captureReason: reason,
      skipIfExists: true,
    })).then(function (saved) {
      if (saved && saved.saved === false) {
        return skipped(symbol, 'ALREADY_CAPTURED_TODAY');
      }
      return {
        symbol: symbol,
        status: 'CAPTURED',
        reason: reason,
        saved: saved,
      };
    });
  });
}

function normalizeEntries(options) {
  var input = Array.isArray(options.results)
    ? options.results
    : (
      Array.isArray(options.reports)
        ? options.reports
        : []
    );
  return input.map(function (item) {
    if (isObject(item) && isObject(item.report)) {
      return {
        symbol: item.symbol || item.report.symbol,
        report: item.status && item.status !== 'SUCCESS'
          ? null
          : item.report,
      };
    }
    return {
      symbol: item && item.symbol,
      report: item,
    };
  });
}

function captureReports(options) {
  options = options || {};
  var entries = normalizeEntries(options);
  var results = [];
  var chain = Promise.resolve();

  entries.forEach(function (entry) {
    chain = chain.then(function () {
      return captureOne({
        symbol: entry.symbol,
        report: entry.report,
        timestamp: options.timestamp,
        casesDirectory: options.casesDirectory,
        recorder: options.recorder,
      }).catch(function (error) {
        return {
          symbol: normalizeSymbol(entry.symbol) || 'UNKNOWN',
          status: 'FAILED',
          reason: 'SAVE_FAILED',
          error: error,
        };
      });
    }).then(function (result) {
      results.push(result);
    });
  });

  return chain.then(function () {
    var captured = results.filter(function (result) {
      return result.status === 'CAPTURED';
    });
    var skippedResults = results.filter(function (result) {
      return result.status === 'SKIPPED';
    });
    var failed = results.filter(function (result) {
      return result.status === 'FAILED';
    });
    return {
      total: results.length,
      capturedCount: captured.length,
      skippedCount: skippedResults.length,
      failedCount: failed.length,
      results: results,
      captured: captured,
      skipped: skippedResults,
      failed: failed,
    };
  });
}

module.exports = {
  captureOne: captureOne,
  captureReason: captureReason,
  captureReports: captureReports,
  caseExistsForDay: caseExistsForDay,
  currentFrom: currentFrom,
  isEligible: isEligible,
  normalizeEntries: normalizeEntries,
  timestampFor: timestampFor,
};
