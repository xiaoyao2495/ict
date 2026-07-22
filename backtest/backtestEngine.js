function calculateWinR(entry, direction) {
    var risk;
    var reward;

    if (direction === 'LONG') {
        risk = entry.entry - entry.stop;
        reward = entry.target - entry.entry;
    } else {
        risk = entry.stop - entry.entry;
        reward = entry.entry - entry.target;
    }

    if (risk <= 0) {
        return 0;
    }

    return reward / risk;
}

function createTrade(entry, direction) {
    return {
        type: direction,
        status: 'OPEN',
        entry: entry.entry,
        stop: entry.stop,
        target: entry.target,
        setupIndex: entry.setupIndex,
        entryIndex: entry.triggerIndex,
        exitIndex: null,
        exitPrice: null,
        r: null,
        sameBarStop: false,
        sameBarTarget: false,
        ambiguousEntryBar: false
    };
}

function auditLongEntryBar(trade, entry, klines) {
    var kline = klines[entry.triggerIndex];

    if (!kline) {
        return false;
    }

    trade.sameBarStop = kline.low <= entry.stop;
    trade.sameBarTarget = kline.high >= entry.target;
    trade.ambiguousEntryBar =
        trade.sameBarStop || trade.sameBarTarget;

    return trade.sameBarStop;
}

function auditShortEntryBar(trade, entry, klines) {
    var kline = klines[entry.triggerIndex];

    if (!kline) {
        return false;
    }

    trade.sameBarStop = kline.high >= entry.stop;
    trade.sameBarTarget = kline.low <= entry.target;
    trade.ambiguousEntryBar =
        trade.sameBarStop || trade.sameBarTarget;

    return trade.sameBarStop;
}

function closeTrade(trade, status, index, price, r) {
    trade.status = status;
    trade.exitIndex = index;
    trade.exitPrice = price;
    trade.r = r;

    return trade;
}

function simulateLong(entry, klines) {
    var trade = createTrade(entry, 'LONG');
    var i;

    if (auditLongEntryBar(trade, entry, klines)) {
        return closeTrade(
            trade,
            'LOSS',
            entry.triggerIndex,
            entry.stop,
            -1
        );
    }

    for (i = entry.triggerIndex + 1; i < klines.length; i++) {
        if (klines[i].low <= entry.stop) {
            return closeTrade(
                trade,
                'LOSS',
                i,
                entry.stop,
                -1
            );
        }

        if (klines[i].high >= entry.target) {
            return closeTrade(
                trade,
                'WIN',
                i,
                entry.target,
                calculateWinR(entry, 'LONG')
            );
        }
    }

    return trade;
}

function simulateShort(entry, klines) {
    var trade = createTrade(entry, 'SHORT');
    var i;

    if (auditShortEntryBar(trade, entry, klines)) {
        return closeTrade(
            trade,
            'LOSS',
            entry.triggerIndex,
            entry.stop,
            -1
        );
    }

    for (i = entry.triggerIndex + 1; i < klines.length; i++) {
        if (klines[i].high >= entry.stop) {
            return closeTrade(
                trade,
                'LOSS',
                i,
                entry.stop,
                -1
            );
        }

        if (klines[i].low <= entry.target) {
            return closeTrade(
                trade,
                'WIN',
                i,
                entry.target,
                calculateWinR(entry, 'SHORT')
            );
        }
    }

    return trade;
}

function calculateStats(trades) {
    var stats = {
        total: 0,
        win: 0,
        loss: 0,
        winRate: 0,
        avgR: 0
    };
    var totalR = 0;
    var i;

    for (i = 0; i < trades.length; i++) {
        if (trades[i].status === 'WIN') {
            stats.total++;
            stats.win++;
            totalR += trades[i].r;
        }

        if (trades[i].status === 'LOSS') {
            stats.total++;
            stats.loss++;
            totalR += trades[i].r;
        }
    }

    if (stats.total > 0) {
        stats.winRate = stats.win / stats.total * 100;
        stats.avgR = totalR / stats.total;
    }

    return stats;
}

function analyze(input) {
    var trades = [];
    var entries;
    var klines;
    var entry;
    var i;

    input = input || {};
    entries = input.entries || [];
    klines = input.klines || [];

    for (i = 0; i < entries.length; i++) {
        entry = entries[i];

        if (
            entry.status !== 'ENTRY_TRIGGERED' ||
            typeof entry.triggerIndex !== 'number'
        ) {
            continue;
        }

        if (entry.type === 'LONG_ENTRY') {
            trades.push(simulateLong(entry, klines));
        }

        if (entry.type === 'SHORT_ENTRY') {
            trades.push(simulateShort(entry, klines));
        }
    }

    return {
        trades: trades,
        stats: calculateStats(trades)
    };
}

module.exports = {
    analyze: analyze
};
