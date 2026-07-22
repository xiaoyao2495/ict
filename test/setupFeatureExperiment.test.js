var assert = require('assert');
var SetupFeatureExperiment = require(
    '../backtest/setupFeatureExperiment'
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

test('连续Feature使用预先固定的边界分桶', function () {
    assert.strictEqual(
        SetupFeatureExperiment.bucketFeature('bodyRatio', 0.69),
        '0.60-0.70'
    );
    assert.strictEqual(
        SetupFeatureExperiment.bucketFeature('bodyRatio', 0.7),
        '0.70-0.80'
    );
    assert.strictEqual(
        SetupFeatureExperiment.bucketFeature('fvgSizeAtr', 1),
        '1.00+'
    );
    assert.strictEqual(
        SetupFeatureExperiment.bucketFeature('setupAgeBars', 16),
        '13-16'
    );
    assert.strictEqual(
        SetupFeatureExperiment.bucketFeature('atrPercentile', 75),
        '75-100'
    );
});

test('LTF特征严格来自原Setup事件链和因果ATR', function () {
    var setup = {
        displacement: { score: 4, bodyRatio: 0.75 },
        fvg: { size: 10, availableIndex: 2 },
        sweep: {
            price: 100,
            extreme: 99,
            availableIndex: 0
        },
        mss: { availableIndex: 3 }
    };
    var entry = {
        entry: 100,
        setupAgeBars: 5
    };
    var base = {
        direction: 'LONG',
        entryIndex: 4,
        h4Trend: 'BULLISH',
        h1Structure: 'BULLISH_BOS',
        pdLocation: 'BELOW_PDL',
        status: 'WIN',
        r: 2
    };
    var market = {
        regime: 'EXPANSION',
        preEntryState: {
            h4: { atrPercentile: 80 },
            daily: { intradayRangePercentile: 60 }
        }
    };
    var atr = [1, 1, 20, 1, 1];
    var klines = [0, 1, 2, 3, 4].map(function (index) {
        return { openTime: Date.UTC(2020, 0, index + 1) };
    });
    var before = JSON.stringify({ setup: setup, entry: entry });
    var result = SetupFeatureExperiment.createFeatureSample(
        base,
        setup,
        entry,
        market,
        atr,
        klines
    );

    assert.strictEqual(result.features.displacementScore, 4);
    assert.strictEqual(result.features.bodyRatio, 0.75);
    assert.strictEqual(result.features.fvgSizePercent, 10);
    assert.strictEqual(result.features.fvgSizeAtr, 0.5);
    assert.strictEqual(result.features.sweepSize, 1);
    assert.strictEqual(result.features.sweepSizePercent, 1);
    assert.strictEqual(result.features.mssDistanceBars, 3);
    assert.strictEqual(result.features.setupAgeBars, 5);
    assert.strictEqual(result.features.volatilityState, 'EXPANSION');
    assert.strictEqual(JSON.stringify({ setup: setup, entry: entry }), before);
});

test('Feature桶统计包含要求指标和累计R Max DD', function () {
    var rows = [
        { entryIndex: 1, status: 'LOSS', r: -1, year: 2020 },
        { entryIndex: 2, status: 'WIN', r: 2, year: 2020 },
        { entryIndex: 3, status: 'LOSS', r: -1, year: 2021 },
        { entryIndex: 4, status: 'LOSS', r: -1, year: 2021 }
    ];
    var summary = SetupFeatureExperiment.summarizeSamples(rows);

    assert.strictEqual(summary.trades, 4);
    assert.strictEqual(summary.winRate, 0.25);
    assert.strictEqual(summary.totalR, -1);
    assert.strictEqual(summary.averageR, -0.25);
    assert.strictEqual(summary.medianR, -1);
    assert.strictEqual(summary.maxDrawdownR, 2);
    assert.strictEqual(summary.minusOneCount, 3);
    assert.strictEqual(summary.maxWinnerR, 2);
    assert.strictEqual(summary.totalRWithoutMaxWinner, -3);
    assert.strictEqual(summary.averageRWithoutMaxWinner, -1);
});

function combinationSample(index, good) {
    var buckets = {};
    SetupFeatureExperiment.FEATURE_ORDER.forEach(function (feature) {
        buckets[feature] = good ? 'GOOD' : 'BAD';
    });
    return {
        entryIndex: index,
        status: good ? 'WIN' : 'LOSS',
        r: good ? 3 : -1,
        year: 2020 + index % 4,
        featureBuckets: buckets
    };
}

test('稳定组合大赢家组合和负1R组合使用预设样本门槛', function () {
    var samples = [];
    var index;
    for (index = 0; index < 8; index++) {
        samples.push(combinationSample(index, true));
    }
    for (index = 8; index < 16; index++) {
        samples.push(combinationSample(index, false));
    }
    var result = SetupFeatureExperiment
        .findCombinationSignals(samples);

    assert.strictEqual(result.stableHighQuality.length > 0, true);
    assert.strictEqual(
        result.stableHighQuality[0].trades >= 8,
        true
    );
    assert.strictEqual(
        result.bigWinnerCombinations[0].bigWinnerCount >= 2,
        true
    );
    assert.strictEqual(
        result.minusOneCombinations[0].minusOneRate,
        1
    );
});

console.log('\n' + testsPassed + ' tests passed.');
