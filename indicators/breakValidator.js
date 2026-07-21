function getBodySize(kline) {
    return Math.abs(kline.close - kline.open);
}

function getRange(kline) {
    return kline.high - kline.low;
}

function getAverageBody(klines, endIndex, length) {
    var startIndex = Math.max(0, endIndex - length);
    var total = 0;
    var count = 0;
    var i;

    for (i = startIndex; i < endIndex; i++) {
        total += getBodySize(klines[i]);
        count++;
    }

    if (count === 0) {
        return 0;
    }

    return total / count;
}

function validateBullishBreak(klines, breakIndex, level, options) {
    var kline = klines[breakIndex];
    var body;
    var range;
    var bodyRatio;
    var averageBody;

    options = options || {};

    var averageLength = options.averageLength || 20;
    var displacementMultiplier =
        options.displacementMultiplier || 1.5;
    var minBodyRatio =
        options.minBodyRatio || 0.65;

    if (!kline) {
        return null;
    }

    /*
     * 连影线都没突破
     */
    if (kline.high <= level) {
        return {
            valid: false,
            type: 'NO_BREAK'
        };
    }

    /*
     * 只有影线突破
     */
    if (kline.close <= level) {
        return {
            valid: true,
            type: 'WICK_BREAK',
            level: level,
            breakIndex: breakIndex
        };
    }

    /*
     * 实体收盘突破
     */
    body = getBodySize(kline);
    range = getRange(kline);

    bodyRatio = range > 0
        ? body / range
        : 0;

    averageBody = getAverageBody(
        klines,
        breakIndex,
        averageLength
    );

    /*
     * Displacement Break
     */
    if (
        averageBody > 0 &&
        body >= averageBody * displacementMultiplier &&
        bodyRatio >= minBodyRatio &&
        kline.close > kline.open
    ) {
        return {
            valid: true,
            type: 'DISPLACEMENT_BREAK',
            direction: 'BULLISH',
            level: level,
            breakIndex: breakIndex,
            body: body,
            bodyRatio: bodyRatio,
            averageBody: averageBody
        };
    }

    return {
        valid: true,
        type: 'CLOSE_BREAK',
        direction: 'BULLISH',
        level: level,
        breakIndex: breakIndex,
        body: body,
        bodyRatio: bodyRatio,
        averageBody: averageBody
    };
}

function validateBearishBreak(klines, breakIndex, level, options) {
    var kline = klines[breakIndex];
    var body;
    var range;
    var bodyRatio;
    var averageBody;

    options = options || {};

    var averageLength = options.averageLength || 20;
    var displacementMultiplier =
        options.displacementMultiplier || 1.5;
    var minBodyRatio =
        options.minBodyRatio || 0.65;

    if (!kline) {
        return null;
    }

    if (kline.low >= level) {
        return {
            valid: false,
            type: 'NO_BREAK'
        };
    }

    if (kline.close >= level) {
        return {
            valid: true,
            type: 'WICK_BREAK',
            level: level,
            breakIndex: breakIndex
        };
    }

    body = getBodySize(kline);
    range = getRange(kline);

    bodyRatio = range > 0
        ? body / range
        : 0;

    averageBody = getAverageBody(
        klines,
        breakIndex,
        averageLength
    );

    if (
        averageBody > 0 &&
        body >= averageBody * displacementMultiplier &&
        bodyRatio >= minBodyRatio &&
        kline.close < kline.open
    ) {
        return {
            valid: true,
            type: 'DISPLACEMENT_BREAK',
            direction: 'BEARISH',
            level: level,
            breakIndex: breakIndex,
            body: body,
            bodyRatio: bodyRatio,
            averageBody: averageBody
        };
    }

    return {
        valid: true,
        type: 'CLOSE_BREAK',
        direction: 'BEARISH',
        level: level,
        breakIndex: breakIndex,
        body: body,
        bodyRatio: bodyRatio,
        averageBody: averageBody
    };
}
function findBullishBreak(
    klines,
    startIndex,
    level,
    options
) {
    var i;
    var result;

    for (i = startIndex; i < klines.length; i++) {
        if (klines[i].high > level) {

            result = validateBullishBreak(
                klines,
                i,
                level,
                options
            );

            if (result && result.valid) {
                return result;
            }
        }
    }

    return null;
}

function findBearishBreak(
    klines,
    startIndex,
    level,
    options
) {
    var i;
    var result;

    for (i = startIndex; i < klines.length; i++) {
        if (klines[i].low < level) {

            result = validateBearishBreak(
                klines,
                i,
                level,
                options
            );

            if (result && result.valid) {
                return result;
            }
        }
    }

    return null;
}
module.exports = {
    validateBullishBreak: validateBullishBreak,
    validateBearishBreak: validateBearishBreak,

    findBullishBreak: findBullishBreak,
    findBearishBreak: findBearishBreak
};