var SetupExpiryExperiment = require('./setupExpiryExperiment');
var BacktestEngine = require('./backtestEngine');

var MAX_WAIT_VALUES = [
    null,
    4,
    8,
    12,
    16,
    24,
    32,
    48,
    64,
    96,
    128,
    256
];

var AGE_BUCKETS = [
    { label: '0-4', min: 0, max: 4 },
    { label: '5-8', min: 5, max: 8 },
    { label: '9-16', min: 9, max: 16 },
    { label: '17-32', min: 17, max: 32 },
    { label: '33-64', min: 33, max: 64 },
    { label: '65+', min: 65, max: Infinity }
];

function cloneEntry(entry) {
    var result = {};
    var property;

    for (property in entry) {
        if (
            Object.prototype.hasOwnProperty.call(
                entry,
                property
            )
        ) {
            result[property] = property === 'targetReselections'
                ? entry[property].slice()
                : entry[property];
        }
    }

    return result;
}

function expireEntry(entry, maxWaitBars) {
    var result = cloneEntry(entry);
    var expiredAt = entry.setupAvailableIndex +
        maxWaitBars + 1;

    result.status = 'EXPIRED_MAX_WAIT';
    result.triggerIndex = null;
    result.target = null;
    result.targetSource = null;
    result.targetLiquidityType = null;
    result.targetLevel = null;
    result.setupAgeBars = maxWaitBars + 1;
    result.invalidatedAt = expiredAt;
    result.invalidationReason = 'EXPIRED_MAX_WAIT';
    result.targetReselections = result.targetReselections.filter(
        function (item) {
            return item.index < expiredAt;
        }
    );

    return result;
}

function applyMaxWait(entries, maxWaitBars) {
    if (maxWaitBars === null) {
        return entries.map(cloneEntry);
    }

    return entries.map(function (entry) {
        if (
            entry.status !== 'INVALIDATED_AT_FORMATION' &&
            entry.setupAgeBars > maxWaitBars
        ) {
            return expireEntry(entry, maxWaitBars);
        }

        return cloneEntry(entry);
    });
}

