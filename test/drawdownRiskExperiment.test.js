var assert = require('assert');
var DrawdownRisk = require(
    '../backtest/drawdownRiskExperiment'
);
var PortfolioRisk = require(
    '../backtest/portfolioRiskExperiment'
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

test('回撤保护在5%和10%阈值按最保守档生效', function () {
    assert.strictEqual(DrawdownRisk.drawdownProtectionMultiplier(4.99), 1);
    assert.strictEqual(DrawdownRisk.drawdownProtectionMultiplier(5), 0.75);
    assert.strictEqual(DrawdownRisk.drawdownProtectionMultiplier(9.99), 0.75);
    assert.strictEqual(DrawdownRisk.drawdownProtectionMultiplier(10), 0.5);
});

test('连续亏损保护作用于下一笔并在盈利后恢复', function () {
    var rows = [];
    var index;
    for (index = 1; index <= 6; index++) {
        rows.push(sample(2020, index, 2, -1));
    }
    rows.push(sample(2020, 7, 2, 1));
    rows.push(sample(2020, 8, 2, 1));
    var result = DrawdownRisk.simulateModel(
        rows,
        'C',
        10000,
        [2020]
    );

    assert.deepStrictEqual(
        result.trades.map(function (trade) {
            return trade.protectionMultiplier;
        }),
        [1, 1, 1, 0.5, 0.5, 0.25, 0.25, 1]
    );
});

test('回撤模型使用交易前历史峰值且新高后恢复', function () {
    var rows = [
        sample(2020, 1, 2, -6),
        sample(2020, 2, 2, 20),
        sample(2020, 3, 2, 1)
    ];
    var result = DrawdownRisk.simulateModel(
        rows,
        'B',
        10000,
        [2020]
    );

    assert.deepStrictEqual(
        result.trades.map(function (trade) {
            return trade.protectionMultiplier;
        }),
        [1, 0.75, 1]
    );
    assert.strictEqual(result.trades[1].preTradeDrawdownPercent, 6);
});

test('模型A与上一轮固定Quality风险模型一致', function () {
    var rows = [
        sample(2020, 1, 0, -1),
        sample(2020, 2, 2, 2),
        sample(2021, 3, 3, 3)
    ];
    var current = DrawdownRisk.simulateModel(
        rows,
        'A',
        10000,
        [2020, 2021]
    );
    var previous = PortfolioRisk.simulateModel(
        rows,
        'B',
        10000,
        [2020, 2021]
    );

    assert.strictEqual(
        current.overall.endingBalance,
        previous.overall.endingBalance
    );
});

test('Recovery Factor和最长恢复交易数按权益路径计算', function () {
    var result = DrawdownRisk.simulateModel([
        sample(2020, 1, 2, -1),
        sample(2020, 2, 2, 2)
    ], 'A', 10000, [2020]);

    assert.strictEqual(result.overall.maxDrawdown, 100);
    assert.strictEqual(result.overall.longestRecoveryTrades, 2);
    assert.strictEqual(
        Math.abs(result.overall.recoveryFactor - 0.98) < 1e-12,
        true
    );
});

test('实验固定输出A到C且不修改交易样本', function () {
    var rows = [sample(2023, 1, 3, 2)];
    var before = JSON.stringify(rows);
    var result = DrawdownRisk.analyzeScoredSamples(rows);

    assert.deepStrictEqual(Object.keys(result.models), ['A', 'B', 'C']);
    assert.strictEqual(result.models.A.yearly.length, 7);
    assert.strictEqual(JSON.stringify(rows), before);
});

console.log('\n' + testsPassed + ' tests passed.');
