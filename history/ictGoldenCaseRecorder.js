'use strict';

var fs = require('fs');
var path = require('path');
var BeijingTime = require('../formatters/beijingTime');

var PROJECT_ROOT = path.resolve(__dirname, '..');
var DEFAULT_CASES_DIRECTORY = path.join(
  PROJECT_ROOT,
  'reports',
  'cases'
);
var ANALYSIS_VERSION = {
  bias: 'V3',
  structurePhase: 'V1',
  alignment: 'V1',
  opportunity: 'V1',
  confirmation: 'V1',
};

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function clone(value) {
  if (value === undefined || value === null) {
    return value === undefined ? null : value;
  }
  return JSON.parse(JSON.stringify(value));
}

function valueOrNull(value) {
  return value === undefined ? null : clone(value);
}

function normalizeSymbol(value) {
  var symbol = typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
  if (!/^[A-Z0-9]{5,30}$/.test(symbol)) {
    throw new Error('A valid symbol is required.');
  }
  return symbol;
}

function normalizeTimestamp(value) {
  var timestamp = value instanceof Date
    ? value.getTime()
    : (
      typeof value === 'string'
        ? Date.parse(value)
        : value
    );
  if (value === undefined || value === null) {
    timestamp = Date.now();
  }
  if (typeof timestamp !== 'number' || !isFinite(timestamp)) {
    throw new Error('A valid timestamp is required.');
  }
  return timestamp;
}

function reportCurrent(report) {
  if (!isObject(report)) return {};
  if (isObject(report.current)) return report.current;
  if (isObject(report.report)) {
    return reportCurrent(report.report);
  }
  return report;
}

function confirmationFrom(current) {
  var observation = isObject(current.fiveMinuteObservation)
    ? current.fiveMinuteObservation
    : {};
  var confirmed = isObject(observation.currentConfirmed)
    ? observation.currentConfirmed
    : {};
  return isObject(confirmed.confirmation)
    ? confirmed.confirmation
    : {};
}

function rawConfirmationFrom(current) {
  var observation = isObject(current.fiveMinuteObservation)
    ? current.fiveMinuteObservation
    : {};
  var confirmed = isObject(observation.currentConfirmed)
    ? observation.currentConfirmed
    : {};
  return isObject(confirmed.confirmation)
    ? confirmed.confirmation
    : null;
}

function finitePrice(value) {
  var number = Number(value);
  return isFinite(number) && number > 0 ? number : null;
}

function priceFromLiquidity(current) {
  var roadmap = Array.isArray(current.liquidityRoadmap)
    ? current.liquidityRoadmap
    : [];
  var index;
  for (index = 0; index < roadmap.length; index += 1) {
    var levelPrice = finitePrice(roadmap[index].price);
    var distance = Number(roadmap[index].distanceValue);
    var inferred;
    if (
      levelPrice === null ||
      !isFinite(distance) ||
      distance < 0
    ) {
      continue;
    }
    if (roadmap[index].side === 'BUY_SIDE') {
      inferred = levelPrice - distance;
    } else if (roadmap[index].side === 'SELL_SIDE') {
      inferred = levelPrice + distance;
    } else {
      continue;
    }
    inferred = finitePrice(inferred);
    if (inferred !== null) return inferred;
  }
  return null;
}

function snapshotPrice(options, report, current) {
  var candidates = [
    options.price,
    current.price,
    current.currentPrice,
    current.marketPrice,
    report.price,
    report.currentPrice,
  ];
  var index;
  var price;
  for (index = 0; index < candidates.length; index += 1) {
    price = finitePrice(candidates[index]);
    if (price !== null) return price;
  }
  return priceFromLiquidity(current);
}

function liquidityFrom(current, h4) {
  if (current.liquidity !== undefined) {
    return valueOrNull(current.liquidity);
  }
  if (current.liquidityRoadmap !== undefined) {
    return valueOrNull(current.liquidityRoadmap);
  }
  if (h4.externalLiquidity !== undefined) {
    return valueOrNull(h4.externalLiquidity);
  }
  return null;
}

function reportVersionFrom(report) {
  if (
    isObject(report.protocol) &&
    report.protocol.version !== undefined
  ) {
    return valueOrNull(report.protocol.version);
  }
  return valueOrNull(report.reportVersion || report.version);
}

