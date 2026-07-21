var assert = require('assert');
var Statistics = require('../backtest/statistics');

var testsPassed = 0;

function test(name, callback) {
    try {
        callback();
        testsPassed++;
        console.log('PASS:', name);
    } catch (error) {
        console.error('FAIL:', name);
        throw error;
    }
}

function createTrade(status, r, entryIndex, exitIndex) {
    return {
        type: 'LONG',
        status: status,
        entryIndex: entryIndex,
        exitIndex: exitIndex,
        r: r
    };
}

test('全胜', function () {
    var stats = Statistics.calculate([
        createTrade('WIN', 0.5, 0, 1),
        createTrade('WIN', 1.5, 2, 4),
        createTrade('WIN', 2.5, 5, 8),
        createTrade('WIN', 4, 9, 13)
    ]);

    assert.strictEqual(stats.total, 4);
    assert.strictEqual(stats.win, 4);
    assert.strictEqual(stats.loss, 0);
    assert.strictEqual(stats.winRate, 100);
    assert.strictEqual(stats.avgR, 2.125);
    assert.strictEqual(stats.expectancy, 2.125);
    assert.strictEqual(stats.maxWinR, 4);
    assert.strictEqual(stats.maxLossR, 0);
    assert.strictEqual(stats.avgHoldBars, 2.5);
    assert.strictEqual(stats.maxLosingStreak, 0);
    assert.deepStrictEqual(stats.rDistribution, {
        '0-1': 1,
        '1-2': 1,
        '2-3': 1,
        '3+': 1
    });
});

test('全亏', function () {
    var stats = Statistics.calculate([
        createTrade('LOSS', -1, 0, 2),
        createTrade('LOSS', -2, 3, 7)
    ]);

    assert.strictEqual(stats.total, 2);
    assert.strictEqual(stats.win, 0);
    assert.strictEqual(stats.loss, 2);
    assert.strictEqual(stats.winRate, 0);
    assert.strictEqual(stats.avgR, -1.5);
    assert.strictEqual(stats.expectancy, -1.5);
    assert.strictEqual(stats.maxWinR, 0);
    assert.strictEqual(stats.maxLossR, -2);
    assert.strictEqual(stats.avgHoldBars, 3);
    assert.strictEqual(stats.maxLosingStreak, 2);
    assert.deepStrictEqual(stats.rDistribution, {
        '0-1': 0,
        '1-2': 0,
        '2-3': 0,
        '3+': 0
    });
});

test('混合交易', function () {
    var stats = Statistics.calculate([
        createTrade('WIN', 2, 0, 2),
        createTrade('LOSS', -1, 3, 4),
        createTrade('OPEN', null, 5, null),
        createTrade('WIN', 0.5, 6, 9)
    ]);

    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.win, 2);
    assert.strictEqual(stats.loss, 1);
    assert.strictEqual(stats.winRate, 2 / 3 * 100);
    assert.strictEqual(stats.avgR, 0.5);
    assert.strictEqual(stats.expectancy, 0.5);
    assert.strictEqual(stats.maxWinR, 2);
    assert.strictEqual(stats.maxLossR, -1);
    assert.strictEqual(stats.avgHoldBars, 2);
    assert.strictEqual(stats.maxLosingStreak, 1);
    assert.deepStrictEqual(stats.rDistribution, {
        '0-1': 1,
        '1-2': 0,
        '2-3': 1,
        '3+': 0
    });
});

test('连续亏损', function () {
    var stats = Statistics.calculate([
        createTrade('WIN', 1, 0, 1),
        createTrade('LOSS', -1, 2, 3),
        createTrade('LOSS', -1, 4, 5),
        createTrade('LOSS', -1, 6, 7),
        createTrade('WIN', 1, 8, 9),
        createTrade('LOSS', -1, 10, 11)
    ]);

    assert.strictEqual(stats.maxLosingStreak, 3);
});

test('空数组', function () {
    assert.deepStrictEqual(Statistics.calculate([]), {
        total: 0,
        win: 0,
        loss: 0,
        winRate: 0,
        avgR: 0,
        expectancy: 0,
        maxWinR: 0,
        maxLossR: 0,
        avgHoldBars: 0,
        maxLosingStreak: 0,
        rDistribution: {
            '0-1': 0,
            '1-2': 0,
            '2-3': 0,
            '3+': 0
        }
    });
});

console.log('\n' + testsPassed + ' tests passed.');
