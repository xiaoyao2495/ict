var assert = require('assert');
var MonteCarlo = require(
    '../backtest/monteCarloExperiment'
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

function sample(index, score, originalStatus, netR) {
    return {
        entryIndex: index,
        qualityScore: score,
        originalStatus: originalStatus,
        netR: netR
    };
}

test('固定随机种子产生可复核且完整的随机排列', function () {
    var first = MonteCarlo.shuffledIndexes(
        10,
        MonteCarlo.createSeededRandom(123)
    );
    var second = MonteCarlo.shuffledIndexes(
        10,
        MonteCarlo.createSeededRandom(123)
    );

    assert.deepStrictEqual(first, second);
    assert.deepStrictEqual(
        first.slice().sort(function (a, b) { return a - b; }),
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    );
});

test('百分位和分布摘要使用线性插值', function () {
    var values = [1, 2, 3, 4, 5];
    var summary = MonteCarlo.summarizeDistribution(values);

    assert.strictEqual(MonteCarlo.percentile(values, 0.25), 2);
    assert.strictEqual(summary.mean, 3);
    assert.strictEqual(summary.median, 3);
    assert.strictEqual(summary.min, 1);
    assert.strictEqual(summary.max, 5);
});

test('随机顺序会重新计算Quality Risk C连续亏损保护', function () {
    var rows = [
        sample(1, 0, 'LOSS', -1),
        sample(2, 0, 'LOSS', -1),
        sample(3, 0, 'LOSS', -1),
        sample(4, 3, 'WIN', 2)
    ];
    var lossesFirst = MonteCarlo.simulatePermutation(
        rows,
        [0, 1, 2, 3]
    );
    var winBetween = MonteCarlo.simulatePermutation(
        rows,
        [0, 1, 3, 2]
    );

    assert.strictEqual(lossesFirst.totalR, 1.25);
    assert.strictEqual(winBetween.totalR, 1);
});

test('最大连续亏损按成本后净结果且记录90和80破位', function () {
    var rows = [
        sample(1, 2, 'LOSS', -11),
        sample(2, 2, 'LOSS', -11),
        sample(3, 2, 'WIN', -1)
    ];
    var result = MonteCarlo.simulatePermutation(
        rows,
        [0, 1, 2]
    );

    assert.strictEqual(result.maxConsecutiveLosses, 3);
    assert.strictEqual(result.breached90, true);
    assert.strictEqual(result.breached80, true);
});

test('Monte Carlo输出指定次数和概率分布且不修改样本', function () {
    var rows = [
        sample(1, 0, 'LOSS', -1),
        sample(2, 2, 'WIN', 2),
        sample(3, 3, 'LOSS', -1)
    ];
    var before = JSON.stringify(rows);
    var result = MonteCarlo.analyzeCostSamples(rows, {
        simulations: 100,
        seed: 7
    });
    var frequencyTotal = Object.keys(
        result.maxConsecutiveLosses.frequencies
    ).reduce(function (sum, key) {
        return sum + result.maxConsecutiveLosses
            .frequencies[key].count;
    }, 0);

    assert.strictEqual(result.returns.count, 100);
    assert.strictEqual(frequencyTotal, 100);
    assert.strictEqual(
        result.breachProbability.below90Percent >= 0 &&
        result.breachProbability.below90Percent <= 1,
        true
    );
    assert.strictEqual(JSON.stringify(rows), before);
});

console.log('\n' + testsPassed + ' tests passed.');
