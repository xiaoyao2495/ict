var DEFAULT_ATR_LENGTH = 14;
var MOMENTUM_LENGTH = 3;
var MIN_BODY_RATIO = 0.65;

function getBodyRatio(kline) {
    var range;
    var body;

    if (!kline) {
        return 0;
    }

    range = kline.high - kline.low;

    if (range <= 0) {
        return 0;
    }

    body = Math.abs(kline.close - kline.open);

    return body / range;
}

function getDirection(kline) {
    if (!kline || kline.close === kline.open) {
        return null;
    }

    return kline.close > kline.open
        ? 'BULLISH'
        : 'BEARISH';
}

function getTrueRange(klines, index) {
    var kline;
    var previousClose;
    var highLow;
    var highClose;
    var lowClose;

    if (!klines || !klines[index]) {
        return 0;
    }

    kline = klines[index];
    highLow = kline.high - kline.low;

    if (index === 0 || !klines[index - 1]) {
        return highLow;
    }

    previousClose = klines[index - 1].close;
    highClose = Math.abs(kline.high - previousClose);
    lowClose = Math.abs(kline.low - previousClose);

    return Math.max(highLow, highClose, lowClose);
}

function calculateATR(klines, length) {
    var startIndex;
    var total = 0;
    var count = 0;
    var i;

    if (!klines || !klines.length) {
        return 0;
    }

    length = typeof length === 'number'
        ? length
        : DEFAULT_ATR_LENGTH;

    if (length <= 0) {
        return 0;
    }

    startIndex = Math.max(0, klines.length - length);

    for (i = startIndex; i < klines.length; i++) {
        total += getTrueRange(klines, i);
        count++;
    }

    return count > 0 ? total / count : 0;
}

function hasMomentum(klines, direction) {
    var startIndex;
    var i;

    if (!klines || klines.length < MOMENTUM_LENGTH) {
        return false;
    }

    startIndex = klines.length - MOMENTUM_LENGTH;

    for (i = startIndex; i < klines.length; i++) {
        if (getDirection(klines[i]) !== direction) {
            return false;
        }
    }

    return direction === 'BULLISH' ||
        direction === 'BEARISH';
}

function hasATRExpansion(klines, atr) {
    var index;

    if (!klines || !klines.length || atr <= 0) {
        return false;
    }

    index = klines.length - 1;

    return getTrueRange(klines, index) > atr;
}

function hasGap(klines) {
    var first;
    var current;

    if (!klines || klines.length < 3) {
        return false;
    }

    first = klines[klines.length - 3];
    current = klines[klines.length - 1];

    return current.low > first.high ||
        current.high < first.low;
}

function analyze(klines, atr) {
    var result = {
        bullish: false,
        bearish: false,
        bodyRatio: 0,
        momentum: false,
        expansion: false,
        gap: false,
        score: 0
    };
    var current;
    var direction;

    if (!klines || !klines.length) {
        return result;
    }

    current = klines[klines.length - 1];
    direction = getDirection(current);

    result.bullish = direction === 'BULLISH';
    result.bearish = direction === 'BEARISH';
    result.bodyRatio = getBodyRatio(current);
    result.momentum = hasMomentum(klines, direction);

    if (typeof atr !== 'number') {
        atr = calculateATR(klines, DEFAULT_ATR_LENGTH);
    }

    result.expansion = hasATRExpansion(klines, atr);
    result.gap = hasGap(klines);

    if (result.bodyRatio >= MIN_BODY_RATIO) {
        result.score++;
    }

    if (result.momentum) {
        result.score++;
    }

    if (result.expansion) {
        result.score++;
    }

    if (result.gap) {
        result.score++;
    }

    return result;
}

module.exports = {
    analyze: analyze,
    getBodyRatio: getBodyRatio,
    getTrueRange: getTrueRange,
    calculateATR: calculateATR,
    hasMomentum: hasMomentum,
    hasATRExpansion: hasATRExpansion,
    hasGap: hasGap
};
