function findPivots(klines, left, right) {
    var result = [];

    left = typeof left === 'number' ? left : 2;
    right = typeof right === 'number' ? right : 2;

    if (!klines || klines.length < left + right + 1) {
        return result;
    }

    for (var i = left; i < klines.length - right; i++) {
        var current = klines[i];
        var isPivotHigh = true;
        var isPivotLow = true;
        var j;

        // 检查左边
        for (j = 1; j <= left; j++) {
            if (klines[i - j].high >= current.high) {
                isPivotHigh = false;
            }

            if (klines[i - j].low <= current.low) {
                isPivotLow = false;
            }
        }

        // 检查右边
        for (j = 1; j <= right; j++) {
            if (klines[i + j].high > current.high) {
                isPivotHigh = false;
            }

            if (klines[i + j].low < current.low) {
                isPivotLow = false;
            }
        }

        if (isPivotHigh) {
            result.push({
                index: i,
                extremeIndex: i,
                confirmationIndex: i + right,
                availableIndex: i + right,
                time: current.openTime,
                price: current.high,
                type: 'HIGH'
            });
        }

        if (isPivotLow) {
            result.push({
                index: i,
                extremeIndex: i,
                confirmationIndex: i + right,
                availableIndex: i + right,
                time: current.openTime,
                price: current.low,
                type: 'LOW'
            });
        }
    }

    result.sort(function (a, b) {
        return a.index - b.index;
    });

    return result;
}

module.exports = {
    findPivots: findPivots
};
