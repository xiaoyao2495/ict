'use strict';

const axios = require('axios');
const AnalystReportRunner = require('./runAnalystReport');
const NotificationState = require(
  '../notifications/ictAnalystNotificationState'
);
const BeijingTime = require('../formatters/beijingTime');

const NOTIFICATION_HEADER = '检测---ICT市场分析';
const WEBHOOK_ENV_NAME = 'DINGTALK_WEBHOOK_URL';

function formatReportTime(report, fallbackTime) {
  const asOf = report &&
    report.current &&
    report.current.asOf !== undefined
    ? report.current.asOf
    : fallbackTime;

  return BeijingTime.formatBeijingTime(asOf);
}

function buildNotificationText(options) {
  options = options || {};
  const formatted = String(options.formatted || '').trim();
  if (!formatted) {
    throw new Error('A formatted ICT Analyst Report is required.');
  }

  const lines = formatted.split(/\r?\n/);
  const title = lines.shift();
  while (lines.length > 0 && lines[0] === '') lines.shift();
  const timeLine = lines.length > 0 &&
    lines[0].startsWith('时间：')
    ? lines.shift()
    : '时间：' + formatReportTime(
      options.report,
      options.currentTime
    );
  while (lines.length > 0 && lines[0] === '') lines.shift();

  return [
    NOTIFICATION_HEADER,
    '',
    title,
    '',
    timeLine,
    '品种：' + (options.symbol || AnalystReportRunner.SYMBOL),
    '',
    ...lines,
  ].join('\n');
}

function buildDingTalkPayload(content) {
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('DingTalk notification content is required.');
  }
  return {
    msgtype: 'text',
    text: {
      content,
    },
  };
}

async function sendNotification(options) {
  options = options || {};
  const webhookUrl = options.webhookUrl;
  const payload = options.payload;
  const httpClient = options.httpClient || axios;

  if (!webhookUrl) {
    throw new Error(
      'DingTalk webhook URL is required via ' +
      WEBHOOK_ENV_NAME + '.'
    );
  }
  if (!httpClient || typeof httpClient.post !== 'function') {
    throw new Error('An axios-compatible post function is required.');
  }

  return httpClient.post(webhookUrl, payload);
}

async function run(options) {
  options = options || {};
  const analysis = await AnalystReportRunner.run({
    currentTime: options.currentTime,
    limit: options.limit,
    marketData: options.marketData,
    output() {},
  });
  const stateStore = options.stateStore ||
    NotificationState.createFileStore(options.stateFilePath);
  const previousState = await stateStore.load();
  const notification = NotificationState.evaluate(
    previousState,
    analysis.report
  );

  if (!notification.shouldNotify) {
    return {
      ...analysis,
      notification,
      sent: false,
      message: null,
      payload: null,
      response: null,
    };
  }

  const message = buildNotificationText({
    formatted: analysis.message,
    report: analysis.report,
    currentTime: analysis.currentTime,
    symbol: analysis.symbol,
  });
  const payload = buildDingTalkPayload(message);
  const webhookUrl = options.webhookUrl ||
    process.env[WEBHOOK_ENV_NAME];
  const response = await sendNotification({
    webhookUrl,
    payload,
    httpClient: options.httpClient || axios,
  });
  await stateStore.save(notification.currentState);

  return {
    ...analysis,
    notification,
    sent: true,
    message,
    payload,
    response,
  };
}

if (require.main === module) {
  run().then((result) => {
    console.log(result.sent
      ? 'ICT Analyst Report notification sent.'
      : 'ICT Analyst Report state unchanged; notification skipped.'
    );
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  NOTIFICATION_HEADER,
  WEBHOOK_ENV_NAME,
  buildDingTalkPayload,
  buildNotificationText,
  formatReportTime,
  run,
  sendNotification,
};
