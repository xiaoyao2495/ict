'use strict';

const assert = require('assert');
const HtfContext = require('../indicators/htfContextAnalyzer');
const Runner = require('../scripts/runAnalystReport');

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

test('closed Kline filter removes invalid and unfinished bars', () => {
  const bars = createFiveMinuteBars(3);
  const currentTime = bars[1].closeTime + 1;
  const filtered = Runner.filterClosedKlines([
    bars[0],
    bars[1],
    bars[2],
    { openTime: NaN },
  ], currentTime);

  assert.deepStrictEqual(filtered, [bars[0], bars[1]]);
});

test('Klines flow through Report and Formatter to Chinese text', async () => {
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
  const calls = [];
  const output = [];
  const result = await Runner.run({
    currentTime,
    marketData: {
      async getKlines(symbol, interval, limit) {
        calls.push({ symbol, interval, limit });
        return responses[interval];
      },
    },
    output(message) {
      output.push(message);
    },
  });

  assert.deepStrictEqual(
    calls.map((call) => call.interval).sort(),
    ['1h', '4h', '5m']
  );
  assert.ok(calls.every(
    (call) => call.symbol === 'BTCUSDT'
  ));
  assert.strictEqual(result.klines.h4Klines.length, fourHour.length);
  assert.strictEqual(result.klines.h1Klines.length, oneHour.length);
  assert.strictEqual(
    result.klines.ltf5mKlines.length,
    fiveMinute.length
  );
  assert.strictEqual(
    result.report.current.asOf,
    fiveMinute[fiveMinute.length - 1].closeTime
  );
  assert.strictEqual(
    result.report.source.to,
    fiveMinute[fiveMinute.length - 1].closeTime
  );
  assert.strictEqual(result.report.source.h4Klines, fourHour.length);
  assert.strictEqual(result.report.source.h1Klines, oneHour.length);
  assert.strictEqual(
    result.report.source.ltf5mKlines,
    fiveMinute.length
  );
  assert.strictEqual(output.length, 1);
  assert.strictEqual(output[0], result.message);
  assert.ok(result.message.includes('【ICT市场分析】'));
  assert.ok(result.message.includes('【交易监控面板】'));
  assert.ok(result.message.includes('① 【HTF】'));
  assert.ok(result.message.includes('② 【Entry Watch】'));
  assert.ok(result.message.includes('③ 【Event Chain】'));
  assert.ok(result.message.includes('④ 【Primary Draw】'));
  assert.strictEqual(typeof result.message, 'string');

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
