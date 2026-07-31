'use strict';

const assert = require('assert');
const HtfContext = require('../indicators/htfContextAnalyzer');
const NotifyRunner = require(
  '../scripts/runAnalystReportNotify'
);
const NotificationState = require(
  '../notifications/ictAnalystNotificationState'
);

const FIVE_MINUTES = 5 * 60 * 1000;
const START = Date.UTC(2026, 0, 1);
const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function createFiveMinuteBars(length) {
  return Array.from({ length }, (_, index) => {
    const center =
      90000 +
      Math.sin(index / 75) * 2200 +
      Math.sin(index / 15) * 350;
    const open = center + (index % 4 === 0 ? 60 : -50);
    const close = center + (index % 4 === 0 ? -50 : 60);
    return {
      openTime: START + index * FIVE_MINUTES,
      closeTime: START + (index + 1) * FIVE_MINUTES - 1,
      open,
      high: Math.max(open, close) + 80,
      low: Math.min(open, close) - 80,
      close,
      volume: 1,
    };
  });
}

function unfinishedAfter(last, duration) {
  return {
    openTime: last.openTime + duration,
    closeTime: last.closeTime + duration,
    open: last.close,
    high: last.close + 100,
    low: last.close - 100,
    close: last.close + 10,
    volume: 1,
  };
}

test('notification text keeps keyword and formatter output', () => {
  const asOf = Date.UTC(2026, 6, 27, 8);
  const formatted = [
    '【ICT市场分析】',
    '',
    '【交易监控面板】',
    '① 【HTF】',
    '② 【Entry Watch】',
    '③ 【Event Chain】',
    '④ 【Primary Draw】',
  ].join('\n');
  const text = NotifyRunner.buildNotificationText({
    formatted,
    report: {
      current: { asOf },
    },
    symbol: 'BTCUSDT',
  });

  assert.ok(text.startsWith('检测---ICT市场分析'));
  assert.ok(text.includes('【ICT市场分析】'));
  assert.ok(text.includes('时间：2026-07-27 16:00:00'));
  assert.ok(text.includes('品种：BTCUSDT'));
  assert.ok(text.includes('【交易监控面板】'));
  assert.ok(text.includes('① 【HTF】'));
  assert.ok(text.includes('② 【Entry Watch】'));
  assert.ok(text.includes('③ 【Event Chain】'));
  assert.ok(text.includes('④ 【Primary Draw】'));
});

