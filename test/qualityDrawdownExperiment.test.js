var assert = require('assert');
var QualityDrawdown = require(
    '../backtest/qualityDrawdownExperiment'
);
var DrawdownRisk = require(
    '../backtest/drawdownRiskExperiment'
);

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

function sample(year, index, score, r) {
    return {
        year: year,
        entryIndex: index,
        qualityScore: score,
        status: r > 0 ? 'WIN' : 'LOSS',
        r: r
    };
}

test('A固定风险且B保持连续3亏5亏保护', function () {
    assert.strictEqual(QualityDrawdown.protectionMultiplier('A', 0, 6), 1);
    assert.strictEqual(QualityDrawdown.protectionMultiplier('B', 2, 2), 1);
    assert.strictEqual(QualityDrawdown.protectionMultiplier('B', 2, 3), 0.5);
    assert.strictEqual(QualityDrawdown.protectionMultiplier('B', 2, 5), 0.25);
});

test('C只降低连续2亏后的Score0到1交易', function () {
    assert.strictEqual(QualityDrawdown.protectionMultiplier('C', 1, 1), 1);
    assert.strictEqual(QualityDrawdown.protectionMultiplier('C', 1, 2), 0.5);
    assert.strictEqual(QualityDrawdown.protectionMultiplier('C', 0, 5), 0.5);
    assert.strictEqual(QualityDrawdown.protectionMultiplier('C', 2, 5), 1);
    assert.strictEqual(QualityDrawdown.protectionMultiplier('C', 3, 5), 1);
});

test('模型B与drawdownRisk连续亏损模型逐笔一致', function () {
    var rows = [
        sample(2020, 1, 0, -1),
        sample(2020, 2, 2, -1),
        sample(2020, 3, 3, -1),
        sample(2020, 4, 1, -1),
        sample(2021, 5, 3, 3)
    ];
    var current = QualityDrawdown.simulateModel(
        rows,
        'B',
        10000,
        [2020, 2021]
    );
    var previous = DrawdownRisk.simulateModel(
        rows,
        'C',
        10000,
        [2020, 2021]
    );

    assert.strictEqual(
        current.overall.endingBalance,
        previous.overall.endingBalance
    );
    assert.deepStrictEqual(
        current.trades.map(function (trade) {
            return trade.protectionMultiplier;
        }),
        previous.trades.map(function (trade) {
            return trade.protectionMultiplier;
        })
    );
});

test('Score分组贡献之和等于实际净利润', function () {
    var result = QualityDrawdown.simulateModel([
        sample(2020, 1, 0, -1),
        sample(2020, 2, 2, 2),
        sample(2020, 3, 3, 3)
    ], 'C', 10000, [2020]);
    var contributions = result.overall.scoreContributions;
    var sum = Object.keys(contributions).reduce(function (total, key) {
        return total + contributions[key].netPnl;
    }, 0);

    assert.strictEqual(
        Math.abs(sum - (result.overall.endingBalance - 10000)) < 1e-12,
        true
    );
    assert.deepStrictEqual(
        Object.keys(contributions).sort(),
        ['0-1', '2', '3+'].sort()
    );
});

test('最长连续亏损按交易结果计算且不受仓位影响', function () {
    var rows = [
        sample(2020, 1, 0, -1),
        sample(2020, 2, 0, -1),
        sample(2020, 3, 3, 2),
        sample(2020, 4, 2, -1),
        sample(2020, 5, 2, -1),
        sample(2020, 6, 2, -1)
    ];
    var result = QualityDrawdown.analyzeScoredSamples(rows);

    assert.strictEqual(QualityDrawdown.maxLosingStreak(rows), 3);
    assert.strictEqual(result.models.A.overall.maxLosingStreak, 3);
    assert.strictEqual(result.models.B.overall.maxLosingStreak, 3);
    assert.strictEqual(result.models.C.overall.maxLosingStreak, 3);
});

test('实验只处理交易副本且固定输出2020到2026', function () {
    var rows = [sample(2023, 1, 1, 2)];
    var before = JSON.stringify(rows);
    var result = QualityDrawdown.analyzeScoredSamples(rows);

    assert.deepStrictEqual(Object.keys(result.models), ['A', 'B', 'C']);
    assert.deepStrictEqual(
        result.models.C.yearly.map(function (row) { return row.year; }),
        [2020, 2021, 2022, 2023, 2024, 2025, 2026]
    );
    assert.strictEqual(JSON.stringify(rows), before);
});

console.log('\n' + testsPassed + ' tests passed.');
