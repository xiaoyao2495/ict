var assert = require('assert');
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

test('A B C严格使用固定Score风险倍数', function () {
    assert.strictEqual(PortfolioRisk.riskMultiplier('A', 0), 1);
    assert.strictEqual(PortfolioRisk.riskMultiplier('A', 5), 1);
    assert.strictEqual(PortfolioRisk.riskMultiplier('B', 1), 0.5);
    assert.strictEqual(PortfolioRisk.riskMultiplier('B', 2), 1);
    assert.strictEqual(PortfolioRisk.riskMultiplier('B', 3), 1.25);
    assert.strictEqual(PortfolioRisk.riskMultiplier('C', 1), 0.5);
    assert.strictEqual(PortfolioRisk.riskMultiplier('C', 2), 1);
    assert.strictEqual(PortfolioRisk.riskMultiplier('C', 5), 1.5);
    assert.throws(function () {
        PortfolioRisk.riskMultiplier('UNKNOWN', 2);
    });
});

test('余额按交易前权益的1%风险逐笔复利并跨年承接', function () {
    var result = PortfolioRisk.simulateModel([
        sample(2020, 1, 0, 1),
        sample(2020, 2, 0, -1),
        sample(2021, 3, 0, 2)
    ], 'A', 10000, [2020, 2021]);

    assert.strictEqual(result.yearly[0].startingBalance, 10000);
    assert.strictEqual(result.yearly[0].endingBalance, 9999);
    assert.strictEqual(result.yearly[0].maxDrawdown, 101);
    assert.strictEqual(result.yearly[0].maxDrawdownPercent, 1);
    assert.strictEqual(result.yearly[0].sharpe, 0);
    assert.strictEqual(result.yearly[0].profitFactor, 100 / 101);
    assert.strictEqual(result.yearly[1].startingBalance, 9999);
    assert.strictEqual(result.yearly[1].endingBalance, 10198.98);
});

test('风险模型只改变资金风险不改变交易胜负', function () {
    var rows = [
        sample(2020, 1, 0, -1),
        sample(2020, 2, 2, 1),
        sample(2020, 3, 3, 2)
    ];
    var a = PortfolioRisk.simulateModel(rows, 'A', 10000, [2020]);
    var b = PortfolioRisk.simulateModel(rows, 'B', 10000, [2020]);
    var c = PortfolioRisk.simulateModel(rows, 'C', 10000, [2020]);

    assert.strictEqual(a.overall.trades, 3);
    assert.strictEqual(b.overall.trades, 3);
    assert.strictEqual(c.overall.trades, 3);
    assert.strictEqual(a.overall.winRate, 2 / 3);
    assert.strictEqual(b.overall.winRate, 2 / 3);
    assert.strictEqual(c.overall.winRate, 2 / 3);
    assert.strictEqual(c.overall.endingBalance > b.overall.endingBalance, true);
    assert.strictEqual(b.overall.endingBalance > a.overall.endingBalance, true);
});

test('年度固定输出2020到2026并保留无交易年份', function () {
    var source = [sample(2023, 1, 3, 2)];
    var before = JSON.stringify(source);
    var result = PortfolioRisk.analyzeScoredSamples(source);

    assert.deepStrictEqual(
        result.models.A.yearly.map(function (row) {
            return row.year;
        }),
        [2020, 2021, 2022, 2023, 2024, 2025, 2026]
    );
    assert.strictEqual(result.models.A.yearly[0].trades, 0);
    assert.strictEqual(result.models.A.yearly[3].trades, 1);
    assert.strictEqual(
        Math.abs(result.models.B.yearly[3].returnPercent - 2.5) < 1e-12,
        true
    );
    assert.strictEqual(
        Math.abs(result.models.C.yearly[3].returnPercent - 3) < 1e-12,
        true
    );
    assert.strictEqual(JSON.stringify(source), before);
});

console.log('\n' + testsPassed + ' tests passed.');
