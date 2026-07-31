'use strict';

var fs = require('fs');
var path = require('path');

var PROJECT_ROOT = path.resolve(__dirname, '..');
var DEFAULT_CASES_DIRECTORY = path.join(
  PROJECT_ROOT,
  'reports',
  'cases'
);
var DEFAULT_OUTCOME_PATH = path.join(
  PROJECT_ROOT,
  'reports',
  'ict-opportunity-outcome.json'
);
var DEFAULT_MATCH_WINDOW_MS = 15 * 60 * 1000;

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function validTime(value) {
  var timestamp = Date.parse(value);
  return isFinite(timestamp) ? timestamp : null;
}

function normalizeSymbol(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function normalizeOutcomes(input) {
  var outcomes;
  if (Array.isArray(input)) {
    outcomes = input;
  } else if (isObject(input) && Array.isArray(input.outcomes)) {
    outcomes = input.outcomes;
  } else {
    outcomes = [];
  }
  return outcomes.filter(function (outcome) {
    return isObject(outcome) &&
      normalizeSymbol(outcome.symbol) &&
      validTime(outcome.confirmedAt) !== null;
  }).map(function (outcome) {
    return clone(outcome);
  });
}

function completedAt(outcome) {
  if (
    outcome.completedAt !== undefined &&
    outcome.completedAt !== null
  ) {
    return outcome.completedAt;
  }
  if (outcome.trackingStatus === 'COMPLETED') {
    return outcome.threeRAt || null;
  }
  if (
    outcome.trackingStatus === 'FAILED' ||
    outcome.failed === true
  ) {
    return outcome.failedAt || null;
  }
  return null;
}

function projectOutcome(outcome) {
  return {
    trackingStatus: outcome.trackingStatus || null,
    oneRAt: outcome.oneRAt || null,
    twoRAt: outcome.twoRAt || null,
    threeRAt: outcome.threeRAt || null,
    failed: outcome.failed === true,
    failedAt: outcome.failedAt || null,
    completedAt: completedAt(outcome),
  };
}

function findMatch(caseData, rawOutcomes, matchWindowMs) {
  var outcomes = normalizeOutcomes(rawOutcomes);
  var symbol = normalizeSymbol(caseData && caseData.symbol);
  var caseTime = validTime(caseData && caseData.createdAt);
  var windowMs = typeof matchWindowMs === 'number' &&
    isFinite(matchWindowMs) &&
    matchWindowMs >= 0
    ? matchWindowMs
    : DEFAULT_MATCH_WINDOW_MS;
  var matches;

  if (!symbol || caseTime === null) return null;
  matches = outcomes.filter(function (outcome) {
    var outcomeTime = validTime(outcome.confirmedAt);
    return normalizeSymbol(outcome.symbol) === symbol &&
      Math.abs(outcomeTime - caseTime) <= windowMs;
  });
  matches.sort(function (left, right) {
    var leftTime = validTime(left.confirmedAt);
    var rightTime = validTime(right.confirmedAt);
    var distanceDifference =
      Math.abs(leftTime - caseTime) -
      Math.abs(rightTime - caseTime);
    if (distanceDifference !== 0) return distanceDifference;
    return rightTime - leftTime;
  });
  return matches.length > 0 ? matches[0] : null;
}

function linkCase(caseData, rawOutcomes, options) {
  options = options || {};
  var original = isObject(caseData) ? caseData : {};
  var match = findMatch(
    original,
    rawOutcomes,
    options.matchWindowMs
  );
  var projected;
  var linked;

  if (!match) {
    return {
      matched: false,
      changed: false,
      caseData: clone(original),
      matchedOutcome: null,
    };
  }
  projected = projectOutcome(match);
  linked = clone(original);
  if (
    JSON.stringify(linked.outcome || {}) ===
    JSON.stringify(projected)
  ) {
    return {
      matched: true,
      changed: false,
      caseData: linked,
      matchedOutcome: clone(match),
    };
  }
  linked.outcome = projected;
  return {
    matched: true,
    changed: true,
    caseData: linked,
    matchedOutcome: clone(match),
  };
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

function readJson(filePath, missingValue) {
  return new Promise(function (resolve, reject) {
    fs.readFile(filePath, 'utf8', function (error, content) {
      if (error && error.code === 'ENOENT') {
        resolve(clone(missingValue));
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

function writeJson(filePath, value) {
  var body = JSON.stringify(value, null, 2) + '\n';
  return new Promise(function (resolve, reject) {
    fs.writeFile(filePath, body, 'utf8', function (error) {
      if (error) reject(error);
      else resolve();
    });
  });
}

function readCaseEntries(casesDirectory) {
  return readDirectory(casesDirectory).then(function (files) {
    var jsonFiles = files.filter(function (fileName) {
      return /\.json$/i.test(fileName);
    }).sort();
    return Promise.all(jsonFiles.map(function (fileName) {
      var filePath = path.join(casesDirectory, fileName);
      return readJson(filePath, {}).then(function (data) {
        return {
          fileName: fileName,
          filePath: filePath,
          data: data,
        };
      });
    }));
  });
}

function updateGoldenCaseOutcomes(options) {
  options = options || {};
  var casesDirectory = path.resolve(
    options.casesDirectory || DEFAULT_CASES_DIRECTORY
  );
  var outcomeFilePath = path.resolve(
    options.outcomeFilePath || DEFAULT_OUTCOME_PATH
  );
  var outcomeState;
  var outcomes;
  var entries;
  var linkedResults;

  return readJson(
    outcomeFilePath,
    { version: 1, outcomes: [] }
  ).then(function (loadedOutcomeState) {
    outcomeState = loadedOutcomeState;
    outcomes = normalizeOutcomes(outcomeState);
    return readCaseEntries(casesDirectory);
  }).then(function (loadedEntries) {
    entries = loadedEntries;
    linkedResults = entries.map(function (entry) {
      return {
        entry: entry,
        link: linkCase(entry.data, outcomes, {
          matchWindowMs: options.matchWindowMs,
        }),
      };
    });
    return Promise.all(linkedResults.map(function (result) {
      if (!result.link.changed) return Promise.resolve(false);
      return writeJson(
        result.entry.filePath,
        result.link.caseData
      ).then(function () {
        return true;
      });
    }));
  }).then(function () {
    var matched = linkedResults.filter(function (result) {
      return result.link.matched;
    });
    var updated = linkedResults.filter(function (result) {
      return result.link.changed;
    });
    return {
      casesDirectory: casesDirectory,
      outcomeFilePath: outcomeFilePath,
      casesScanned: entries.length,
      outcomesAvailable: outcomes.length,
      matchedCases: matched.length,
      updatedCases: updated.length,
      updatedFiles: updated.map(function (result) {
        return result.entry.filePath;
      }),
      changed: updated.length > 0,
    };
  });
}

module.exports = {
  DEFAULT_CASES_DIRECTORY: DEFAULT_CASES_DIRECTORY,
  DEFAULT_MATCH_WINDOW_MS: DEFAULT_MATCH_WINDOW_MS,
  DEFAULT_OUTCOME_PATH: DEFAULT_OUTCOME_PATH,
  completedAt: completedAt,
  findMatch: findMatch,
  linkCase: linkCase,
  normalizeOutcomes: normalizeOutcomes,
  projectOutcome: projectOutcome,
  readCaseEntries: readCaseEntries,
  updateGoldenCaseOutcomes: updateGoldenCaseOutcomes,
};
