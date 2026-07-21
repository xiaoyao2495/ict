var Statistics = require('./statistics');

function isClosedTrade(trade) {
    return trade.status === 'WIN' ||
        trade.status === 'LOSS';
}

function filterTrades(trades, direction) {
    var result = [];
    var i;

    for (i = 0; i < trades.length; i++) {
        if (
            isClosedTrade(trades[i]) &&
            (!direction || trades[i].type === direction)
        ) {
            result.push(trades[i]);
        }
    }

    return result;
}

function getUtcHour(trade) {
    var value = trade.entryTime;
    var date;

    if (typeof value === 'undefined' || value === null) {
        value = trade.openTime;
    }

    if (typeof value === 'undefined' || value === null) {
        return null;
    }

    date = value instanceof Date
        ? value
        : new Date(value);

    if (isNaN(date.getTime())) {
        return null;
    }

    return date.getUTCHours();
}

function getReasonKey(trade) {
    var reasons = trade.reasons;

    if (!reasons && trade.setupReasons) {
        reasons = trade.setupReasons;
    }

    if (Object.prototype.toString.call(reasons) === '[object Array]') {
        if (reasons.length === 0) {
            return 'UNSPECIFIED';
        }

        return reasons.join(' -> ');
    }

    if (typeof reasons === 'string' && reasons.length > 0) {
        return reasons;
    }

    return 'UNSPECIFIED';
}

function createGroupItem(value, trades, propertyName) {
    var stats = Statistics.calculate(trades);
    var item = {
        trades: stats.total,
        winRate: stats.winRate,
        avgR: stats.avgR
    };

    item[propertyName] = value;

    return item;
}

function groupByUtcHour(trades) {
    var groups = {};
    var result = [];
    var hour;
    var key;
    var i;

    for (i = 0; i < trades.length; i++) {
        if (!isClosedTrade(trades[i])) {
            continue;
        }

        hour = getUtcHour(trades[i]);

        if (hour === null) {
            continue;
        }

        key = String(hour);

        if (!groups[key]) {
            groups[key] = [];
        }

        groups[key].push(trades[i]);
    }

    for (key in groups) {
        if (Object.prototype.hasOwnProperty.call(groups, key)) {
            result.push(
                createGroupItem(
                    Number(key),
                    groups[key],
                    'hour'
                )
            );
        }
    }

    result.sort(function (item1, item2) {
        return item1.hour - item2.hour;
    });

    return result;
}

function groupByReasons(trades) {
    var groups = {};
    var result = [];
    var key;
    var i;

    for (i = 0; i < trades.length; i++) {
        if (!isClosedTrade(trades[i])) {
            continue;
        }

        key = getReasonKey(trades[i]);

        if (!groups[key]) {
            groups[key] = [];
        }

        groups[key].push(trades[i]);
    }

    for (key in groups) {
        if (Object.prototype.hasOwnProperty.call(groups, key)) {
            result.push(
                createGroupItem(
                    key,
                    groups[key],
                    'reasons'
                )
            );
        }
    }

    result.sort(function (item1, item2) {
        if (item1.reasons < item2.reasons) {
            return -1;
        }

        if (item1.reasons > item2.reasons) {
            return 1;
        }

        return 0;
    });

    return result;
}

function generate(trades, statistics) {
    var closedTrades;

    trades = trades || [];
    closedTrades = filterTrades(trades);

    return {
        overall: statistics || Statistics.calculate(closedTrades),
        long: Statistics.calculate(
            filterTrades(closedTrades, 'LONG')
        ),
        short: Statistics.calculate(
            filterTrades(closedTrades, 'SHORT')
        ),
        byUtcHour: groupByUtcHour(closedTrades),
        bySetupReasons: groupByReasons(closedTrades)
    };
}

function formatNumber(value) {
    return Number(value || 0).toFixed(2);
}

function appendStatistics(lines, title, stats) {
    lines.push(title);
    lines.push('Total: ' + stats.total);
    lines.push('Win: ' + stats.win);
    lines.push('Loss: ' + stats.loss);
    lines.push('Win Rate: ' + formatNumber(stats.winRate) + '%');
    lines.push('Average R: ' + formatNumber(stats.avgR));
    lines.push('Expectancy: ' + formatNumber(stats.expectancy));
    lines.push('Max Win R: ' + formatNumber(stats.maxWinR));
    lines.push('Max Loss R: ' + formatNumber(stats.maxLossR));
    lines.push('Average Hold Bars: ' + formatNumber(stats.avgHoldBars));
    lines.push('Max Losing Streak: ' + stats.maxLosingStreak);
    lines.push('R Distribution:');
    lines.push('  0-1: ' + stats.rDistribution['0-1']);
    lines.push('  1-2: ' + stats.rDistribution['1-2']);
    lines.push('  2-3: ' + stats.rDistribution['2-3']);
    lines.push('  3+: ' + stats.rDistribution['3+']);
    lines.push('');
}

function formatText(report) {
    var lines = [];
    var item;
    var i;

    lines.push('=====================');
    lines.push('ICT Backtest Report');
    lines.push('=====================');
    lines.push('');

    appendStatistics(lines, 'OVERALL', report.overall);
    appendStatistics(lines, 'LONG', report.long);
    appendStatistics(lines, 'SHORT', report.short);

    lines.push('BY UTC HOUR');
    lines.push('Hour | Trades | Win Rate | Avg R');

    for (i = 0; i < report.byUtcHour.length; i++) {
        item = report.byUtcHour[i];
        lines.push(
            (item.hour < 10 ? '0' : '') + item.hour +
            ':00 | ' + item.trades +
            ' | ' + formatNumber(item.winRate) + '%' +
            ' | ' + formatNumber(item.avgR)
        );
    }

    lines.push('');
    lines.push('BY SETUP REASONS');
    lines.push('Reasons | Trades | Win Rate | Avg R');

    for (i = 0; i < report.bySetupReasons.length; i++) {
        item = report.bySetupReasons[i];
        lines.push(
            item.reasons +
            ' | ' + item.trades +
            ' | ' + formatNumber(item.winRate) + '%' +
            ' | ' + formatNumber(item.avgR)
        );
    }

    lines.push('');

    return lines.join('\n');
}

module.exports = {
    generate: generate,
    formatText: formatText
};
