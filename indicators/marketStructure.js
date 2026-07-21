function analyzeMarketStructure(swings, protectedSwings) {
    var result = {
        trend: 'UNKNOWN',

        latestProtectedLow: null,
        latestProtectedHigh: null,

        latestBos: null,
        latestMss: null
    };

    var i;
    var item;

    /*
     * 找最新 Protected Swing
     */
    for (i = 0; i < protectedSwings.length; i++) {
        item = protectedSwings[i];

        if (item.type === 'PROTECTED_LOW') {
            result.latestProtectedLow = item;
        }

        if (item.type === 'PROTECTED_HIGH') {
            result.latestProtectedHigh = item;
        }
    }

    /*
     * 根据最后几个 Swing 判断当前基础趋势
     */
    if (swings.length >= 4) {
        var recent = swings.slice(-4);

        var highs = [];
        var lows = [];

        for (i = 0; i < recent.length; i++) {
            if (recent[i].type === 'HIGH') {
                highs.push(recent[i]);
            }

            if (recent[i].type === 'LOW') {
                lows.push(recent[i]);
            }
        }

        if (
            highs.length >= 2 &&
            lows.length >= 2
        ) {
            var lastHigh = highs[highs.length - 1];
            var prevHigh = highs[highs.length - 2];

            var lastLow = lows[lows.length - 1];
            var prevLow = lows[lows.length - 2];

            if (
                lastHigh.price > prevHigh.price &&
                lastLow.price > prevLow.price
            ) {
                result.trend = 'BULLISH';
            }

            if (
                lastHigh.price < prevHigh.price &&
                lastLow.price < prevLow.price
            ) {
                result.trend = 'BEARISH';
            }

            if (
                result.trend === 'UNKNOWN'
            ) {
                result.trend = 'RANGE';
            }
        }
    }

    /*
     * 检测最近结构事件
     */
    for (i = 1; i < swings.length; i++) {
        var current = swings[i];

        /*
         * Bullish Break
         */
        if (current.type === 'HIGH') {
            var previousHigh = findPreviousSwing(
                swings,
                i,
                'HIGH'
            );

            if (
                previousHigh &&
                current.price > previousHigh.price
            ) {
                if (result.trend === 'BULLISH') {
                    result.latestBos = {
                        direction: 'BULLISH',
                        type: 'BOS',
                        breakPrice: previousHigh.price,
                        confirmedPrice: current.price,
                        index: current.index,
                        time: current.time
                    };
                }

                if (result.trend === 'BEARISH') {
                    result.latestMss = {
                        direction: 'BULLISH',
                        type: 'MSS',
                        breakPrice: previousHigh.price,
                        confirmedPrice: current.price,
                        index: current.index,
                        time: current.time
                    };
                }
            }
        }

        /*
         * Bearish Break
         */
        if (current.type === 'LOW') {
            var previousLow = findPreviousSwing(
                swings,
                i,
                'LOW'
            );

            if (
                previousLow &&
                current.price < previousLow.price
            ) {
                if (result.trend === 'BEARISH') {
                    result.latestBos = {
                        direction: 'BEARISH',
                        type: 'BOS',
                        breakPrice: previousLow.price,
                        confirmedPrice: current.price,
                        index: current.index,
                        time: current.time
                    };
                }

                if (result.trend === 'BULLISH') {
                    result.latestMss = {
                        direction: 'BEARISH',
                        type: 'MSS',
                        breakPrice: previousLow.price,
                        confirmedPrice: current.price,
                        index: current.index,
                        time: current.time
                    };
                }
            }
        }
    }

    return result;
}

function findPreviousSwing(swings, currentIndex, type) {
    var i;

    for (i = currentIndex - 1; i >= 0; i--) {
        if (swings[i].type === type) {
            return swings[i];
        }
    }

    return null;
}

module.exports = {
    analyzeMarketStructure: analyzeMarketStructure
};