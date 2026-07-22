var assert = require('assert');
var MarketRegimeExperiment = require(
    '../backtest/marketRegimeExperiment'
);

var testsPassed = 0;
var FIVE_MINUTES = 5 * 60 * 1000;

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

function createSeries(length) {
    var result = [];
    var start = Date.UTC(2020, 0, 1);
    var center;
    var open;
    var close;
    var index;

    for (index = 0; index < length; index++) {
        center = 100 + index * 0.002 +
            Math.sin(index / 31) * 1.5;
        open = center - Math.sin(index / 7) * 0.2;
        close = center + Math.cos(index / 11) * 0.2;
        result.push({
            openTime: start + index * FIVE_MINUTES,
            closeTime: start +
                (index + 1) * FIVE_MINUTES - 1,
            open: open,
            high: Math.max(open, close) + 0.3,
            low: Math.min(open, close) - 0.3,
            close: close,
            volume: 1
        });
    }

    return result;
}

function state(overrides) {
    var result = {
        h4: {
            emaTrend: 'BULLISH',
            emaDistancePercent: 0.5,
            atrPercentile: 50
        },
        h1: {
            emaTrend: 'BULLISH',
            volatilityPercentile: 50,
            rangeExpansion: false
        },
        fiveMinute: {
            breakout: 'NONE',
            adx14: 30
        }
    };

    Object.keys(overrides || {}).forEach(function (key) {
        result[key] = Object.assign(
            {},
            result[key],
            overrides[key]
        );
    });
    return result;
}

test('EMA ATR volatility ADX 输出严格使用历史序列', function () {
    var klines = createSeries(200);
    var ema20 = MarketRegimeExperiment.calculateEmaSeries(
        klines,
        20
    );
    var atr = MarketRegimeExperiment.calculateWilderAtrSeries(
        klines,
        14
    );
    var volatility = MarketRegimeExperiment
        .calculateVolatilitySeries(klines, 20);
    var adx = MarketRegimeExperiment.calculateAdxSeries(
        klines,
        14
    );

    assert.strictEqual(ema20[18], null);
    assert.strictEqual(Number.isFinite(ema20[199]), true);
    assert.strictEqual(Number.isFinite(atr.values[199]), true);
    assert.strictEqual(Number.isFinite(volatility[199]), true);
    assert.strictEqual(Number.isFinite(adx[199]), true);
    assert.strictEqual(adx[199] >= 0 && adx[199] <= 100, true);
});

test('Regime 分类按固定优先级互斥执行', function () {
    assert.strictEqual(
        MarketRegimeExperiment.classifyRegime(state({})),
        'TRENDING'
    );
    assert.strictEqual(
        MarketRegimeExperiment.classifyRegime(state({
            h4: { atrPercentile: 80 },
            h1: { rangeExpansion: true }
        })),
        'EXPANSION'
    );
    assert.strictEqual(
        MarketRegimeExperiment.classifyRegime(state({
            h4: { atrPercentile: 20 },
            h1: { volatilityPercentile: 20 },
            fiveMinute: { adx14: 15 }
        })),
        'CONTRACTION'
    );
    assert.strictEqual(
        MarketRegimeExperiment.classifyRegime(state({
            h1: { emaTrend: 'BEARISH' },
            fiveMinute: { adx14: 20 }
        })),
        'RANGING'
    );
});

test('未来 K线 不改变同一 Entry 的成交前 Regime 状态', function () {
    var klines = createSeries(8000);
    var entryIndex = 6000;
    var prefixTimelines = MarketRegimeExperiment
        .buildIndicatorTimelines(klines.slice(0, entryIndex));
    var extendedTimelines = MarketRegimeExperiment
        .buildIndicatorTimelines(klines);
    var prefix = MarketRegimeExperiment.getPreEntryState(
        prefixTimelines,
        klines.slice(0, entryIndex),
        entryIndex
    );
    var extended = MarketRegimeExperiment.getPreEntryState(
        extendedTimelines,
        klines,
        entryIndex
    );

    assert.deepStrictEqual(extended, prefix);
    assert.strictEqual(
        prefix.h4.lastClosedBarTime <=
            klines[entryIndex - 1].closeTime,
        true
    );
    assert.strictEqual(
        prefix.h1.lastClosedBarTime <=
            klines[entryIndex - 1].closeTime,
        true
    );
});

test('实验只给78笔交易的副本加标签且不改 Entry Exit', function () {
    var klines = createSeries(8000);
    var setupIndex = 5900;
    var entryIndex = 6000;
    var input = {
        setups: [{
            type: 'LONG_SETUP',
            direction: 'BULLISH',
            triggerIndex: setupIndex,
            availableIndex: setupIndex
        }],
        entries: [{
            type: 'LONG_ENTRY',
            status: 'ENTRY_TRIGGERED',
            setupIndex: setupIndex,
            triggerIndex: entryIndex,
            entry: 100,
            stop: 99,
            target: 102
        }],
        trades: [{
            type: 'LONG',
            status: 'WIN',
            setupIndex: setupIndex,
            entryIndex: entryIndex,
            exitIndex: entryIndex + 10,
            entry: 100,
            exitPrice: 102,
            r: 2
        }]
    };
    var before = JSON.stringify(input);
    var result = MarketRegimeExperiment.analyzeMarketRegimes({
        setups: input.setups,
        entries: input.entries,
        trades: input.trades,
        klines: klines,
        years: [2020]
    });

    assert.strictEqual(result.samples.length, 1);
    assert.ok(result.samples[0].preEntryState);
    assert.strictEqual(input.trades[0].regime, undefined);
    assert.strictEqual(JSON.stringify(input), before);
    assert.deepStrictEqual(
        Object.keys(result.overall),
        ['TRENDING', 'RANGING', 'EXPANSION', 'CONTRACTION']
    );
});

console.log('\n' + testsPassed + ' tests passed.');
