function createEmptyStats() {
    return {
        total: 0,
        win: 0,
        loss: 0,
        winRate: 0,
        avgR: 0,
        expectancy: 0,
        maxWinR: 0,
        maxLossR: 0,
        avgHoldBars: 0,
        maxLosingStreak: 0,
        rDistribution: {
            '0-1': 0,
            '1-2': 0,
            '2-3': 0,
            '3+': 0
        }
    };
}

function addToRDistribution(distribution, r) {
    if (r < 0) {
        return;
    }

    if (r < 1) {
        distribution['0-1']++;
        return;
    }

    if (r < 2) {
        distribution['1-2']++;
        return;
    }

    if (r < 3) {
        distribution['2-3']++;
        return;
    }

    distribution['3+']++;
}

function calculate(trades) {
    var stats = createEmptyStats();
    var totalR = 0;
    var totalHoldBars = 0;
    var holdCount = 0;
    var losingStreak = 0;
    var trade;
    var i;

    trades = trades || [];

    for (i = 0; i < trades.length; i++) {
        trade = trades[i];

        if (
            trade.status !== 'WIN' &&
            trade.status !== 'LOSS'
        ) {
            continue;
        }

        stats.total++;
        totalR += trade.r;

        if (
            typeof trade.entryIndex === 'number' &&
            typeof trade.exitIndex === 'number'
        ) {
            totalHoldBars +=
                trade.exitIndex - trade.entryIndex;
            holdCount++;
        }

        if (trade.status === 'WIN') {
            stats.win++;
            losingStreak = 0;

            if (
                stats.win === 1 ||
                trade.r > stats.maxWinR
            ) {
                stats.maxWinR = trade.r;
            }

            addToRDistribution(
                stats.rDistribution,
                trade.r
            );
        }

        if (trade.status === 'LOSS') {
            stats.loss++;
            losingStreak++;

            if (
                stats.loss === 1 ||
                trade.r < stats.maxLossR
            ) {
                stats.maxLossR = trade.r;
            }

            if (losingStreak > stats.maxLosingStreak) {
                stats.maxLosingStreak = losingStreak;
            }
        }
    }

    if (stats.total > 0) {
        stats.winRate = stats.win / stats.total * 100;
        stats.avgR = totalR / stats.total;
        stats.expectancy = stats.avgR;
    }

    if (holdCount > 0) {
        stats.avgHoldBars = totalHoldBars / holdCount;
    }

    return stats;
}

module.exports = {
    calculate: calculate,
    analyze: calculate
};