test('closed Klines flow to Formatter and DingTalk webhook', async () => {
  const fiveMinute = createFiveMinuteBars(2400);
  const oneHour = HtfContext.aggregateClosedKlines(
    fiveMinute,
    HtfContext.ONE_HOUR
  );
  const fourHour = HtfContext.aggregateClosedKlines(
    fiveMinute,
    HtfContext.FOUR_HOURS
  );
  const currentTime =
    fiveMinute[fiveMinute.length - 1].closeTime + 1;
  const responses = {
    '4h': fourHour.concat(unfinishedAfter(
      fourHour[fourHour.length - 1],
      HtfContext.FOUR_HOURS
    )),
    '1h': oneHour.concat(unfinishedAfter(
      oneHour[oneHour.length - 1],
      HtfContext.ONE_HOUR
    )),
    '5m': fiveMinute.concat(unfinishedAfter(
      fiveMinute[fiveMinute.length - 1],
      FIVE_MINUTES
    )),
  };
  const marketCalls = [];
  const webhookCalls = [];
  const webhookUrl = 'https://example.test/dingtalk-webhook';
  const result = await NotifyRunner.run({
    currentTime,
    webhookUrl,
    stateStore: NotificationState.createMemoryStore(),
    marketData: {
      async getKlines(symbol, interval, limit) {
        marketCalls.push({ symbol, interval, limit });
        return responses[interval];
      },
    },
    httpClient: {
      async post(url, message) {
        webhookCalls.push({ url, message });
        return {
          data: {
            errcode: 0,
            errmsg: 'ok',
          },
        };
      },
    },
  });

  assert.deepStrictEqual(
    marketCalls.map((call) => call.interval).sort(),
    ['1h', '4h', '5m']
  );
  assert.strictEqual(
    result.klines.h4Klines.length,
    fourHour.length
  );
  assert.strictEqual(
    result.klines.h1Klines.length,
    oneHour.length
  );
  assert.strictEqual(
    result.klines.ltf5mKlines.length,
    fiveMinute.length
  );
  assert.strictEqual(webhookCalls.length, 1);
  assert.strictEqual(result.sent, true);
  assert.deepStrictEqual(
    result.notification.reasons,
    ['INITIAL_STATE']
  );
  assert.strictEqual(webhookCalls[0].url, webhookUrl);
  assert.deepStrictEqual(webhookCalls[0].message, result.payload);
  assert.deepStrictEqual(result.payload, {
    msgtype: 'text',
    text: {
      content: result.message,
    },
  });
  assert.ok(result.message.includes('检测'));
  assert.ok(result.message.includes('【ICT市场分析】'));
  assert.ok(result.message.includes('【交易监控面板】'));
  assert.ok(result.message.includes('① 【HTF】'));
  assert.ok(result.message.includes('② 【Entry Watch】'));
  assert.ok(result.message.includes('③ 【Event Chain】'));
  assert.ok(result.message.includes('④ 【Primary Draw】'));
  assert.ok(result.report.current.humanSummary);
  assert.ok(result.message.includes('【交易监控面板】'));
  assert.ok(result.message.includes(
    require('../formatters/beijingTime').formatBeijingTime(
      result.report.current.asOf
    )
  ));
  assert.strictEqual(
    result.message
      .split('\n')
      .filter((line) => line.startsWith('时间：'))
      .length,
    1
  );

  for (const forbidden of [
    'Stop',
    '仓位',
    '自动交易',
    '开仓',
    '下单',
  ]) {
    assert.strictEqual(
      result.message.includes(forbidden),
      false,
      forbidden
    );
  }
});

test('unchanged report state skips the webhook', async () => {
  const fiveMinute = createFiveMinuteBars(2400);
  const responses = {
    '4h': HtfContext.aggregateClosedKlines(
      fiveMinute,
      HtfContext.FOUR_HOURS
    ),
    '1h': HtfContext.aggregateClosedKlines(
      fiveMinute,
      HtfContext.ONE_HOUR
    ),
    '5m': fiveMinute,
  };
  const stateStore = NotificationState.createMemoryStore();
  const webhookCalls = [];
  const options = {
    currentTime:
      fiveMinute[fiveMinute.length - 1].closeTime + 1,
    webhookUrl: 'https://example.test/dingtalk-webhook',
    stateStore,
    marketData: {
      async getKlines(symbol, interval) {
        assert.strictEqual(symbol, 'BTCUSDT');
        return responses[interval];
      },
    },
    httpClient: {
      async post(url, message) {
        webhookCalls.push({ url, message });
        return { data: { errcode: 0 } };
      },
    },
  };

  const first = await NotifyRunner.run(options);
  const duplicate = await NotifyRunner.run(options);

  assert.strictEqual(first.sent, true);
  assert.strictEqual(duplicate.sent, false);
  assert.deepStrictEqual(duplicate.notification.reasons, []);
  assert.strictEqual(duplicate.message, null);
  assert.strictEqual(duplicate.payload, null);
  assert.strictEqual(webhookCalls.length, 1);
});

(async () => {
  for (const item of tests) {
    try {
      await item.callback();
      testsPassed += 1;
      console.log('PASS:', item.name);
    } catch (error) {
      console.error('FAIL:', item.name);
      throw error;
    }
  }
  console.log('\n' + testsPassed + ' tests passed.');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
