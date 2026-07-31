'use strict';

var fs = require('fs');
var path = require('path');

var PROJECT_ROOT = path.resolve(__dirname, '..');
var DEFAULT_INPUT_DIRECTORY = path.join(
  PROJECT_ROOT,
  'reports',
  'cases'
);
var DEFAULT_OUTPUT_PATH = path.join(
  PROJECT_ROOT,
  'reports',
  'golden-case-summary.txt'
);

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function hasValue(value) {
  return value !== undefined &&
    value !== null &&
    value !== '';
}

function displayValue(value) {
  if (!hasValue(value)) return '未记录';
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function labeledEnum(value, translations) {
  if (!hasValue(value)) return '未记录';
  var raw = String(value);
  return translations[raw]
    ? translations[raw] + '（' + raw + '）'
    : raw;
}

function directionLabel(value) {
  return labeledEnum(value, {
    BULLISH: '偏多',
    BEARISH: '偏空',
    LONG: '偏多观察',
    SHORT: '偏空观察',
    NEUTRAL: '中性',
  });
}

function alignmentLabel(value) {
  return labeledEnum(value, {
    ALIGNED: '一致',
    CONFLICT: '冲突',
    UNDETERMINED: '未确定',
    WAITING: '等待确认',
  });
}

function opportunityStatusLabel(value) {
  return labeledEnum(value, {
    WAITING: '等待接近关键区域',
    WATCH_ZONE: '进入观察区域',
    CONFIRMING: '确认过程中',
    CONFIRMED: '已确认',
  });
}

function confirmationStatusLabel(value) {
  return labeledEnum(value, {
    WAITING: '等待确认',
    CONFIRMED: '已确认',
    CONFIRMED_BULLISH: '偏多确认完成',
    CONFIRMED_BEARISH: '偏空确认完成',
  });
}

function objectOrEmpty(value) {
  return isObject(value) ? value : {};
}

function isEmptyObject(value) {
  return !isObject(value) || Object.keys(value).length === 0;
}

function outcomeLines(outcome) {
  if (isEmptyObject(outcome)) {
    return ['等待：Tracking...'];
  }
  return Object.keys(outcome).sort().map(function (key) {
    return key + '：' + displayValue(outcome[key]);
  });
}

function formatCase(entry, index) {
  var data = objectOrEmpty(entry.data);
  var htfBias = objectOrEmpty(data.htfBias);
  var structurePhase = objectOrEmpty(data.structurePhase);
  var alignment = objectOrEmpty(data.htfAlignment);
  var opportunity = objectOrEmpty(data.opportunity);
  var confirmation = objectOrEmpty(data.confirmation);
  var lines = [
    '========================================',
    '案例 ' + (index + 1) + '：' + displayValue(data.symbol),
    '',
    '【基础信息】',
    '交易对：' + displayValue(data.symbol),
    '记录时间：' + displayValue(data.createdAt),
    '',
    '【4小时环境】',
    '方向：' + directionLabel(htfBias.bias),
    '结构：' + displayValue(htfBias.structure),
    'Premium/Discount：' + displayValue(
      htfBias.premiumDiscount
    ),
    '结构阶段：' + displayValue(structurePhase.state),
    '结构方向：' + directionLabel(structurePhase.direction),
    '阶段说明：' + displayValue(structurePhase.context),
    '一致性：' + alignmentLabel(alignment.status),
    '一致性说明：' + displayValue(alignment.reason),
    '',
    '【交易机会】',
    '方向：' + directionLabel(opportunity.direction),
    '当前阶段：' + opportunityStatusLabel(
      opportunity.status
    ),
    '关注流动性：' + displayValue(
      opportunity.liquidityType
    ),
    '流动性价格：' + displayValue(
      opportunity.liquidityPrice
    ),
    '',
    '【5分钟确认】',
    '状态：' + confirmationStatusLabel(
      confirmation.status
    ),
    '方向：' + directionLabel(confirmation.direction),
    '',
    '【后续观察】',
  ];

  return lines.concat(outcomeLines(data.outcome)).join('\n');
}

function caseTimestamp(entry) {
  var createdAt = entry && entry.data
    ? entry.data.createdAt
    : null;
  var timestamp = Date.parse(createdAt);
  return isFinite(timestamp) ? timestamp : -Infinity;
}

function sortCases(entries) {
  return entries.slice().sort(function (left, right) {
    var timeDifference =
      caseTimestamp(right) - caseTimestamp(left);
    var leftSymbol;
    var rightSymbol;
    if (timeDifference !== 0) return timeDifference;
    leftSymbol = displayValue(left.data && left.data.symbol);
    rightSymbol = displayValue(right.data && right.data.symbol);
    if (leftSymbol < rightSymbol) return -1;
    if (leftSymbol > rightSymbol) return 1;
    return String(left.fileName).localeCompare(
      String(right.fileName)
    );
  });
}

function formatReport(entries) {
  var ordered = sortCases(Array.isArray(entries) ? entries : []);
  var lines = [
    'ICT Golden Case 人工复盘汇总',
    '',
    '案例数量：' + ordered.length,
  ];
  var index;

  if (ordered.length === 0) {
    lines.push('', '暂无可复盘案例。');
    return lines.join('\n') + '\n';
  }
  for (index = 0; index < ordered.length; index += 1) {
    lines.push('', formatCase(ordered[index], index));
  }
  return lines.join('\n') + '\n';
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
    });
    return Promise.all(jsonFiles.map(function (fileName) {
      var filePath = path.join(inputDirectory, fileName);
      return readFile(filePath).then(function (content) {
        return {
          fileName: fileName,
          filePath: filePath,
          data: JSON.parse(content),
        };
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

function generateGoldenCaseReport(options) {
  options = options || {};
  var inputDirectory = path.resolve(
    options.inputDirectory || DEFAULT_INPUT_DIRECTORY
  );
  var outputPath = path.resolve(
    options.outputPath || DEFAULT_OUTPUT_PATH
  );
  var entries;
  var text;

  return readCases(inputDirectory).then(function (loaded) {
    entries = sortCases(loaded);
    text = formatReport(entries);
    return ensureDirectory(path.dirname(outputPath));
  }).then(function () {
    return writeFile(outputPath, text);
  }).then(function () {
    return {
      inputDirectory: inputDirectory,
      outputPath: outputPath,
      cases: entries,
      text: text,
    };
  });
}

if (require.main === module) {
  generateGoldenCaseReport().then(function (result) {
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
  formatCase: formatCase,
  formatReport: formatReport,
  generateGoldenCaseReport: generateGoldenCaseReport,
  readCases: readCases,
  sortCases: sortCases,
};
