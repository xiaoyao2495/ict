var assert = require('assert');
var WalkForward = require(
    '../backtest/setupFeatureWalkForwardExperiment'
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

function sample(year, index, body, structure, fvg, r) {
    return {
        year: year,
        entryIndex: index,
        status: r > 0 ? 'WIN' : 'LOSS',
        r: r,
        featureBuckets: {
            bodyRatio: body,
            h1Structure: structure,
            fvgSizePercent: fvg
        }
    };
}

function fixture() {
    return [
        sample(2020, 1, '0.60-0.70', 'BEARISH_BOS', '<0.025%', 2),
        sample(2021, 2, '0.70-0.80', 'BEARISH_BOS', '<0.025%', -1),
        sample(2022, 3, '0.60-0.70', 'BULLISH_BOS', '0.10%+', 1),
        sample(2023, 4, '0.60-0.70', 'BEARISH_BOS', '<0.025%', -1),
        sample(2024, 5, '0.70-0.80', 'BEARISH_BOS', '<0.025%', 3),
        sample(2025, 6, '0.60-0.70', 'BULLISH_BOS', '<0.025%', 2),
        sample(2026, 7, '0.60-0.70', 'BEARISH_BOS', '0.10%+', -1)
    ];
}

test('Walk-forward folds严格按指定扩展训练窗口', function () {
    assert.deepStrictEqual(
        WalkForward.FOLDS.map(function (fold) {
            return {
                trainingYears: fold.trainingYears,
                testYear: fold.testYear
            };
        }),
        [
            { trainingYears: [2020, 2021, 2022], testYear: 2023 },
            { trainingYears: [2020, 2021, 2022, 2023], testYear: 2024 },
            { trainingYears: [2020, 2021, 2022, 2023, 2024], testYear: 2025 },
            { trainingYears: [2020, 2021, 2022, 2023, 2024, 2025], testYear: 2026 }
        ]
    );
});

test('A-D规则只读取预先冻结的Feature桶', function () {
    var samples = fixture();

    assert.strictEqual(
        WalkForward.evaluateRule(WalkForward.RULES.A, samples).length,
        5
    );
    assert.strictEqual(
        WalkForward.evaluateRule(WalkForward.RULES.B, samples).length,
        5
    );
    assert.strictEqual(
        WalkForward.evaluateRule(WalkForward.RULES.C, samples).length,
        5
    );
    assert.strictEqual(
        WalkForward.evaluateRule(WalkForward.RULES.D, samples).length,
        3
    );
});

test('每个Fold训练与测试样本完全隔离', function () {
    var samples = fixture();
    var result = WalkForward.evaluateFold(
        samples,
        WalkForward.FOLDS[0]
    );

    assert.deepStrictEqual(result.trainingYears, [2020, 2021, 2022]);
    assert.strictEqual(result.testYear, 2023);
    assert.strictEqual(result.trainingUniverse.trades, 3);
    assert.strictEqual(result.testUniverse.trades, 1);
    Object.keys(result.rules).forEach(function (key) {
        result.rules[key].trainingSampleIndexes.forEach(function (index) {
            assert.notStrictEqual(index, 4);
        });
        result.rules[key].testSampleIndexes.forEach(function (index) {
            assert.strictEqual(index, 4);
        });
    });
});

test('OOS汇总每个测试年份只计算一次且不修改样本', function () {
    var samples = fixture();
    var before = JSON.stringify(samples);
    var result = WalkForward.summarizeOutOfSample(
        samples,
        WalkForward.FOLDS
    );

    assert.deepStrictEqual(
        result.A.yearly.map(function (row) { return row.year; }),
        [2023, 2024, 2025, 2026]
    );
    assert.strictEqual(result.A.combined.trades, 3);
    assert.strictEqual(result.B.combined.trades, 3);
    assert.strictEqual(result.C.combined.trades, 3);
    assert.strictEqual(result.D.combined.trades, 2);
    assert.strictEqual(JSON.stringify(samples), before);
});

console.log('\n' + testsPassed + ' tests passed.');
