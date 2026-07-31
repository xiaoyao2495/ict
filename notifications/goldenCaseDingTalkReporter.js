'use strict';

var axios = require('axios');
var BeijingTime = require('../formatters/beijingTime');

var TITLE = 'ICT Golden Case Daily';
var WEBHOOK_ENV_NAME = 'DINGTALK_WEBHOOK';
var DEFAULT_FOCUS_SYMBOLS = ['BTCUSDT', 'XAUUSDT'];

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function safeNumber(value) {
  var number = Number(value);
  return isFinite(number) ? number : 0;
}

function percent(value) {
  var number = Number(value);
  return isFinite(number)
    ? (number * 100).toFixed(2) + '%'
    : '0.00%';
}

function stepValue(pipelineResult, key) {
  var steps = isObject(pipelineResult && pipelineResult.steps)
    ? pipelineResult.steps
    : {};
  var step = isObject(steps[key]) ? steps[key] : {};
  return isObject(step.value) ? step.value : {};
}

function numberFromText(text, label) {
  var escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var match = String(text || '').match(
    new RegExp(escaped + '\\s*[：:]\\s*(\\d+)', 'i')
  );
  return match ? Number(match[1]) : 0;
}

function bestFromText(text) {
  var source = String(text || '');
  var sectionIndex = source.indexOf('6. 最佳案例条件');
  var section = sectionIndex >= 0
    ? source.slice(sectionIndex)
    : source;
  var lineMatch = section.match(/^\s*1\.\s*(.+)$/m);
  var line;
  var sample;
  var rate;
  if (!lineMatch) return null;
  line = lineMatch[1].trim();
  sample = line.match(/样本[=：]?\s*(\d+)/);
  rate = line.match(/完成率[=：]?\s*([\d.]+%)/);
  return {
    condition: line
      .replace(/｜样本[=：]?\s*\d+.*/, '')
      .trim(),
    sampleCount: sample ? Number(sample[1]) : 0,
    completionRateText: rate ? rate[1] : '0.00%',
  };
}

function researchFrom(options) {
  var pipelineResult = options.pipelineResult || {};
  var researchStep = stepValue(
    pipelineResult,
    'researchReport'
  );
  var research = isObject(options.research)
    ? options.research
    : researchStep.research;
  var overview;
  var best;
  var text = String(
    options.researchReportText || researchStep.text || ''
  );

  if (isObject(research)) {
    overview = isObject(research.overview)
      ? research.overview
      : {};
    best = Array.isArray(research.bestConditions) &&
      research.bestConditions.length > 0
      ? research.bestConditions[0]
      : null;
    return {
      totalCases: safeNumber(overview.totalCases),
      completedCount: safeNumber(overview.completedCount),
      failedCount: safeNumber(overview.failedCount),
      trackingCount: safeNumber(overview.trackingCount),
      best: best ? {
        condition: [
          '4H=' + (best.h4Bias || 'UNAVAILABLE'),
          '结构阶段=' +
            (best.structurePhase || 'UNAVAILABLE'),
          '一致性=' +
            (best.htfAlignment || 'UNAVAILABLE'),
          '机会方向=' +
            (best.opportunityDirection || 'UNAVAILABLE'),
          '流动性=' +
            (best.liquidityType || 'UNAVAILABLE'),
        ].join('｜'),
        sampleCount: safeNumber(best.sampleCount),
        completionRateText: percent(best.completionRate),
      } : null,
    };
  }

  return {
    totalCases: numberFromText(text, '案例数量'),
    completedCount: numberFromText(text, '完成数量'),
    failedCount: numberFromText(text, '失败数量'),
    trackingCount: numberFromText(text, '追踪中数量'),
    best: bestFromText(text),
  };
}

function captureFrom(pipelineResult) {
  var capture = stepValue(pipelineResult, 'capture');
  return {
    capturedCount: safeNumber(capture.capturedCount),
    results: Array.isArray(capture.results)
      ? capture.results
      : [],
  };
}

function opportunityStatus(item) {
  var reason = isObject(item && item.reason)
    ? item.reason
    : {};
  var savedData = item && item.saved && item.saved.data;
  var opportunity = isObject(
    savedData && savedData.opportunity
  ) ? savedData.opportunity : {};
  if (reason.opportunityStatus) {
    return String(reason.opportunityStatus);
  }
  if (opportunity.status) return String(opportunity.status);
  if (!item) return '暂无当日状态';
  if (item.status === 'CAPTURED') return '今日已新增案例';
  if (item.status === 'FAILED') return '案例保存失败';
  if (item.reason === 'ALREADY_CAPTURED_TODAY') {
    return '今日已记录';
  }
  if (item.reason === 'NOT_ELIGIBLE') {
    return '当前未满足自动捕获条件';
  }
  return String(item.status || '暂无当日状态');
}

