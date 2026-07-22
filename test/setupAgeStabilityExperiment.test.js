var assert = require('assert');
var StabilityExperiment = require(
    '../backtest/setupAgeStabilityExperiment'
);
var StabilityRunner = require(
    '../scripts/runSetupAgeStabilityExperiment'
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

function createKline(openTime, high, low) {
    return {
        openTime: openTime,
        open: low,
        high: high,
        low: low,
        close: high,
        volume: 1,
        closeTime: openTime + 5 * 60 * 1000 - 1
    };
}

test('自然年度列表覆盖首尾年份', function () {
    var klines = [
        createKline(Date.UTC(2020, 0, 1), 1, 1),
        createKline(Date.UTC(2022, 5, 1), 1, 1)
    ];

    assert.deepStrictEqual(
        StabilityExperiment.listNaturalYears(klines),
        [2020, 2021, 2022]
    );
});

test('年度 Setup 只按 availableIndex 归属', function () {
    var interval = 5 * 60 * 1000;
    var start = Date.UTC(2020, 11, 31, 23, 50);
    var klines = [];
    var capturedLength;
    var input;
    var i;

    for (i = 0; i < 6; i++) {
        klines.push(createKline(
            start + i * interval,
            2,
            1
        ));
    }

    input = StabilityExperiment.createYearInput(
        klines,
        2021,
        function (contextKlines) {
            capturedLength = contextKlines.length;

            return {
                setups: [
                    { availableIndex: 1 },
                    { availableIndex: 2 },
                    { availableIndex: 5 }
                ],
                fvgs: [],
                structureEvents: [],
                liquidity: {
                    equalHighs: [],
                    equalLows: [],
                    previousDayLevels: []
                }
            };
        },
        2
    );

    assert.strictEqual(capturedLength, 6);
    assert.strictEqual(input.localCoreStart, 2);
    assert.strictEqual(input.analysis.setups.length, 2);
    assert.strictEqual(
        input.analysis.setups[0].availableIndex,
        2
    );
});

test('年度差异使用 16 Bars 减 Unlimited', function () {
    var difference = StabilityExperiment.createDifference(
        {
            actualEntries: 10,
            totalR: 5,
            averageR: 0.5
        },
        {
            actualEntries: 8,
            totalR: 7,
            averageR: 0.875
        }
    );

    assert.deepStrictEqual(difference, {
        tradesDifference: -2,
        totalRDifference: 2,
        averageRDifference: 0.375
    });
});

test('归档 CSV 同时兼容有无表头', function () {
    var text = [
        'open_time,open,high,low,close,volume,close_time',
        '1000,1,3,0,2,4,1999',
        '2000,2,4,1,3,5,2999'
    ].join('\n');
    var klines = StabilityRunner.parseCsv(text);

    assert.strictEqual(klines.length, 2);
    assert.strictEqual(klines[0].openTime, 1000);
    assert.strictEqual(klines[1].close, 3);
});

test('连续性检查报告缺失 K线数量', function () {
    var interval = StabilityRunner.INTERVAL_MILLISECONDS;
    var klines = [
        createKline(0, 2, 1),
        createKline(interval, 2, 1),
        createKline(interval * 3, 2, 1)
    ];
    var gaps = StabilityRunner.inspectContinuity(klines);

    assert.strictEqual(gaps.length, 1);
    assert.strictEqual(gaps[0].missingBars, 1);
});

console.log('\n' + testsPassed + ' tests passed.');