function buildSnapshot(options, report, current, timestamp) {
  var h4 = isObject(current.fourHourAnalysis)
    ? current.fourHourAnalysis
    : {};
  var symbol = normalizeSymbol(
    options.symbol || report.symbol || current.symbol
  );
  return {
    capturedAt: new Date(timestamp).toISOString(),
    symbol: symbol,
    price: snapshotPrice(options, report, current),
    h4Bias: valueOrNull(current.fourHourAnalysis),
    structurePhase: valueOrNull(current.structurePhase),
    htfAlignment: valueOrNull(current.htfAlignment),
    opportunity: valueOrNull(current.opportunity),
    confirmation: valueOrNull(rawConfirmationFrom(current)),
    liquidity: liquidityFrom(current, h4),
    reportVersion: reportVersionFrom(report),
  };
}

function buildCase(options) {
  options = options || {};
  var report = isObject(options.report)
    ? options.report
    : {};
  var current = reportCurrent(report);
  var h4 = isObject(current.fourHourAnalysis)
    ? current.fourHourAnalysis
    : {};
  var phase = isObject(current.structurePhase)
    ? current.structurePhase
    : {};
  var alignment = isObject(current.htfAlignment)
    ? current.htfAlignment
    : {};
  var opportunity = isObject(current.opportunity)
    ? current.opportunity
    : {};
  var confirmation = confirmationFrom(current);
  var timestamp = normalizeTimestamp(options.timestamp);
  var symbol = normalizeSymbol(
    options.symbol || report.symbol || current.symbol
  );
  var structure = h4.currentStructure;
  var premiumDiscount = h4.premiumDiscount;
  var liquidityPrice = opportunity.liquidityPrice;
  var data;

  if (
    structure === undefined &&
    isObject(h4.structure)
  ) {
    structure = h4.structure.state;
  }
  if (
    premiumDiscount === undefined &&
    isObject(h4.dealingRange)
  ) {
    premiumDiscount = h4.dealingRange.location;
  }
  if (liquidityPrice === undefined) {
    liquidityPrice = opportunity.price;
  }

  data = {
    symbol: symbol,
    createdAt: new Date(timestamp).toISOString(),
    analysisVersion: clone(ANALYSIS_VERSION),
    snapshotVersion: '1',
    snapshot: buildSnapshot(
      options,
      report,
      current,
      timestamp
    ),
    htfBias: {
      bias: valueOrNull(h4.bias),
      structure: valueOrNull(structure),
      premiumDiscount: valueOrNull(premiumDiscount),
    },
    structurePhase: {
      state: valueOrNull(
        phase.state === undefined
          ? phase.structurePhase
          : phase.state
      ),
      direction: valueOrNull(phase.direction),
      context: valueOrNull(phase.context),
      sourceEvent: valueOrNull(phase.sourceEvent),
      mssEvent: valueOrNull(phase.mssEvent),
      confirmationBos: valueOrNull(phase.confirmationBos),
    },
    htfAlignment: {
      status: valueOrNull(alignment.status),
      biasDirection: valueOrNull(alignment.biasDirection),
      structureDirection: valueOrNull(
        alignment.structureDirection
      ),
      reason: valueOrNull(alignment.reason),
    },
    opportunity: {
      status: valueOrNull(opportunity.status),
      direction: valueOrNull(opportunity.direction),
      liquidityType: valueOrNull(opportunity.liquidityType),
      liquidityPrice: valueOrNull(liquidityPrice),
    },
    confirmation: {
      status: valueOrNull(confirmation.status),
      direction: valueOrNull(confirmation.direction),
    },
    outcome: {},
    review: null,
  };
  if (isObject(options.captureReason)) {
    data.captureReason = {
      opportunityStatus: valueOrNull(
        options.captureReason.opportunityStatus
      ),
      htfBias: valueOrNull(options.captureReason.htfBias),
      alignmentStatus: valueOrNull(
        options.captureReason.alignmentStatus
      ),
    };
  }
  return data;
}

function beijingDate(timestamp) {
  return BeijingTime.formatBeijingTime(timestamp).slice(0, 10);
}

function timeSuffix(timestamp) {
  var displayed = BeijingTime.formatBeijingTime(timestamp);
  var clock = displayed.slice(11).replace(/:/g, '');
  var milliseconds = String(
    new Date(timestamp).getUTCMilliseconds()
  );
  while (milliseconds.length < 3) {
    milliseconds = '0' + milliseconds;
  }
  return clock + milliseconds;
}

