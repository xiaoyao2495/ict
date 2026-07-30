'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Aggregator = require(
  '../history/ictPerformanceReportAggregator'
);
const Formatter = require(
  '../formatters/ictPerformanceReportFormatter'
);
const OutcomeTracker = require(
  '../history/ictOpportunityOutcomeTracker'
);
const Generator = require(
  '../scripts/generateIctPerformanceReport'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function confirmed(symbol, direction, type, price, time) {
  return {
    symbol,
    h4Bias: direction,
    direction,
    liquidityType: type,
    liquidityPrice: price,
    status: 'CONFIRMED',
    changedAt: time,
  };
}

function fixture() {
  const events = [
    confirmed(
      'BTCUSDT',
      'BULLISH',
      'PDL',
      99,
      '2026-07-30T00:00:00Z'
    ),
    confirmed(
      'ETHUSDT',
      'BEARISH',
      'PDH',
      201,
      '2026-07-30T01:00:00Z'
    ),
    confirmed(
      'SOLUSDT',
      'BULLISH',
      'EQUAL_LOW',
      49,
      '2026-07-30T02:00:00Z'
    ),
  ];
  const symbols = {};
  for (const event of events) {
    symbols[event.symbol] = {
      current: event,
      transitions: [event],
    };
  }
  const outcome = (event, values) => ({
    id: OutcomeTracker.eventId({
      symbol: event.symbol,
      confirmedAt: new Date(
        event.changedAt
      ).toISOString(),
      direction: event.direction,
      liquidityType: event.liquidityType,
      liquidityPrice: event.liquidityPrice,
    }),
    symbol: event.symbol,
    confirmedAt: new Date(
      event.changedAt
    ).toISOString(),
    direction: event.direction,
    liquidityType: event.liquidityType,
    liquidityPrice: event.liquidityPrice,
    entryNearbyPrice: values.entryNearbyPrice,
    riskUnit: values.riskUnit,
    oneRAt: values.oneRAt || null,
    twoRAt: values.twoRAt || null,
    threeRAt: values.threeRAt || null,
    failed: Boolean(values.failed),
    failedAt: values.failedAt || null,
    trackingStatus: values.trackingStatus,
  });
  return {
    history: { version: 1, symbols },
    statisticsText:
      'ICT Opportunity Statistics\n总机会数量：3\n',
    outcomeState: {
      version: 1,
      outcomes: [
        outcome(events[0], {
          entryNearbyPrice: 100,
          riskUnit: 1,
          oneRAt: '2026-07-30T00:10:00Z',
          twoRAt: '2026-07-30T00:20:00Z',
          threeRAt: '2026-07-30T00:30:00Z',
          trackingStatus: 'COMPLETED',
        }),
        outcome(events[1], {
          entryNearbyPrice: 200,
          riskUnit: 1,
          oneRAt: '2026-07-30T01:20:00Z',
          failed: true,
          failedAt: '2026-07-30T01:30:00Z',
          trackingStatus: 'FAILED',
        }),
        outcome(events[2], {
          entryNearbyPrice: null,
          riskUnit: null,
          trackingStatus: 'AWAITING_REFERENCE_PRICE',
        }),
      ],
    },
  };
}

function cohort(items, label) {
  return items.find((item) => item.label === label);
}

test('aggregates coverage without mutating inputs', () => {
  const input = fixture();
  const snapshot = JSON.stringify(input);
  const report = Aggregator.aggregate(input);

  assert.strictEqual(report.coverage.symbolCount, 3);
  assert.strictEqual(report.coverage.transitionCount, 3);
  assert.strictEqual(
    report.coverage.statusCounts.CONFIRMED,
    3
  );
  assert.strictEqual(report.confirmedEventCount, 3);
  assert.strictEqual(JSON.stringify(input), snapshot);
});

test('aggregates R outcomes and elapsed times', () => {
  const report = Aggregator.aggregate(fixture());

  assert.strictEqual(report.overall.outcomeCount, 3);
  assert.strictEqual(report.overall.eligibleCount, 2);
  assert.strictEqual(report.overall.oneRCount, 2);
  assert.strictEqual(report.overall.oneRRate, 1);
  assert.strictEqual(report.overall.twoRRate, 0.5);
  assert.strictEqual(report.overall.threeRRate, 0.5);
  assert.strictEqual(report.overall.failedRate, 0.5);
  assert.strictEqual(report.overall.averageMinutesToOneR, 15);
});

test('groups performance by symbol direction and liquidity', () => {
  const report = Aggregator.aggregate(fixture());

  assert.strictEqual(
    cohort(report.bySymbol, 'BTCUSDT').threeRRate,
    1
  );
  assert.strictEqual(
    cohort(report.byDirection, 'BEARISH').failedRate,
    1
  );
  assert.strictEqual(
    cohort(report.byLiquidityType, 'EQUAL_LOW')
      .eligibleCount,
    0
  );
});

test('formatter includes statistics input and outcome sections', () => {
  const report = Aggregator.aggregate(fixture());
  const text = Formatter.format(report, {
    generatedAt: '2026-07-30T00:00:00Z',
  });

  assert(text.includes('ICT Performance Report'));
  assert(text.includes('总机会数量：3'));
  assert(text.includes('3. CONFIRMED后市场表现'));
  assert(text.includes('- +1R：2（100.00%）'));
  assert(text.includes('5. 按Symbol'));
  assert(text.includes('7. 按流动性类型'));
  assert(text.includes('8. 数据一致性'));
  assert(text.includes('2026-07-30 08:00:00'));
});

test('generator reads three inputs and writes performance report', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-performance-report-')
  );
  const historyPath = path.join(directory, 'history.json');
  const statisticsPath = path.join(
    directory,
    'statistics.txt'
  );
  const outcomePath = path.join(directory, 'outcome.json');
  const outputPath = path.join(directory, 'performance.txt');
  const input = fixture();

  try {
    await Promise.all([
      fs.writeFile(
        historyPath,
        JSON.stringify(input.history),
        'utf8'
      ),
      fs.writeFile(
        statisticsPath,
        input.statisticsText,
        'utf8'
      ),
      fs.writeFile(
        outcomePath,
        JSON.stringify(input.outcomeState),
        'utf8'
      ),
    ]);
    const result =
      await Generator.generateIctPerformanceReport({
        historyPath,
        statisticsPath,
        outcomePath,
        outputPath,
        generatedAt: '2026-07-30T00:00:00Z',
      });
    const saved = await fs.readFile(outputPath, 'utf8');

    assert.strictEqual(result.outputPath, outputPath);
    assert.strictEqual(saved, result.text);
    assert.strictEqual(
      result.report.overall.eligibleCount,
      2
    );
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true,
    });
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
