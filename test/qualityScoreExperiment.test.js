var assert = require('assert');
var QualityScoreExperiment = require(
    '../backtest/qualityScoreExperiment'
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

function sample(index, r, overrides) {
    var result = {
        entryIndex: index,
        setupIndex: index - 1,
        status: r > 0 ? 'WIN' : 'LOSS',
        r: r,
        h1Structure: 'UNKNOWN',
        features: {
            bodyRatio: 0.8,
            fvgSizePercent: 0.1,
            setupAgeBars: 5,
            volatilityState: 'NEUTRAL'
        }
    };

    overrides = overrides || {};
    result.h1Structure = overrides.h1Structure ||
        result.h1Structure;
    result.features = Object.assign(
        {},
        result.features,
        overrides.features || {}
    );
    return result;
}

test('固定五项规则各贡献一分且边界严格', function () {
    var row = sample(1, 2, {
        h1Structure: 'BEARISH_BOS',
        features: {
            bodyRatio: 0.60,
            fvgSizePercent: 0.024999,
            setupAgeBars: 3,
            volatilityState: 'EXPANSION'
        }
    });
    var scored = QualityScoreExperiment.scoreSample(row);

    assert.strictEqual(scored.qualityScore, 5);
    assert.deepStrictEqual(scored.qualityScoreComponents, {
        bodyRatio: true,
        bearishBos1h: true,
        smallFvg: true,
        youngSetup: true,
        expansionRegime: true
    });
    assert.strictEqual(
        QualityScoreExperiment.scoreSample(sample(2, 1, {
            features: {
                bodyRatio: 0.70,
                fvgSizePercent: 0.025,
                setupAgeBars: 4
            }
        })).qualityScore,
        0
    );
});

test('Score 0到5固定输出并包含全部要求指标', function () {
    var rows = [
        sample(1, -1),
        sample(2, 2, {
            features: { bodyRatio: 0.65 }
        }),
        sample(3, -1, {
            h1Structure: 'BEARISH_BOS',
            features: { bodyRatio: 0.65 }
        })
    ].map(QualityScoreExperiment.scoreSample);
    var result = QualityScoreExperiment.buildScoreDistribution(rows);

    assert.deepStrictEqual(Object.keys(result), ['0', '1', '2', '3', '4', '5']);
    assert.strictEqual(result['0'].trades, 1);
    assert.strictEqual(result['1'].trades, 1);
    assert.strictEqual(result['2'].trades, 1);
    assert.strictEqual(result['0'].maxDrawdownR, 1);
    assert.strictEqual(result['2'].maxLosingStreak, 1);
    assert.strictEqual(result['5'].medianR, null);
});

test('Score至少3使用1.5倍且正确计算加权回撤', function () {
    var rows = [
        sample(1, 2),
        sample(2, -1),
        sample(3, -1),
        sample(4, 1)
    ].map(function (row, index) {
        return Object.assign({}, row, {
            qualityScore: index === 0 || index === 2 ? 3 : 2
        });
    });
    var result = QualityScoreExperiment.applyPositionSizing(rows);

    assert.strictEqual(result.originalTotalR, 1);
    assert.strictEqual(result.weightedTotalR, 1.5);
    assert.strictEqual(result.totalRChange, 0.5);
    assert.strictEqual(result.originalMaxDrawdownR, 2);
    assert.strictEqual(result.weightedMaxDrawdownR, 2.5);
    assert.strictEqual(result.maxDrawdownChangeR, 0.5);
    assert.strictEqual(result.maxDrawdownChangePercent, 25);
    assert.deepStrictEqual(
        result.weightedSamples.map(function (row) {
            return row.positionMultiplier;
        }),
        [1.5, 1, 1.5, 1]
    );
});

test('实验只给交易副本评分且不修改Entry Exit样本', function () {
    var rows = [sample(1, 2, {
        h1Structure: 'BEARISH_BOS',
        features: {
            bodyRatio: 0.65,
            fvgSizePercent: 0.02,
            setupAgeBars: 2,
            volatilityState: 'EXPANSION'
        }
    })];
    var before = JSON.stringify(rows);
    var result = QualityScoreExperiment.analyzeFeatureSamples(rows);

    assert.strictEqual(result.sampleCount, 1);
    assert.strictEqual(result.samples[0].qualityScore, 5);
    assert.strictEqual(result.positionSizing.weightedTotalR, 3);
    assert.strictEqual(JSON.stringify(rows), before);
    assert.strictEqual(rows[0].qualityScore, undefined);
});

console.log('\n' + testsPassed + ' tests passed.');
