function analyze(swings) {
    var result = {
        trend: 'UNKNOWN',
        protectedLow: null,
        protectedHigh: null,
        events: []
    };

    var lastHigh = null;
    var lastLow = null;

    var candidateLow = null;
    var candidateHigh = null;

    var i;
    var swing;

    if (!swings || swings.length === 0) {
        return result;
    }

    for (i = 0; i < swings.length; i++) {
        swing = swings[i];

        /*
         * =========================
         * LOW
         * =========================
         */
        if (swing.type === 'LOW') {
            candidateLow = swing;

            if (lastLow) {

                /*
                 * 当前 Low 跌破前一个 Low
                 */
                if (swing.price < lastLow.price) {

                    /*
                     * 原本 Bullish
                     * 跌破 Protected Low
                     * => Bearish MSS
                     */
                    if (
                        result.trend === 'BULLISH' &&
                        result.protectedLow &&
                        swing.price < result.protectedLow.price
                    ) {
                        result.events.push({
                            type: 'BEARISH_MSS',
                            direction: 'BEARISH',
                            index: swing.index,
                            time: swing.time,
                            price: swing.price,
                            breakPrice: result.protectedLow.price
                        });

                        result.trend = 'BEARISH';

                        /*
                         * 当前这一轮下跌之前的 High
                         * 成为新的 Protected High
                         */
                        if (candidateHigh) {
                            result.protectedHigh = candidateHigh;
                        }

                        result.protectedLow = null;
                    }

                    /*
                     * 原本 Bearish
                     * 继续创新 Low
                     * => Bearish BOS
                     */
                    else if (result.trend === 'BEARISH') {
                        result.events.push({
                            type: 'BEARISH_BOS',
                            direction: 'BEARISH',
                            index: swing.index,
                            time: swing.time,
                            price: swing.price,
                            breakPrice: lastLow.price
                        });

                        if (candidateHigh) {
                            result.protectedHigh = candidateHigh;
                        }
                    }

                    /*
                     * 还没有趋势
                     * 首次形成 Lower Low
                     */
                    else if (result.trend === 'UNKNOWN') {
                        result.trend = 'BEARISH';

                        if (candidateHigh) {
                            result.protectedHigh = candidateHigh;
                        }

                        result.events.push({
                            type: 'BEARISH_STRUCTURE_CONFIRMED',
                            direction: 'BEARISH',
                            index: swing.index,
                            time: swing.time,
                            price: swing.price,
                            breakPrice: lastLow.price
                        });
                    }
                }
            }

            lastLow = swing;
        }

        /*
         * =========================
         * HIGH
         * =========================
         */
        if (swing.type === 'HIGH') {
            candidateHigh = swing;

            if (lastHigh) {

                /*
                 * 当前 High 突破前一个 High
                 */
                if (swing.price > lastHigh.price) {

                    /*
                     * 原本 Bearish
                     * 突破 Protected High
                     * => Bullish MSS
                     */
                    if (
                        result.trend === 'BEARISH' &&
                        result.protectedHigh &&
                        swing.price > result.protectedHigh.price
                    ) {
                        result.events.push({
                            type: 'BULLISH_MSS',
                            direction: 'BULLISH',
                            index: swing.index,
                            time: swing.time,
                            price: swing.price,
                            breakPrice: result.protectedHigh.price
                        });

                        result.trend = 'BULLISH';

                        if (candidateLow) {
                            result.protectedLow = candidateLow;
                        }

                        result.protectedHigh = null;
                    }

                    /*
                     * 原本 Bullish
                     * 继续创新 High
                     * => Bullish BOS
                     */
                    else if (result.trend === 'BULLISH') {
                        result.events.push({
                            type: 'BULLISH_BOS',
                            direction: 'BULLISH',
                            index: swing.index,
                            time: swing.time,
                            price: swing.price,
                            breakPrice: lastHigh.price
                        });

                        if (candidateLow) {
                            result.protectedLow = candidateLow;
                        }
                    }

                    /*
                     * 还没有趋势
                     * 首次形成 Higher High
                     */
                    else if (result.trend === 'UNKNOWN') {
                        result.trend = 'BULLISH';

                        if (candidateLow) {
                            result.protectedLow = candidateLow;
                        }

                        result.events.push({
                            type: 'BULLISH_STRUCTURE_CONFIRMED',
                            direction: 'BULLISH',
                            index: swing.index,
                            time: swing.time,
                            price: swing.price,
                            breakPrice: lastHigh.price
                        });
                    }
                }
            }

            lastHigh = swing;
        }
    }

    return result;
}

module.exports = {
    analyze: analyze
};