function ensureDirectory(directory) {
  return new Promise(function (resolve, reject) {
    fs.mkdir(directory, { recursive: true }, function (error) {
      if (error) reject(error);
      else resolve();
    });
  });
}

function writeExclusive(directory, baseName, suffix, body, attempt) {
  var ending = suffix;
  var fileName;
  var filePath;

  if (attempt > 0) {
    ending += '-' + (attempt + 1);
  }
  fileName = baseName + ending + '.json';
  filePath = path.join(directory, fileName);

  return new Promise(function (resolve, reject) {
    fs.writeFile(
      filePath,
      body,
      { encoding: 'utf8', flag: 'wx' },
      function (error) {
        if (!error) {
          resolve(filePath);
          return;
        }
        if (error.code === 'EEXIST') {
          writeExclusive(
            directory,
            baseName,
            suffix,
            body,
            attempt + 1
          ).then(resolve, reject);
          return;
        }
        reject(error);
      }
    );
  });
}

function relativeCasePath(filePath) {
  return path.relative(PROJECT_ROOT, filePath)
    .split(path.sep)
    .join('/');
}

function normalizeCase(caseData) {
  var normalized = isObject(caseData)
    ? clone(caseData)
    : {};
  if (!Object.prototype.hasOwnProperty.call(
    normalized,
    'snapshot'
  )) {
    normalized.snapshot = null;
  }
  if (!Object.prototype.hasOwnProperty.call(
    normalized,
    'snapshotVersion'
  )) {
    normalized.snapshotVersion = null;
  }
  if (!Object.prototype.hasOwnProperty.call(
    normalized,
    'review'
  )) {
    normalized.review = null;
  }
  if (!Object.prototype.hasOwnProperty.call(
    normalized,
    'analysisVersion'
  )) {
    normalized.analysisVersion = null;
  }
  return normalized;
}

function readCase(filePath) {
  var resolvedPath = path.resolve(filePath);
  return new Promise(function (resolve, reject) {
    fs.readFile(resolvedPath, 'utf8', function (error, body) {
      var parsed;
      if (error) {
        reject(error);
        return;
      }
      try {
        parsed = JSON.parse(body);
      } catch (parseError) {
        reject(parseError);
        return;
      }
      resolve(normalizeCase(parsed));
    });
  });
}

function recordCase(options) {
  options = options || {};
  var data = buildCase(options);
  var timestamp = Date.parse(data.createdAt);
  var directory = options.outputDirectory
    ? path.resolve(options.outputDirectory)
    : DEFAULT_CASES_DIRECTORY;
  var baseName = beijingDate(timestamp) + '-' + data.symbol;
  var body = JSON.stringify(data, null, 2) + '\n';
  var primaryPath = path.join(directory, baseName + '.json');

  return ensureDirectory(directory).then(function () {
    return new Promise(function (resolve, reject) {
      fs.writeFile(
        primaryPath,
        body,
        { encoding: 'utf8', flag: 'wx' },
        function (error) {
          if (!error) {
            resolve(primaryPath);
            return;
          }
          if (error.code === 'EEXIST') {
            if (options.skipIfExists === true) {
              resolve(null);
              return;
            }
            writeExclusive(
              directory,
              baseName,
              '-' + timeSuffix(timestamp),
              body,
              0
            ).then(resolve, reject);
            return;
          }
          reject(error);
        }
      );
    });
  }).then(function (filePath) {
    if (!filePath) {
      return {
        symbol: data.symbol,
        createdAt: data.createdAt,
        filePath: primaryPath,
        relativePath: relativeCasePath(primaryPath),
        data: clone(data),
        saved: false,
        reason: 'EXISTS',
      };
    }
    return {
      symbol: data.symbol,
      createdAt: data.createdAt,
      filePath: filePath,
      relativePath: relativeCasePath(filePath),
      data: clone(data),
      saved: true,
    };
  });
}

module.exports = {
  ANALYSIS_VERSION: clone(ANALYSIS_VERSION),
  DEFAULT_CASES_DIRECTORY: DEFAULT_CASES_DIRECTORY,
  beijingDate: beijingDate,
  buildCase: buildCase,
  buildSnapshot: buildSnapshot,
  normalizeCase: normalizeCase,
  readCase: readCase,
  recordCase: recordCase,
  snapshotPrice: snapshotPrice,
};