function observations(results, focusSymbols) {
  var bySymbol = {};
  var symbols = Array.isArray(focusSymbols) &&
    focusSymbols.length > 0
    ? focusSymbols
    : DEFAULT_FOCUS_SYMBOLS;
  results.forEach(function (item) {
    if (item && item.symbol) {
      bySymbol[String(item.symbol).toUpperCase()] = item;
    }
  });
  return symbols.map(function (symbol) {
    var normalized = String(symbol).toUpperCase();
    return {
      symbol: normalized,
      status: opportunityStatus(bySymbol[normalized]),
    };
  });
}

function formatBest(best) {
  if (!best) {
    return [
      '条件：',
      '暂无满足样本要求的组合',
      '',
      '样本：',
      '0',
      '',
      '完成率：',
      '0.00%',
    ];
  }
  return [
    '条件：',
    best.condition,
    '',
    '样本：',
    String(safeNumber(best.sampleCount)),
    '',
    '完成率：',
    best.completionRateText || '0.00%',
  ];
}

function buildMessage(options) {
  options = options || {};
  var pipelineResult = options.pipelineResult || {};
  var research = researchFrom(options);
  var capture = captureFrom(pipelineResult);
  var currentTime = options.currentTime !== undefined
    ? options.currentTime
    : pipelineResult.currentTime;
  var date = BeijingTime.formatBeijingTime(currentTime)
    .slice(0, 10);
  var focus = observations(
    capture.results,
    options.focusSymbols
  );
  var lines = [
    TITLE,
    '',
    '================',
    '',
    '日期：',
    date,
    '',
    '今日新增案例：',
    String(capture.capturedCount),
    '',
    '当前案例总数：',
    String(research.totalCases),
    '',
    'Outcome:',
    '',
    'COMPLETED:',
    String(research.completedCount),
    '',
    'FAILED:',
    String(research.failedCount),
    '',
    'TRACKING:',
    String(research.trackingCount),
    '',
    '最佳研究组合：',
    '',
  ];
  lines = lines.concat(formatBest(research.best));
  lines.push('', '重点观察：', '');
  focus.forEach(function (item, index) {
    lines.push(item.symbol + ':', item.status);
    if (index < focus.length - 1) lines.push('');
  });
  lines.push('', '================');
  return lines.join('\n');
}

function buildPayload(message) {
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('Golden Case daily message is required.');
  }
  return {
    msgtype: 'text',
    text: {
      content: message,
    },
  };
}

function sendReport(options) {
  options = options || {};
  var webhookUrl = options.webhookUrl ||
    process.env[WEBHOOK_ENV_NAME];
  var httpClient = options.httpClient || axios;
  var message = options.message || buildMessage(options);
  var payload = buildPayload(message);

  if (!webhookUrl) {
    return Promise.resolve({
      sent: false,
      reason: 'WEBHOOK_MISSING',
      message: message,
      payload: payload,
      response: null,
      error: null,
    });
  }
  if (!httpClient || typeof httpClient.post !== 'function') {
    return Promise.resolve({
      sent: false,
      reason: 'HTTP_CLIENT_UNAVAILABLE',
      message: message,
      payload: payload,
      response: null,
      error: null,
    });
  }

  return Promise.resolve().then(function () {
    return httpClient.post(webhookUrl, payload);
  }).then(function (response) {
    return {
      sent: true,
      reason: null,
      message: message,
      payload: payload,
      response: response,
      error: null,
    };
  }).catch(function (error) {
    return {
      sent: false,
      reason: 'SEND_FAILED',
      message: message,
      payload: payload,
      response: null,
      error: error,
    };
  });
}

module.exports = {
  DEFAULT_FOCUS_SYMBOLS: DEFAULT_FOCUS_SYMBOLS,
  TITLE: TITLE,
  WEBHOOK_ENV_NAME: WEBHOOK_ENV_NAME,
  bestFromText: bestFromText,
  buildMessage: buildMessage,
  buildPayload: buildPayload,
  captureFrom: captureFrom,
  numberFromText: numberFromText,
  observations: observations,
  opportunityStatus: opportunityStatus,
  researchFrom: researchFrom,
  sendReport: sendReport,
};
