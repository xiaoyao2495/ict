var assert = require('assert');
var HTFFilterExperiment = require(
    '../backtest/htfFilterExperiment'
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

function context(h4Trend, h1Structure, location) {
    return {
        h4: { trend: h4Trend },
        h1: { structure: h1Structure },
        previousDay: { location: location }
    };
}

function fixture() {
    var specifications = [
        ['LONG', 1, 'BULLISH', 'BULLISH_BOS', 'BELOW_PDL', 'LOSS', -1, 2020],
        ['SHORT', 2, 'BEARISH', 'BEARISH_MSS', 'ABOVE_PDH', 'LOSS', -1, 2020],
        ['LONG', 3, 'BULLISH', 'BEARISH_BOS', 'INSIDE_RANGE', 'WIN', 2, 2020],
        ['SHORT', 4, 'BULLISH', 'BEARISH_BOS', 'ABOVE_PDH', 'WIN', 4, 2020],
        ['LONG', 5, 'BEARISH', 'BULLISH_MSS', 'BELOW_PDL', 'LOSS', -1, 2021],
        ['SHORT', 6, 'BEARISH', 'BULLISH_BOS', 'INSIDE_RANGE', 'WIN', 3, 2021]
    ];
    var klines = Array.from(
        { length: 20 },
        function () {
            return { openTime: Date.UTC(2020, 0, 1) };
        }
    );
    var setups = [];
    var entries = [];
    var trades = [];

    specifications.forEach(function (specification) {
        var direction = specification[0];
        var index = specification[1];
        var year = specification[7];

        klines[index] = { openTime: Date.UTC(year, 0, 1) };
        setups.push({
            type: direction + '_SETUP',
            direction: direction === 'LONG'
                ? 'BULLISH'
                : 'BEARISH',
            triggerIndex: index,
            availableIndex: index,
            htfContext: context(
                specification[2],
                specification[3],
                specification[4]
            )
        });
        entries.push({
            type: direction,
            setupIndex: index,
            entryIndex: index + 10,
            status: 'ENTRY_TRIGGERED'
        });
        trades.push({
            type: direction,
            setupIndex: index,
            status: specification[5],
            r: specification[6]
        });
    });

    return {
        setups: setups,
        entries: entries,
        trades: trades,
        klines: klines
    };
}

test('A B and C use directionally aligned HTF definitions', function () {
    var longSample = {
        direction: 'LONG',
        h4Trend: 'BULLISH',
        h1Structure: 'BULLISH_MSS',
        pdLocation: 'BELOW_PDL'
    };
    var shortSample = {
        direction: 'SHORT',
        h4Trend: 'BEARISH',
        h1Structure: 'BEARISH_BOS',
        pdLocation: 'ABOVE_PDH'
    };

    assert.strictEqual(
        HTFFilterExperiment.matchesFourHourTrend(longSample),
        true
    );
    assert.strictEqual(
        HTFFilterExperiment.matchesOneHourStructure(longSample),
        true
    );
    assert.strictEqual(
        HTFFilterExperiment.matchesPreviousDayLocation(longSample),
        true
    );
    assert.strictEqual(
        HTFFilterExperiment.matchesFourHourTrend(shortSample),
        true
    );
    assert.strictEqual(
        HTFFilterExperiment.matchesOneHourStructure(shortSample),
        true
    );
    assert.strictEqual(
        HTFFilterExperiment.matchesPreviousDayLocation(shortSample),
        true
    );
});

test('summary computes median R and chronological loss streak', function () {
    var summary = HTFFilterExperiment.summarize([
        { setupIndex: 4, entryIndex: 4, status: 'WIN', r: 4 },
        { setupIndex: 2, entryIndex: 2, status: 'LOSS', r: -1 },
        { setupIndex: 1, entryIndex: 1, status: 'LOSS', r: -1 },
        { setupIndex: 3, entryIndex: 3, status: 'WIN', r: 2 }
    ]);

    assert.strictEqual(summary.trades, 4);
    assert.strictEqual(summary.wins, 2);
    assert.strictEqual(summary.losses, 2);
    assert.strictEqual(summary.winRate, 0.5);
    assert.strictEqual(summary.totalR, 4);
    assert.strictEqual(summary.averageR, 1);
    assert.strictEqual(summary.medianR, 0.5);
    assert.strictEqual(summary.maxConsecutiveLosses, 2);
});

test('A-D are post-processing filters and include requested years', function () {
    var input = fixture();
    var before = JSON.stringify(input);
    var result = HTFFilterExperiment.analyzeHtfFilters({
        setups: input.setups,
        entries: input.entries,
        trades: input.trades,
        klines: input.klines,
        years: [2020, 2021]
    });

    assert.strictEqual(result.overall.BASELINE.trades, 6);
    assert.strictEqual(result.overall.A.trades, 4);
    assert.strictEqual(result.overall.B.trades, 4);
    assert.strictEqual(result.overall.C.trades, 4);
    assert.strictEqual(result.overall.D.trades, 2);
    assert.deepStrictEqual(
        result.yearly.A.map(function (row) { return row.year; }),
        [2020, 2021]
    );
    assert.strictEqual(result.stability.D.activeYears, 1);
    assert.strictEqual(JSON.stringify(input), before);
});

console.log('\n' + testsPassed + ' tests passed.');