function median(values) {
    var sorted;
    var middle;

    if (!values.length) {
        return null;
    }

    sorted = values.slice().sort(function (a, b) {
        return a - b;
    });
    middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function countStatus(items, status) {
    return items.filter(function (item) {
        return item.status === status;
    }).length;
}

function pearsonCorrelation(pairs) {
    var meanX;
    var meanY;
    var numerator = 0;
    var denominatorX = 0;
    var denominatorY = 0;
    var deltaX;
    var deltaY;
    var i;

    if (pairs.length < 2) {
        return null;
    }

    meanX = pairs.reduce(function (total, pair) {
        return total + pair.x;
    }, 0) / pairs.length;
    meanY = pairs.reduce(function (total, pair) {
        return total + pair.y;
    }, 0) / pairs.length;

    for (i = 0; i < pairs.length; i++) {
        deltaX = pairs[i].x - meanX;
        deltaY = pairs[i].y - meanY;
        numerator += deltaX * deltaY;
        denominatorX += deltaX * deltaX;
        denominatorY += deltaY * deltaY;
    }

    if (denominatorX === 0 || denominatorY === 0) {
        return null;
    }

    return numerator /
        Math.sqrt(denominatorX * denominatorY);
}

function createTradeDetails(entries, trades, klines) {
    var tradeBySetup = {};
    var result = [];
    var direction;
    var key;
    var trade;
    var i;

    for (i = 0; i < trades.length; i++) {
        key = trades[i].type + ':' + trades[i].setupIndex;
        tradeBySetup[key] = trades[i];
    }

    for (i = 0; i < entries.length; i++) {
        if (entries[i].status !== 'ENTRY_TRIGGERED') {
            continue;
        }

        direction = entries[i].type === 'LONG_ENTRY'
            ? 'LONG'
            : 'SHORT';
        key = direction + ':' + entries[i].setupIndex;
        trade = tradeBySetup[key];

        result.push({
            setupIndex: entries[i].setupIndex,
            setupTime: klines[entries[i].setupAvailableIndex]
                .openTime,
            entryTime: klines[entries[i].triggerIndex].openTime,
            setupAgeBars: entries[i].setupAgeBars,
            direction: direction,
            result: trade.status,
            r: trade.r
        });
    }

    return result;
}

function summarizeBuckets(tradeDetails) {
    var result = {};

    AGE_BUCKETS.forEach(function (bucket) {
        var trades = tradeDetails.filter(function (trade) {
            return trade.setupAgeBars >= bucket.min &&
                trade.setupAgeBars <= bucket.max;
        });
        var closed = trades.filter(function (trade) {
            return trade.result === 'WIN' ||
                trade.result === 'LOSS';
        });
        var wins = closed.filter(function (trade) {
            return trade.result === 'WIN';
        }).length;
        var rValues = closed.map(function (trade) {
            return trade.r;
        });
        var totalR = rValues.reduce(function (total, value) {
            return total + value;
        }, 0);

        result[bucket.label] = {
            trades: trades.length,
            winRate: closed.length
                ? wins / closed.length * 100
                : 0,
            averageR: closed.length
                ? totalR / closed.length
                : 0,
            medianR: median(rValues),
            totalR: totalR
        };
    });

    return result;
}

function summarize(
    setupCount,
    entries,
    trades,
    klines
) {
    var triggered = entries.filter(function (entry) {
        return entry.status === 'ENTRY_TRIGGERED';
    });
    var ages = triggered.map(function (entry) {
        return entry.setupAgeBars;
    });
    var closed = trades.filter(function (trade) {
        return trade.status === 'WIN' ||
            trade.status === 'LOSS';
    });
    var rValues = closed.map(function (trade) {
        return trade.r;
    });
    var totalR = rValues.reduce(function (total, value) {
        return total + value;
    }, 0);
    var win = countStatus(trades, 'WIN');
    var tradeDetails = createTradeDetails(
        entries,
        trades,
        klines
    );

    return {
        setup: setupCount,
        formationInvalid: countStatus(
            entries,
            'INVALIDATED_AT_FORMATION'
        ),
        sweepInvalid: countStatus(
            entries,
            'INVALIDATED_SWEEP'
        ),
        structureInvalid: countStatus(
            entries,
            'INVALIDATED_STRUCTURE'
        ),
        oppositeMss: countStatus(
            entries,
            'INVALIDATED_OPPOSITE_MSS'
        ),
        targetReselectCount: entries.reduce(
            function (total, entry) {
                return total + entry.targetReselections.length;
            },
            0
        ),
        expiredMaxWait: countStatus(
            entries,
            'EXPIRED_MAX_WAIT'
        ),
        actualEntries: triggered.length,
        win: win,
        loss: countStatus(trades, 'LOSS'),
        open: countStatus(trades, 'OPEN'),
        winRate: closed.length
            ? win / closed.length * 100
            : 0,
        averageR: closed.length
            ? totalR / closed.length
            : 0,
        medianR: median(rValues),
        totalR: totalR,
        averageSetupAgeBars: ages.length
            ? ages.reduce(function (total, age) {
                return total + age;
            }, 0) / ages.length
            : 0,
        medianSetupAgeBars: median(ages),
        longestSetupAgeBars: ages.length
            ? Math.max.apply(null, ages)
            : null,
        pearsonAgeR: pearsonCorrelation(
            tradeDetails.filter(function (trade) {
                return trade.r !== null;
            }).map(function (trade) {
                return {
                    x: trade.setupAgeBars,
                    y: trade.r
                };
            })
        ),
        ageBuckets: summarizeBuckets(tradeDetails),
        trades: tradeDetails
    };
}

function runConfiguration(
    input,
    unlimitedEntries,
    maxWaitBars
) {
    var entries = applyMaxWait(
        unlimitedEntries,
        maxWaitBars
    );
    var backtest = BacktestEngine.analyze({
        entries: entries,
        klines: input.klines
    });

    return {
        label: maxWaitBars === null
            ? 'UNLIMITED'
            : String(maxWaitBars),
        maxWaitBars: maxWaitBars,
        entries: entries,
        backtest: backtest,
        summary: summarize(
            input.analysis.setups.length,
            entries,
            backtest.trades,
            input.klines
        )
    };
}

function analyze(input) {
    var unlimited =
        SetupExpiryExperiment.runExperimentalMode(
            input,
            SetupExpiryExperiment.MODES.MODE_B
        );
    var result = {};

    MAX_WAIT_VALUES.forEach(function (maxWaitBars) {
        var configuration = runConfiguration(
            input,
            unlimited.entries,
            maxWaitBars
        );

        result[configuration.label] = configuration;
    });

    return result;
}

module.exports = {
    MAX_WAIT_VALUES: MAX_WAIT_VALUES,
    AGE_BUCKETS: AGE_BUCKETS,
    applyMaxWait: applyMaxWait,
    pearsonCorrelation: pearsonCorrelation,
    summarizeBuckets: summarizeBuckets,
    runConfiguration: runConfiguration,
    analyze: analyze
};
