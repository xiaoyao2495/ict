var assert = require('assert');
var FVG = require('../indicators/fvg');

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

function createKline(high, low) {
    return {
        open: low,
        high: high,
        low: low,
        close: high
    };
}

test('Bullish FVG', function () {
    var klines = [
        createKline(100, 95),
        createKline(108, 98),
        createKline(115, 105)
    ];
    var result = FVG.findFVGs(klines);

    assert.deepStrictEqual(result, [
        {
            type: 'BULLISH_FVG',
            top: 105,
            bottom: 100,
            startIndex: 0,
            endIndex: 2,
            size: 5,
            midpoint: 102.5,
            mitigated: false,
            midpointMitigated: false,
            fullyMitigated: false,
            mitigationIndex: null
        }
    ]);
});

test('Bearish FVG', function () {
    var klines = [
        createKline(110, 105),
        createKline(107, 98),
        createKline(100, 95)
    ];
    var result = FVG.findFVGs(klines);

    assert.deepStrictEqual(result, [
        {
            type: 'BEARISH_FVG',
            top: 105,
            bottom: 100,
            startIndex: 0,
            endIndex: 2,
            size: 5,
            midpoint: 102.5,
            mitigated: false,
            midpointMitigated: false,
            fullyMitigated: false,
            mitigationIndex: null
        }
    ]);
});

test('无 FVG', function () {
    var klines = [
        createKline(105, 95),
        createKline(108, 98),
        createKline(110, 100)
    ];

    assert.deepStrictEqual(FVG.findFVGs(klines), []);
});

test('识别多个 FVG', function () {
    var klines = [
        createKline(100, 95),
        createKline(102, 97),
        createKline(110, 105),
        createKline(101, 98),
        createKline(109, 104),
        createKline(95, 90)
    ];
    var result = FVG.findFVGs(klines);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].type, 'BULLISH_FVG');
    assert.strictEqual(result[0].startIndex, 0);
    assert.strictEqual(result[1].type, 'BEARISH_FVG');
    assert.strictEqual(result[1].startIndex, 3);
});

test('Bullish partial mitigation', function () {
    var klines = [
        createKline(100, 95),
        createKline(108, 98),
        createKline(115, 105),
        createKline(116, 104)
    ];
    var fvg = FVG.findFVGs(klines)[0];

    assert.strictEqual(fvg.mitigated, true);
    assert.strictEqual(fvg.midpointMitigated, false);
    assert.strictEqual(fvg.fullyMitigated, false);
    assert.strictEqual(fvg.mitigationIndex, 3);
});

test('Bullish 50% mitigation', function () {
    var klines = [
        createKline(100, 95),
        createKline(108, 98),
        createKline(115, 105),
        createKline(116, 102.5)
    ];
    var fvg = FVG.findFVGs(klines)[0];

    assert.strictEqual(fvg.mitigated, true);
    assert.strictEqual(fvg.midpointMitigated, true);
    assert.strictEqual(fvg.fullyMitigated, false);
    assert.strictEqual(fvg.mitigationIndex, 3);
});

test('Bullish full mitigation', function () {
    var klines = [
        createKline(100, 95),
        createKline(108, 98),
        createKline(115, 105),
        createKline(116, 100)
    ];
    var fvg = FVG.findFVGs(klines)[0];

    assert.strictEqual(fvg.mitigated, true);
    assert.strictEqual(fvg.midpointMitigated, true);
    assert.strictEqual(fvg.fullyMitigated, true);
    assert.strictEqual(fvg.mitigationIndex, 3);
});

test('Bearish mitigation', function () {
    var klines = [
        createKline(110, 105),
        createKline(107, 98),
        createKline(100, 95),
        createKline(105, 94)
    ];
    var fvg = FVG.findFVGs(klines)[0];

    assert.strictEqual(fvg.mitigated, true);
    assert.strictEqual(fvg.midpointMitigated, true);
    assert.strictEqual(fvg.fullyMitigated, true);
    assert.strictEqual(fvg.mitigationIndex, 3);
});

test('FVG 形成前不能 mitigation', function () {
    var klines = [
        createKline(100, 90),
        createKline(104, 99),
        createKline(100, 95),
        createKline(108, 100),
        createKline(115, 105)
    ];
    var result = FVG.findFVGs(klines);
    var fvg = result[0];

    assert.strictEqual(result.length, 1);
    assert.strictEqual(fvg.startIndex, 2);
    assert.strictEqual(fvg.endIndex, 4);
    assert.strictEqual(fvg.mitigated, false);
    assert.strictEqual(fvg.midpointMitigated, false);
    assert.strictEqual(fvg.fullyMitigated, false);
    assert.strictEqual(fvg.mitigationIndex, null);
});

console.log('\n' + testsPassed + ' tests passed.');
