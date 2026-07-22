var childProcess = require('child_process');
var fs = require('fs');
var path = require('path');
var StabilityExperiment = require(
    '../backtest/setupAgeStabilityExperiment'
);

var INTERVAL_MILLISECONDS = 5 * 60 * 1000;
var DEFAULT_ARCHIVE_DIRECTORY =
    '/tmp/ict-btcusdt-5m';

function parseCsv(text) {
    return text.trim().split(/\r?\n/).reduce(
        function (result, line) {
            var values = line.split(',');
            var openTime = Number(values[0]);

            if (!Number.isFinite(openTime)) {
                return result;
            }

            result.push({
                openTime: openTime,
                open: Number(values[1]),
                high: Number(values[2]),
                low: Number(values[3]),
                close: Number(values[4]),
                volume: Number(values[5]),
                closeTime: Number(values[6])
            });

            return result;
        },
        []
    );
}

function loadKlinesFromArchives(directory) {
    var byOpenTime = {};
    var archiveNames = fs.readdirSync(directory)
        .filter(function (name) {
            return /\.zip$/.test(name);
        })
        .sort();

    archiveNames.forEach(function (name) {
        var archivePath = path.join(directory, name);
        var csv = childProcess.execFileSync(
            'unzip',
            ['-p', archivePath],
            {
                encoding: 'utf8',
                maxBuffer: 32 * 1024 * 1024
            }
        );

        parseCsv(csv).forEach(function (kline) {
            byOpenTime[kline.openTime] = kline;
        });
    });

    return Object.keys(byOpenTime).map(function (openTime) {
        return byOpenTime[openTime];
    }).sort(function (left, right) {
        return left.openTime - right.openTime;
    });
}

function inspectContinuity(klines) {
    var gaps = [];
    var expected;
    var i;

    for (i = 1; i < klines.length; i++) {
        expected = klines[i - 1].openTime +
            INTERVAL_MILLISECONDS;

        if (klines[i].openTime !== expected) {
            gaps.push({
                after: klines[i - 1].openTime,
                before: klines[i].openTime,
                missingBars: Math.max(
                    0,
                    Math.round(
                        (klines[i].openTime - expected) /
                        INTERVAL_MILLISECONDS
                    )
                )
            });
        }
    }

    return gaps;
}

function withoutProgressLogs(callback) {
    var originalLog = console.log;
    var result;

    console.log = function () {};

    try {
        result = callback();
    } finally {
        console.log = originalLog;
    }

    return result;
}

function run(directory) {
    var klines = loadKlinesFromArchives(
        directory || DEFAULT_ARCHIVE_DIRECTORY
    );
    var gaps = inspectContinuity(klines);
    var results;

    if (!klines.length) {
        throw new Error('No Binance archive Klines found.');
    }

    results = withoutProgressLogs(function () {
        return StabilityExperiment.analyzeAllYears(klines);
    });

    return {
        source: 'Binance USD-M Futures official archive',
        symbol: 'BTCUSDT',
        interval: '5m',
        archiveDirectory:
            directory || DEFAULT_ARCHIVE_DIRECTORY,
        klineCount: klines.length,
        firstKlineTime: klines[0].openTime,
        lastKlineTime: klines[klines.length - 1].openTime,
        continuityGaps: gaps,
        years: results
    };
}

if (require.main === module) {
    try {
        console.log(JSON.stringify(
            run(process.argv[2]),
            null,
            2
        ));
    } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    INTERVAL_MILLISECONDS: INTERVAL_MILLISECONDS,
    DEFAULT_ARCHIVE_DIRECTORY: DEFAULT_ARCHIVE_DIRECTORY,
    parseCsv: parseCsv,
    loadKlinesFromArchives: loadKlinesFromArchives,
    inspectContinuity: inspectContinuity,
    run: run
};
