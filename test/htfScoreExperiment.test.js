var assert = require('assert');
var HTFScoreExperiment = require(
    '../backtest/htfScoreExperiment'
);

var testsPassed = 0;
var FIVE_MINUTES = 5 * 60 * 1000;
var FOUR_HOUR_BARS = 48;

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

function sample(overrides) {
    return Object.assign({
        direction: 'LONG',
        h4Trend: 'UNKNOWN',
        h1Structure: 'UNKNOWN',
        pdLocation: 'INSIDE_PREVIOUS_DAY_RANGE',
        status: 'LOSS',
        r: -1,
        setupIndex: 1,
        entryIndex: 2,
        year: 2020
    }, overrides || {});
}

function fourHourLocation(aligned) {
    return {
        high: 120,
        low: 80,
        equilibrium: 100,
        position: aligned ? 'DISCOUNT' : 'PREMIUM',
        aligned: aligned
    };
}

function createFiveMinuteSeries(highs, lows) {
    var result = [];
    var start = Date.UTC(2020, 0, 1);
    var bar;
    var index;
    var sourceIndex;

    for (bar = 0; bar < highs.length; bar++) {
        for (index = 0; index < FOUR_HOUR_BARS; index++) {
            sourceIndex = bar * FOUR_HOUR_BARS + index;
            result.push({
                openTime: start + sourceIndex * FIVE_MINUTES,
                closeTime: start +
                    (sourceIndex + 1) * FIVE_MINUTES - 1,
                open: 100,
                high: index === 0 ? highs[bar] : 101,
                low: index === 0 ? lows[bar] : 99,
                close: 100,
                volume: 1
            });
        }
    }

    return result;
}

test('评分严格按 4H 1H 和方向性 Liquidity 规则累计', function () {
    var bos = HTFScoreExperiment.scoreSample(
        sample({
            direction: 'LONG',
            h4Trend: 'BULLISH',
            h1Structure: 'BULLISH_BOS',
            pdLocation: 'BELOW_PDL'
        }),
        fourHourLocation(true)
    );
    var mss = HTFScoreExperiment.scoreSample(
        sample({
            direction: 'SHORT',
            h4Trend: 'BEARISH',
            h1Structure: 'BEARISH_MSS',
            pdLocation: 'ABOVE_PDH'
        }),
        fourHourLocation(true)
    );

    assert.strictEqual(bos.score, 5);
    assert.strictEqual(bos.scoreBucket, '5+');
    assert.deepStrictEqual(bos.scoreComponents, {
        fourHourDirection: 1,
        fourHourLocation: 1,
        oneHourStructure: 2,
        directionalLiquidity: 1
    });
    assert.strictEqual(mss.score, 4);
});

test('反方向标签和未知 4H dealing range 均不得分', function () {
    var scored = HTFScoreExperiment.scoreSample(
        sample({
            direction: 'LONG',
            h4Trend: 'BEARISH',
            h1Structure: 'BEARISH_BOS',
            pdLocation: 'ABOVE_PDH'
        }),
        {
            high: null,
            low: null,
            equilibrium: null,
            position: 'UNKNOWN',
            aligned: false
        }
    );

    assert.strictEqual(scored.score, 0);
    assert.strictEqual(scored.scoreBucket, '0');
});

test('Score 分布固定输出 0 到 5+ 且保留空组', function () {
    var scored = [0, 1, 2, 3, 4, 5].map(
        function (score, index) {
            return sample({
                score: score,
                scoreBucket: score === 5
                    ? '5+'
                    : String(score),
                setupIndex: index,
                entryIndex: index,
                status: index < 2 ? 'LOSS' : 'WIN',
                r: index < 2 ? -1 : index
            });
        }
    );
    var summaries = HTFScoreExperiment
        .summarizeBuckets(scored);

    assert.deepStrictEqual(
        Object.keys(summaries),
        ['0', '1', '2', '3', '4', '5+']
    );
    assert.strictEqual(summaries['0'].trades, 1);
    assert.strictEqual(summaries['5+'].trades, 1);
});

test('4H premium discount 只使用 Setup 当时已确认 Swing', function () {
    var highs = [100, 110, 130, 115, 105, 100,
        110, 120, 140, 125, 115, 110];
    var lows = [90, 92, 95, 90, 85, 70,
        82, 88, 100, 90, 80, 75];
    var prefixKlines = createFiveMinuteSeries(
        highs.slice(0, 8),
        lows.slice(0, 8)
    );
    var extendedKlines = createFiveMinuteSeries(highs, lows);
    var sourceIndex = prefixKlines.length - 1;
    var prefix = HTFScoreExperiment.getFourHourLocation(
        HTFScoreExperiment
            .buildFourHourDealingRangeTimeline(prefixKlines),
        sourceIndex,
        'LONG',
        99
    );
    var extended = HTFScoreExperiment.getFourHourLocation(
        HTFScoreExperiment
            .buildFourHourDealingRangeTimeline(extendedKlines),
        sourceIndex,
        'LONG',
        99
    );

    assert.deepStrictEqual(extended, prefix);
    assert.strictEqual(prefix.high, 130);
    assert.strictEqual(prefix.low, 70);
    assert.strictEqual(prefix.equilibrium, 100);
    assert.strictEqual(prefix.position, 'DISCOUNT');
    assert.strictEqual(prefix.aligned, true);
});

test('实验只返回评分副本且不修改 Setup Entry Trade', function () {
    var highs = [100, 110, 130, 115, 105, 100, 110, 120];
    var lows = [90, 92, 95, 90, 85, 70, 82, 88];
    var klines = createFiveMinuteSeries(highs, lows);
    var setupIndex = klines.length - 1;
    var input = {
        setups: [{
            type: 'LONG_SETUP',
            direction: 'BULLISH',
            triggerIndex: setupIndex,
            availableIndex: setupIndex,
            htfContext: {
                h4: { trend: 'BULLISH' },
                h1: { structure: 'BULLISH_BOS' },
                previousDay: { location: 'BELOW_PDL' }
            }
        }],
        entries: [{
            type: 'LONG_ENTRY',
            status: 'ENTRY_TRIGGERED',
            setupIndex: setupIndex,
            triggerIndex: setupIndex,
            entry: 100,
            stop: 90,
            target: 110
        }],
        trades: [{
            type: 'LONG',
            status: 'WIN',
            setupIndex: setupIndex,
            entryIndex: setupIndex,
            exitIndex: setupIndex,
            r: 1
        }],
        klines: klines
    };
    var before = JSON.stringify(input);
    var result = HTFScoreExperiment.analyzeHtfScores({
        setups: input.setups,
        entries: input.entries,
        trades: input.trades,
        klines: input.klines,
        years: [2020]
    });

    assert.strictEqual(result.samples.length, 1);
    assert.strictEqual(result.samples[0].score, 5);
    assert.strictEqual(input.trades[0].score, undefined);
    assert.strictEqual(JSON.stringify(input), before);
});

console.log('\n' + testsPassed + ' tests passed.');
