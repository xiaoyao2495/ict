function createBullishFVG(first, third, startIndex) {
    var top = third.low;
    var bottom = first.high;

    return {
        type: 'BULLISH_FVG',
        top: top,
        bottom: bottom,
        startIndex: startIndex,
        endIndex: startIndex + 2,
        availableIndex: startIndex + 2,
        size: top - bottom,
        midpoint: (top + bottom) / 2,
        mitigated: false,
        midpointMitigated: false,
        fullyMitigated: false,
        mitigationIndex: null
    };
}

function createBearishFVG(first, third, startIndex) {
    var top = first.low;
    var bottom = third.high;

    return {
        type: 'BEARISH_FVG',
        top: top,
        bottom: bottom,
        startIndex: startIndex,
        endIndex: startIndex + 2,
        availableIndex: startIndex + 2,
        size: top - bottom,
        midpoint: (top + bottom) / 2,
        mitigated: false,
        midpointMitigated: false,
        fullyMitigated: false,
        mitigationIndex: null
    };
}

function updateBullishMitigation(fvg, kline, index) {
    if (kline.low <= fvg.top) {
        if (!fvg.mitigated) {
            fvg.mitigationIndex = index;
        }

        fvg.mitigated = true;
    }

    if (kline.low <= fvg.midpoint) {
        fvg.midpointMitigated = true;
    }

    if (kline.low <= fvg.bottom) {
        fvg.fullyMitigated = true;
    }
}

function updateBearishMitigation(fvg, kline, index) {
    if (kline.high >= fvg.bottom) {
        if (!fvg.mitigated) {
            fvg.mitigationIndex = index;
        }

        fvg.mitigated = true;
    }

    if (kline.high >= fvg.midpoint) {
        fvg.midpointMitigated = true;
    }

    if (kline.high >= fvg.top) {
        fvg.fullyMitigated = true;
    }
}

function detectMitigation(fvg, klines) {
    var i;

    if (!fvg || !klines || !klines.length) {
        return fvg;
    }

    for (i = fvg.endIndex + 1; i < klines.length; i++) {
        if (fvg.type === 'BULLISH_FVG') {
            updateBullishMitigation(
                fvg,
                klines[i],
                i
            );
        }

        if (fvg.type === 'BEARISH_FVG') {
            updateBearishMitigation(
                fvg,
                klines[i],
                i
            );
        }

        if (fvg.fullyMitigated) {
            break;
        }
    }

    return fvg;
}

function findFVGs(klines) {
    var result = [];
    var first;
    var third;
    var fvg;
    var i;

    if (!klines || klines.length < 3) {
        return result;
    }

    for (i = 0; i <= klines.length - 3; i++) {
        first = klines[i];
        third = klines[i + 2];
        fvg = null;

        if (first.high < third.low) {
            fvg = createBullishFVG(
                first,
                third,
                i
            );
        } else if (first.low > third.high) {
            fvg = createBearishFVG(
                first,
                third,
                i
            );
        }

        if (fvg) {
            result.push(
                detectMitigation(fvg, klines)
            );
        }
    }

    return result;
}

module.exports = {
    findFVGs: findFVGs,
    detectMitigation: detectMitigation
};
