var fs = require('fs');
var path = require('path');
var RunBacktest = require('./runBacktest');
var Statistics = require('../backtest/statistics');
var Report = require('../backtest/report');

var REPORT_DIRECTORY = path.join(__dirname, '..', 'reports');
var REPORT_PATH = path.join(
    REPORT_DIRECTORY,
    'latest-report.txt'
);

function createSetupMap(setups) {
    var result = {};
    var setup;
    var direction;
    var key;
    var i;

    for (i = 0; i < setups.length; i++) {
        setup = setups[i];
        direction = setup.type === 'LONG_SETUP'
            ? 'LONG'
            : 'SHORT';
        key = direction + ':' + setup.triggerIndex;

        if (!result[key]) {
            result[key] = setup;
        }
    }

    return result;
}

function getKlineTime(klines, index) {
    if (
        typeof index !== 'number' ||
        !klines[index]
    ) {
        return null;
    }

    return new Date(klines[index].openTime).toISOString();
}

function enrichTrades(trades, setups, klines) {
    var setupMap = createSetupMap(setups || []);
    var result = [];
    var trade;
    var setup;
    var item;
    var key;
    var property;
    var i;

    trades = trades || [];
    klines = klines || [];

    for (i = 0; i < trades.length; i++) {
        trade = trades[i];
        key = trade.type + ':' + trade.setupIndex;
        setup = setupMap[key];
        item = {};

        for (property in trade) {
            if (
                Object.prototype.hasOwnProperty.call(
                    trade,
                    property
                )
            ) {
                item[property] = trade[property];
            }
        }

        item.entryTime = getKlineTime(
            klines,
            trade.entryIndex
        );
        item.exitTime = getKlineTime(
            klines,
            trade.exitIndex
        );
        item.reasons = setup && setup.reasons
            ? setup.reasons.slice()
            : [];

        result.push(item);
    }

    return result;
}

function writeReport(text) {
    if (!fs.existsSync(REPORT_DIRECTORY)) {
        fs.mkdirSync(REPORT_DIRECTORY);
    }

    fs.writeFileSync(REPORT_PATH, text, 'utf8');

    return REPORT_PATH;
}

function generateReport() {
    return RunBacktest.runBacktest().then(function (result) {
        var trades = enrichTrades(
            result.backtest.trades,
            result.analysis.setups,
            result.klines
        );
        var statistics = Statistics.calculate(trades);
        var report = Report.generate(trades, statistics);
        var text = Report.formatText(report);
        var outputPath = writeReport(text);

        console.log('\nReport written to: ' + outputPath);

        return {
            path: outputPath,
            trades: trades,
            statistics: statistics,
            report: report,
            text: text
        };
    });
}

if (require.main === module) {
    generateReport().catch(function (error) {
        console.error(
            error.response
                ? error.response.data
                : error.message
        );
        process.exitCode = 1;
    });
}

module.exports = {
    REPORT_PATH: REPORT_PATH,
    enrichTrades: enrichTrades,
    writeReport: writeReport,
    generateReport: generateReport
};
