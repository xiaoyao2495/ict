var assert = require('assert');
var QualityScoreExperiment = require(
    '../backtest/qualityScoreExperiment'
);
var WalkForward = require(
    '../backtest/qualityScoreWalkForwardExperiment'
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
        setupIndex: index - 1,
        qualityScore: score,
        status: r > 0 ? 'WIN' : 'LOSS',
        r: r
    };
}

function fixture() {
    return [
        sample(2020, 1, 0, -1),
        sample(2021, 2, 1, 2),
        sample(2022, 3, 2, -1),
        sample(2023, 4, 3, 2),
        sample(2023, 5, 1, -1),
        sample(2024, 6, 4, -1),
        sample(2025, 7, 2, 3),
        sample(2026, 8, 5, 2)
    ];
}

test('Walk-forward年份严格使用指定扩展训练窗口', function () {
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

test('Score 3到5只合并为3+且固定输出四组', function () {
    var result = WalkForward.summarizeScoreGroups(fixture());

    assert.deepStrictEqual(Object.keys(result), ['0', '1', '2', '3+']);
    assert.strictEqual(result['0'].trades, 1);
    assert.strictEqual(result['1'].trades, 2);
    assert.strictEqual(result['2'].trades, 2);
    assert.strictEqual(result['3+'].trades, 3);
    assert.strictEqual(WalkForward.scoreGroup(5), '3+');
});

test('每个Fold训练测试完全隔离且测试年只出现一次', function () {
    var rows = fixture();
    var result = WalkForward.analyzeScoredSamples(rows);
    var seen = [];

    result.folds.forEach(function (fold) {
        fold.testEntryIndexes.forEach(function (index) {
            assert.strictEqual(
                fold.trainingEntryIndexes.indexOf(index),
                -1
            );
            seen.push(index);
        });
    });
    assert.deepStrictEqual(seen.sort(function (a, b) {
        return a - b;
    }), [4, 5, 6, 7, 8]);
    assert.strictEqual(result.outOfSample.total.trades, 5);
});

test('测试年仓位模拟复用固定Score阈值并重算回撤', function () {
    var fold = WalkForward.evaluateFold(
        fixture(),
        WalkForward.FOLDS[0]
    );
    var sizing = fold.test.positionSizing;

    assert.strictEqual(sizing.highScoreTrades, 1);
    assert.strictEqual(sizing.otherTrades, 1);
    assert.strictEqual(sizing.originalR, 1);
    assert.strictEqual(sizing.weightedR, 2);
    assert.strictEqual(sizing.rChange, 1);
    assert.strictEqual(sizing.originalMaxDrawdownR, 1);
    assert.strictEqual(sizing.weightedMaxDrawdownR, 1);
});

test('评分实现直接复用qualityScore且不修改样本', function () {
    var source = {
        entryIndex: 1,
        status: 'WIN',
        r: 2,
        h1Structure: 'BEARISH_BOS',
        features: {
            bodyRatio: 0.65,
            fvgSizePercent: 0.02,
            setupAgeBars: 3,
            volatilityState: 'EXPANSION'
        }
    };
    var before = JSON.stringify(source);
    var scored = QualityScoreExperiment.scoreSample(source);

    assert.strictEqual(scored.qualityScore, 5);
    assert.strictEqual(JSON.stringify(source), before);
});

console.log('\n' + testsPassed + ' tests passed.');
