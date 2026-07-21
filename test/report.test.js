var assert = require('assert');
var Statistics = require('../backtest/statistics');
var Report = require('../backtest/report');

function test(name, callback) {
    try {
        callback();
        console.log('PASS: ' + name);
    } catch (error) {
        console.error('FAIL: ' + name);
        throw error;
    }
}

function almostEqual(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 0.000001);
}

test('生成总体、多空、UTC 小时和 reasons 分组数据', function () {
    var trades = [
        {
            type: 'LONG',
            status: 'WIN',
            r: 2,
            entryIndex: 1,
            exitIndex: 3,
            entryTime: '2026-07-21T03:05:00.000Z',
            reasons: ['SELL_SIDE_SWEEP', 'BULLISH_MSS']
        },
        {
            type: 'LONG',
            status: 'LOSS',
            r: -1,
            entryIndex: 4,
            exitIndex: 7,
            entryTime: '2026-07-21T03:55:00.000Z',
            reasons: ['SELL_SIDE_SWEEP', 'BULLISH_MSS']
        },
        {
            type: 'SHORT',
            status: 'WIN',
            r: 3,
            entryIndex: 8,
            exitIndex: 9,
            entryTime: '2026-07-21T18:00:00.000Z',
            reasons: ['BUY_SIDE_SWEEP', 'BEARISH_MSS']
        },
        {
            type: 'SHORT',
            status: 'OPEN',
            r: null,
            entryTime: '2026-07-21T20:00:00.000Z',
            reasons: ['IGNORED']
        }
    ];
    var statistics = Statistics.calculate(trades);
    var result = Report.generate(trades, statistics);

    assert.strictEqual(result.overall, statistics);
    assert.strictEqual(result.overall.total, 3);
    assert.strictEqual(result.long.total, 2);
    assert.strictEqual(result.long.win, 1);
    assert.strictEqual(result.short.total, 1);
    assert.strictEqual(result.short.winRate, 100);

    assert.strictEqual(result.byUtcHour.length, 2);
    assert.strictEqual(result.byUtcHour[0].hour, 3);
    assert.strictEqual(result.byUtcHour[0].trades, 2);
    assert.strictEqual(result.byUtcHour[0].winRate, 50);
    almostEqual(result.byUtcHour[0].avgR, 0.5);
    assert.strictEqual(result.byUtcHour[1].hour, 18);
    assert.strictEqual(result.byUtcHour[1].trades, 1);
    assert.strictEqual(result.byUtcHour[1].avgR, 3);

    assert.strictEqual(result.bySetupReasons.length, 2);
    assert.strictEqual(
        result.bySetupReasons[0].reasons,
        'BUY_SIDE_SWEEP -> BEARISH_MSS'
    );
    assert.strictEqual(result.bySetupReasons[0].trades, 1);
    assert.strictEqual(
        result.bySetupReasons[1].reasons,
        'SELL_SIDE_SWEEP -> BULLISH_MSS'
    );
    assert.strictEqual(result.bySetupReasons[1].trades, 2);
    assert.strictEqual(result.bySetupReasons[1].winRate, 50);
    almostEqual(result.bySetupReasons[1].avgR, 0.5);
});

test('文本报告包含所有统计区段', function () {
    var result = Report.generate([], Statistics.calculate([]));
    var text = Report.formatText(result);

    assert.ok(text.indexOf('OVERALL') !== -1);
    assert.ok(text.indexOf('LONG') !== -1);
    assert.ok(text.indexOf('SHORT') !== -1);
    assert.ok(text.indexOf('BY UTC HOUR') !== -1);
    assert.ok(text.indexOf('BY SETUP REASONS') !== -1);
});

console.log('\n2 tests passed.');
