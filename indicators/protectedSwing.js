function findProtectedSwings(swings) {
    var result = [];
    var lastHigh = null;
    var lastLow = null;

    var candidateLow = null;
    var candidateHigh = null;

    var protectedLow = null;
    var protectedHigh = null;

    var i;
    var swing;

    for (i = 0; i < swings.length; i++) {
        swing = swings[i];

        /*
         * 遇到 LOW
         */
        if (swing.type === 'LOW') {

            // 保存这个 Low
            // 它可能成为下一次 Bullish BOS 的 Protected Low
            candidateLow = swing;

            /*
             * Bearish BOS
             *
             * 当前 Low 跌破前一个 Swing Low
             * 那么之前推动下跌的 High
             * 成为 Protected High
             */
            if (
                lastLow &&
                swing.price < lastLow.price &&
                candidateHigh
            ) {
                protectedHigh = candidateHigh;

                result.push({
                    index: protectedHigh.index,
                    time: protectedHigh.time,
                    price: protectedHigh.price,
                    type: 'PROTECTED_HIGH',
                    confirmedAt: swing.index,
                    breakPrice: lastLow.price
                });
            }

            lastLow = swing;
        }

        /*
         * 遇到 HIGH
         */
        if (swing.type === 'HIGH') {

            // 保存这个 High
            // 它可能成为下一次 Bearish BOS 的 Protected High
            candidateHigh = swing;

            /*
             * Bullish BOS
             *
             * 当前 High 突破前一个 Swing High
             * 那么之前推动上涨的 Low
             * 成为 Protected Low
             */
            if (
                lastHigh &&
                swing.price > lastHigh.price &&
                candidateLow
            ) {
                protectedLow = candidateLow;

                result.push({
                    index: protectedLow.index,
                    time: protectedLow.time,
                    price: protectedLow.price,
                    type: 'PROTECTED_LOW',
                    confirmedAt: swing.index,
                    breakPrice: lastHigh.price
                });
            }

            lastHigh = swing;
        }
    }

    return result;
}

module.exports = {
    findProtectedSwings: findProtectedSwings
};