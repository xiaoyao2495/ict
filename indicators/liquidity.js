var EQUAL_TOLERANCE = 0.001;

function isEqualPrice(price1, price2) {
    var referencePrice = Math.max(
        Math.abs(price1),
        Math.abs(price2)
    );

    if (referencePrice === 0) {
        return price1 === price2;
    }

    return Math.abs(price1 - price2) /
        referencePrice <= EQUAL_TOLERANCE;
}

function findEqualLevels(swings, swingType, resultType) {
    var result = [];
    var previous = null;
    var current;
    var i;

    if (!swings || !swings.length) {
        return result;
    }

    for (i = 0; i < swings.length; i++) {
        current = swings[i];

        if (current.type !== swingType) {
            continue;
        }

        if (
            previous &&
            isEqualPrice(previous.price, current.price)
        ) {
            result.push({
                type: resultType,
                price: (previous.price + current.price) / 2,
                index1: previous.index,
                index2: current.index
            });
        }

        previous = current;
    }

    return result;
}

function findEqualHighs(swings) {
    return findEqualLevels(
        swings,
        'HIGH',
        'EQUAL_HIGH'
    );
}

function findEqualLows(swings) {
    return findEqualLevels(
        swings,
        'LOW',
        'EQUAL_LOW'
    );
}

function getDayStart(time) {
    var date = new Date(time);

    return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    );
}

function findPreviousDayLevels(klines) {
    var result = [];
    var latestDayStart;
    var previousDayStart = null;
    var dayStart;
    var high = null;
    var low = null;
    var i;

    if (!klines || !klines.length) {
        return result;
    }

    latestDayStart = getDayStart(
        klines[klines.length - 1].openTime
    );

    for (i = klines.length - 1; i >= 0; i--) {
        dayStart = getDayStart(klines[i].openTime);

        if (dayStart < latestDayStart) {
            previousDayStart = dayStart;
            break;
        }
    }

    if (previousDayStart === null) {
        return result;
    }

    for (i = 0; i < klines.length; i++) {
        dayStart = getDayStart(klines[i].openTime);

        if (dayStart !== previousDayStart) {
            continue;
        }

        if (high === null || klines[i].high > high) {
            high = klines[i].high;
        }

        if (low === null || klines[i].low < low) {
            low = klines[i].low;
        }
    }

    if (high !== null) {
        result.push({
            type: 'PDH',
            price: high,
            index: findLevelIndex(
                klines,
                previousDayStart,
                high,
                'high'
            )
        });
    }

    if (low !== null) {
        result.push({
            type: 'PDL',
            price: low,
            index: findLevelIndex(
                klines,
                previousDayStart,
                low,
                'low'
            )
        });
    }

    return result;
}

function findLevelIndex(
    klines,
    dayStart,
    price,
    field
) {
    var i;

    for (i = 0; i < klines.length; i++) {
        if (
            getDayStart(klines[i].openTime) === dayStart &&
            klines[i][field] === price
        ) {
            return i;
        }
    }

    return null;
}

function findNextDayIndex(klines, sourceIndex) {
    var sourceDayStart;
    var i;

    if (
        !klines[sourceIndex] ||
        typeof klines[sourceIndex].openTime === 'undefined'
    ) {
        return 0;
    }

    sourceDayStart = getDayStart(
        klines[sourceIndex].openTime
    );

    for (i = sourceIndex + 1; i < klines.length; i++) {
        if (
            getDayStart(klines[i].openTime) >
            sourceDayStart
        ) {
            return i;
        }
    }

    return klines.length;
}

function toLiquidityLevels(
    equalHighs,
    equalLows,
    dayLevels,
    klines
) {
    var result = [];
    var i;

    for (i = 0; i < equalHighs.length; i++) {
        result.push({
            direction: 'BUY_SIDE',
            price: equalHighs[i].price,
            activeFrom: equalHighs[i].index2 + 1
        });
    }

    for (i = 0; i < equalLows.length; i++) {
        result.push({
            direction: 'SELL_SIDE',
            price: equalLows[i].price,
            activeFrom: equalLows[i].index2 + 1
        });
    }

    for (i = 0; i < dayLevels.length; i++) {
        result.push({
            direction: dayLevels[i].type === 'PDH'
                ? 'BUY_SIDE'
                : 'SELL_SIDE',
            price: dayLevels[i].price,
            activeFrom: findNextDayIndex(
                klines,
                dayLevels[i].index
            )
        });
    }

    return result;
}

function findLiquiditySweeps(klines, levels) {
    var result = [];
    var level;
    var kline;
    var startIndex;
    var i;
    var j;

    if (!klines || !klines.length || !levels) {
        return result;
    }

    for (i = 0; i < levels.length; i++) {
        level = levels[i];
        startIndex = typeof level.activeFrom === 'number'
            ? level.activeFrom
            : 0;

        for (j = startIndex; j < klines.length; j++) {
            kline = klines[j];

            if (
                level.direction === 'BUY_SIDE' &&
                kline.high > level.price &&
                kline.close < level.price
            ) {
                result.push({
                    type: 'BUY_SIDE_SWEEP',
                    price: level.price,
                    index: j
                });

                break;
            }

            if (
                level.direction === 'SELL_SIDE' &&
                kline.low < level.price &&
                kline.close > level.price
            ) {
                result.push({
                    type: 'SELL_SIDE_SWEEP',
                    price: level.price,
                    index: j
                });

                break;
            }
        }
    }

    return result;
}

function analyze(swings, klines) {
    var equalHighs = findEqualHighs(swings);
    var equalLows = findEqualLows(swings);
    var previousDayLevels =
        findPreviousDayLevels(klines);
    var levels = toLiquidityLevels(
        equalHighs,
        equalLows,
        previousDayLevels,
        klines
    );

    return {
        equalHighs: equalHighs,
        equalLows: equalLows,
        previousDayLevels: previousDayLevels,
        sweeps: findLiquiditySweeps(klines, levels)
    };
}

module.exports = {
    analyze: analyze,
    findEqualHighs: findEqualHighs,
    findEqualLows: findEqualLows,
    findPreviousDayLevels: findPreviousDayLevels,
    findLiquiditySweeps: findLiquiditySweeps
};
