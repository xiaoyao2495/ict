var assert = require('assert');
var TradingCost = require(
    '../backtest/tradingCostExperiment'
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

function sample(index, direction, score, status, prices) {
    return {
        year: 2020,
        entryIndex: index,
        setupIndex: index - 1,
        direction: direction,
        qualityScore: score,
        status: status,
        originalStatus: status,
        r: prices.r,
        originalR: prices.r,
        entryPrice: prices.entry,
        stopPrice: prices.stop,
        exitPrice: prices.exit
    };
}

test('零成本零滑点严格还原LONG和SHORT原始R', function () {
    var longTrade = sample(1, 'LONG', 2, 'WIN', {
        entry: 100, stop: 99, exit: 102, r: 2
    });
    var shortTrade = sample(2, 'SHORT', 2, 'WIN', {
        entry: 100, stop: 101, exit: 98, r: 2
    });

    assert.strictEqual(
        TradingCost.calculateAdjustedTrade(longTrade, 0, 0).netR,
        2
    );
    assert.strictEqual(
        TradingCost.calculateAdjustedTrade(shortTrade, 0, 0).netR,
        2
    );
});

test('手续费双边收取且滑点对LONG和SHORT均为不利方向', function () {
    var longTrade = sample(1, 'LONG', 2, 'WIN', {
        entry: 100, stop: 99, exit: 102, r: 2
    });
    var shortTrade = sample(2, 'SHORT', 2, 'WIN', {
        entry: 100, stop: 101, exit: 98, r: 2
    });
    var longCost = TradingCost.calculateAdjustedTrade(
        longTrade,
        0.0005,
        0.0001
    );
    var shortCost = TradingCost.calculateAdjustedTrade(
        shortTrade,
        0.0005,
        0.0001
    );

    assert.strictEqual(longCost.adjustedEntryPrice > 100, true);
    assert.strictEqual(longCost.adjustedExitPrice < 102, true);
    assert.strictEqual(shortCost.adjustedEntryPrice < 100, true);
    assert.strictEqual(shortCost.adjustedExitPrice > 98, true);
    assert.strictEqual(longCost.feesPerUnit > 0, true);
    assert.strictEqual(longCost.netR < 2, true);
    assert.strictEqual(shortCost.netR < 2, true);
});

test('完整生成三种成本三种滑点和两个风险模型', function () {
    var rows = [sample(1, 'LONG', 2, 'WIN', {
        entry: 100, stop: 99, exit: 102, r: 2
    })];
    var result = TradingCost.analyzeExecutionSamples(rows);

    assert.strictEqual(result.scenarios.BASELINE.length, 9);
    assert.strictEqual(result.scenarios.QUALITY_RISK_C.length, 9);
    assert.deepStrictEqual(result.slippages, [0, 0.0001, 0.0003]);
});

test('Quality Risk C保护只按原始胜负更新不被净成本结果改写', function () {
    var tinyWin = {
        entry: 100,
        stop: 99,
        exit: 100.01,
        r: 0.01
    };
    var rows = [
        sample(1, 'LONG', 0, 'LOSS', {
            entry: 100, stop: 99, exit: 99, r: -1
        }),
        sample(2, 'LONG', 0, 'LOSS', {
            entry: 100, stop: 99, exit: 99, r: -1
        }),
        sample(3, 'LONG', 0, 'WIN', tinyWin),
        sample(4, 'LONG', 0, 'LOSS', {
            entry: 100, stop: 99, exit: 99, r: -1
        })
    ];
    var result = TradingCost.simulateScenario(
        rows,
        'QUALITY_RISK_C',
        'B',
        0,
        10000,
        [2020]
    );

    assert.strictEqual(result.trades[2].netStatus, 'LOSS');
    assert.strictEqual(result.trades[2].protectionMultiplier, 0.5);
    assert.strictEqual(result.trades[3].preTradeConsecutiveLosses, 0);
    assert.strictEqual(result.trades[3].protectionMultiplier, 1);
});

test('Baseline零成本场景按全部交易1R逐笔复利', function () {
    var rows = [
        sample(1, 'LONG', 0, 'WIN', {
            entry: 100, stop: 99, exit: 102, r: 2
        }),
        sample(2, 'LONG', 3, 'LOSS', {
            entry: 100, stop: 99, exit: 99, r: -1
        })
    ];
    var result = TradingCost.simulateScenario(
        rows,
        'BASELINE',
        'A',
        0,
        10000,
        [2020]
    );

    assert.strictEqual(result.overall.totalR, 1);
    assert.strictEqual(result.overall.endingBalance, 10098);
});

test('实验不修改最终交易样本且固定输出年度', function () {
    var rows = [sample(1, 'SHORT', 1, 'WIN', {
        entry: 100, stop: 101, exit: 98, r: 2
    })];
    var before = JSON.stringify(rows);
    var result = TradingCost.analyzeExecutionSamples(rows);

    assert.strictEqual(
        result.scenarios.BASELINE[0].yearly.length,
        7
    );
    assert.strictEqual(JSON.stringify(rows), before);
});

console.log('\n' + testsPassed + ' tests passed.');
