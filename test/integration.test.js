var assert = require('assert');

var Liquidity = require('../indicators/liquidity');
var StructureEngine = require('../indicators/structureEngine');
var Displacement = require('../indicators/displacement');
var FVG = require('../indicators/fvg');
var SetupEngine = require('../indicators/setupEngine');

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

function createKline(index, open, high, low, close) {
    return {
        openTime: Date.UTC(2026, 6, 21, index),
        open: open,
        high: high,
        low: low,
        close: close,
        volume: 1,
        closeTime: Date.UTC(2026, 6, 21, index + 1) - 1
    };
}

function findEvent(events, type) {
    var i;

    for (i = 0; i < events.length; i++) {
        if (events[i].type === type) {
            return events[i];
        }
    }

    return null;
}

/*
 * displacement.analyze() returns an analysis of the latest
 * Kline, not an event with type and index. This adapter runs
 * it on each Kline prefix and converts qualified results into
 * the event format consumed by setupEngine.
 */
function createDisplacementEvents(klines, atr) {
    var result = [];
    var analysis;
    var type;
    var i;

    for (i = 0; i < klines.length; i++) {
        analysis = Displacement.analyze(
            klines.slice(0, i + 1),
            atr
        );

        if (
            analysis.bodyRatio < 0.65 ||
            !analysis.momentum ||
            !analysis.expansion
        ) {
            continue;
        }

        type = analysis.bullish
            ? 'BULLISH_DISPLACEMENT'
            : 'BEARISH_DISPLACEMENT';

        result.push({
            type: type,
            index: i,
            analysis: analysis
        });
    }

    return result;
}

function runFullFlow(klines, swings, atr) {
    var liquidityResult = Liquidity.analyze(
        swings,
        klines
    );
    var structureResult = StructureEngine.analyze(swings);
    var displacementEvents = createDisplacementEvents(
        klines,
        atr
    );
    var fvgEvents = FVG.findFVGs(klines);
    var setups = SetupEngine.analyze({
        structureEvents: structureResult.events,
        liquidityEvents: liquidityResult.sweeps,
        displacementEvents: displacementEvents,
        fvgEvents: fvgEvents
    });

    return {
        liquidityEvents: liquidityResult.sweeps,
        structureEvents: structureResult.events,
        displacementEvents: displacementEvents,
        fvgEvents: fvgEvents,
        setups: setups
    };
}

test('完整 LONG_SETUP 链路', function () {
    var klines = [
        createKline(0, 106, 110, 104, 108),
        createKline(1, 104, 106, 100, 102),
        createKline(2, 102, 105, 101, 104),
        createKline(3, 103, 104, 100.05, 102),
        createKline(4, 102, 104, 100.5, 103),
        createKline(5, 102, 103, 99, 101),
        createKline(6, 101, 104, 100.5, 103),
        createKline(7, 103, 106, 102.5, 105.5),
        createKline(8, 105, 113, 104, 112),
        createKline(9, 111, 114, 107, 113)
    ];
    var swings = [
        { type: 'HIGH', price: 110, index: 0 },
        {
            type: 'LOW',
            price: 100,
            index: 1,
            availableIndex: 3
        },
        { type: 'HIGH', price: 105, index: 2 },
        {
            type: 'LOW',
            price: 100.05,
            index: 3,
            availableIndex: 5
        },
        { type: 'HIGH', price: 104, index: 4 },
        { type: 'LOW', price: 99, index: 5 },
        { type: 'HIGH', price: 106, index: 7 }
    ];
    var result = runFullFlow(klines, swings, 5);
    var sweep = findEvent(
        result.liquidityEvents,
        'SELL_SIDE_SWEEP'
    );
    var mss = findEvent(
        result.structureEvents,
        'BULLISH_MSS'
    );
    var displacement = findEvent(
        result.displacementEvents,
        'BULLISH_DISPLACEMENT'
    );
    var fvg = findEvent(
        result.fvgEvents,
        'BULLISH_FVG'
    );

    assert.ok(sweep);
    assert.ok(mss);
    assert.ok(displacement);
    assert.ok(fvg);
    assert.strictEqual(sweep.index, 5);
    assert.strictEqual(mss.index, 7);
    assert.strictEqual(displacement.index, 8);
    assert.strictEqual(fvg.endIndex, 9);
    assert.strictEqual(result.setups.length, 1);
    assert.strictEqual(result.setups[0].type, 'LONG_SETUP');
    assert.strictEqual(result.setups[0].triggerIndex, 9);
    assert.strictEqual(result.setups[0].availableIndex, 9);
    assert.strictEqual(result.setups[0].sweep, sweep);
    assert.strictEqual(result.setups[0].mss, mss);
    assert.strictEqual(result.setups[0].displacement, displacement);
    assert.strictEqual(result.setups[0].fvg, fvg);
    assert.strictEqual(result.setups[0].sweepExtreme, 99);
});

test('完整 SHORT_SETUP 链路', function () {
    var klines = [
        createKline(0, 94, 96, 90, 92),
        createKline(1, 96, 100, 94, 98),
        createKline(2, 98, 99, 95, 96),
        createKline(3, 97, 100.05, 96, 99),
        createKline(4, 98, 100, 96, 97),
        createKline(5, 100, 101, 97, 99),
        createKline(6, 99, 100, 96.5, 97),
        createKline(7, 97, 98, 94, 95),
        createKline(8, 95, 97, 86, 87),
        createKline(9, 89, 93, 85, 87)
    ];
    var swings = [
        { type: 'LOW', price: 90, index: 0 },
        {
            type: 'HIGH',
            price: 100,
            index: 1,
            availableIndex: 3
        },
        { type: 'LOW', price: 95, index: 2 },
        {
            type: 'HIGH',
            price: 100.05,
            index: 3,
            availableIndex: 5
        },
        { type: 'LOW', price: 96, index: 4 },
        { type: 'HIGH', price: 101, index: 5 },
        { type: 'LOW', price: 94, index: 7 }
    ];
    var result = runFullFlow(klines, swings, 5);
    var sweep = findEvent(
        result.liquidityEvents,
        'BUY_SIDE_SWEEP'
    );
    var mss = findEvent(
        result.structureEvents,
        'BEARISH_MSS'
    );
    var displacement = findEvent(
        result.displacementEvents,
        'BEARISH_DISPLACEMENT'
    );
    var fvg = findEvent(
        result.fvgEvents,
        'BEARISH_FVG'
    );

    assert.ok(sweep);
    assert.ok(mss);
    assert.ok(displacement);
    assert.ok(fvg);
    assert.strictEqual(sweep.index, 5);
    assert.strictEqual(mss.index, 7);
    assert.strictEqual(displacement.index, 8);
    assert.strictEqual(fvg.endIndex, 9);
    assert.strictEqual(result.setups.length, 1);
    assert.strictEqual(result.setups[0].type, 'SHORT_SETUP');
    assert.strictEqual(result.setups[0].triggerIndex, 9);
    assert.strictEqual(result.setups[0].availableIndex, 9);
    assert.strictEqual(result.setups[0].sweep, sweep);
    assert.strictEqual(result.setups[0].mss, mss);
    assert.strictEqual(result.setups[0].displacement, displacement);
    assert.strictEqual(result.setups[0].fvg, fvg);
    assert.strictEqual(result.setups[0].sweepExtreme, 101);
});

console.log('\n' + testsPassed + ' integration tests passed.');
