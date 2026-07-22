var assert = require('assert');
var Experiment = require(
    '../backtest/qualityRiskWalkForwardExperiment'
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

function fixture() {
    return [
        sample(2020, 1, 0, 1),
        sample(2021, 2, 1, -1),
        sample(2022, 3, 2, 2),
        sample(2023, 4, 0, -1),
        sample(2023, 5, 2, -1),
        sample(2023, 6, 1, -1),
        sample(2023, 7, 3, 4),
        sample(2024, 8, 1, 2),
        sample(2025, 9, 2, -1),
        sample(2026, 10, 3, 2)
    ];
}

test('严格使用指定四个扩展训练和测试窗口', function () {
    assert.deepStrictEqual(
        Experiment.FOLDS.map(function (fold) {
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

test('Original A C的R使用固定风险且C只保护低质量', function () {
    var result = Experiment.evaluateTestYear(
        fixture().filter(function (row) { return row.year === 2023; }),
        2023
    );

    assert.strictEqual(result.originalR, 1);
    assert.strictEqual(result.modelAR, 3);
    assert.strictEqual(result.modelCR, 3.25);
    assert.strictEqual(result.portfolios.C.protectionTriggers, 1);
    assert.deepStrictEqual(
        result.modelCTradeAudit.map(function (row) {
            return row.protectionMultiplier;
        }),
        [1, 1, 0.5, 1]
    );
});

test('Score至少2在连续亏损后仍保持原风险', function () {
    var result = Experiment.evaluateTestYear([
        sample(2023, 1, 0, -1),
        sample(2023, 2, 0, -1),
        sample(2023, 3, 2, -1),
        sample(2023, 4, 3, -1)
    ], 2023);

    assert.strictEqual(result.modelCTradeAudit[2].appliedRiskR, 1);
    assert.strictEqual(result.modelCTradeAudit[3].appliedRiskR, 1.25);
    assert.strictEqual(result.portfolios.C.protectionTriggers, 0);
});

test('训练测试样本完全隔离且训练结果不进入资金曲线', function () {
    var fold = Experiment.evaluateFold(
        fixture(),
        Experiment.FOLDS[0]
    );

    assert.strictEqual(fold.trainingTrades, 3);
    assert.strictEqual(fold.result.trades, 4);
    fold.testEntryIndexes.forEach(function (index) {
        assert.strictEqual(fold.trainingEntryIndexes.indexOf(index), -1);
    });
    assert.strictEqual(
        fold.result.portfolios.A.endingBalance,
        Experiment.evaluateTestYear(
            fixture().filter(function (row) { return row.year === 2023; }),
            2023
        ).portfolios.A.endingBalance
    );
});

test('每个测试年独立从10000和零连续亏损状态开始', function () {
    var rows = [
        sample(2023, 1, 0, -1),
        sample(2023, 2, 0, -1),
        sample(2024, 3, 0, -1)
    ];
    var result = Experiment.analyzeScoredSamples(rows);
    var year2024 = result.folds[1].result;

    assert.strictEqual(
        year2024.modelCTradeAudit[0].preTradeConsecutiveLosses,
        0
    );
    assert.strictEqual(
        year2024.portfolios.ORIGINAL.endingBalance,
        9900
    );
});

test('实验不修改样本也不包含参数调优', function () {
    var rows = fixture();
    var before = JSON.stringify(rows);
    var result = Experiment.analyzeScoredSamples(rows);

    assert.strictEqual(result.protocol.parameterTuning, false);
    assert.strictEqual(result.protocol.thresholdChanges, false);
    assert.strictEqual(JSON.stringify(rows), before);
});

console.log('\n' + testsPassed + ' tests passed.');
