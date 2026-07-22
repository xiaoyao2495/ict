var assert = require('assert');
var Experiment = require(
    '../backtest/portfolioRiskWalkForwardExperiment'
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

function sample(year, index, score, originalStatus, netR) {
    return {
        year: year,
        entryIndex: index,
        setupIndex: index - 1,
        qualityScore: score,
        originalStatus: originalStatus,
        netStatus: netR > 0 ? 'WIN' : 'LOSS',
        netR: netR
    };
}

test('回撤缩放严格使用5 10 15百分比固定边界', function () {
    assert.strictEqual(Experiment.drawdownScale(4.99), 1);
    assert.strictEqual(Experiment.drawdownScale(5), 0.75);
    assert.strictEqual(Experiment.drawdownScale(10), 0.5);
    assert.strictEqual(Experiment.drawdownScale(15), 0.5);
    assert.strictEqual(Experiment.drawdownScale(15.01), 0.25);
});

test('C将Quality Risk C单笔风险限制为1R', function () {
    var uncapped = Experiment.modelRisk('B', 3, 0, 0);
    var capped = Experiment.modelRisk('C', 3, 0, 0);

    assert.strictEqual(uncapped.appliedRiskR, 1.25);
    assert.strictEqual(capped.qualityRiskR, 1.25);
    assert.strictEqual(capped.cappedRiskR, 1);
    assert.strictEqual(capped.appliedRiskR, 1);
});

test('D在C的1R上限之后应用账户回撤缩放', function () {
    assert.strictEqual(
        Experiment.modelRisk('D', 3, 0, 7).appliedRiskR,
        0.75
    );
    assert.strictEqual(
        Experiment.modelRisk('D', 2, 0, 12).appliedRiskR,
        0.5
    );
    assert.strictEqual(
        Experiment.modelRisk('D', 0, 2, 16).appliedRiskR,
        0.0625
    );
});

test('D只读取每笔交易前历史峰值回撤并在新高后恢复', function () {
    var rows = [
        sample(2020, 1, 2, 'LOSS', -6),
        sample(2020, 2, 2, 'WIN', 20),
        sample(2020, 3, 2, 'WIN', 1)
    ];
    var result = Experiment.simulateModel(
        rows,
        'D',
        10000,
        [2020]
    );

    assert.deepStrictEqual(
        result.trades.map(function (trade) {
            return trade.drawdownScale;
        }),
        [1, 0.75, 1]
    );
});

test('资金状态跨年度连续且年度余额正确承接', function () {
    var result = Experiment.simulateModel([
        sample(2020, 1, 2, 'WIN', 1),
        sample(2021, 2, 2, 'LOSS', -1)
    ], 'A', 10000, [2020, 2021]);

    assert.strictEqual(result.yearly[0].endingBalance, 10100);
    assert.strictEqual(result.yearly[1].startingBalance, 10100);
    assert.strictEqual(result.yearly[1].endingBalance, 9999);
});

test('实验固定输出A到D且不修改成本后样本', function () {
    var rows = [sample(2023, 1, 3, 'WIN', 2)];
    var before = JSON.stringify(rows);
    var result = Experiment.analyzeCostSamples(rows);

    assert.deepStrictEqual(Object.keys(result.models), ['A', 'B', 'C', 'D']);
    assert.strictEqual(result.protocol.parameterTuning, false);
    assert.strictEqual(JSON.stringify(rows), before);
});

console.log('\n' + testsPassed + ' tests passed.');
