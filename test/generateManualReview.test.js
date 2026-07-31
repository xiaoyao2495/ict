'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const ManualReview = require(
  '../scripts/generateManualReview'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function entry(symbol, status, time, options) {
  options = options || {};
  return {
    symbol,
    h4Bias: options.h4Bias || 'BULLISH',
    direction: options.direction || 'BULLISH',
    liquidityType: options.liquidityType || 'PDL',
    liquidityPrice: options.liquidityPrice || 99,
    status,
    changedAt: time,
  };
}

function fixture() {
  const watch = entry(
    'BTCUSDT',
    'WATCH_ZONE',
    '2026-07-30T16:00:00Z'
  );
  const confirmed = entry(
    'BTCUSDT',
    'CONFIRMED',
    '2026-07-30T16:05:00Z'
  );
  return {
    history: {
      version: 1,
      symbols: {
        BTCUSDT: {
          current: confirmed,
          transitions: [watch, confirmed],
        },
      },
    },
    outcomeState: {
      version: 1,
      outcomes: [{
        id: 'btc-outcome',
        symbol: 'BTCUSDT',
        confirmedAt: '2026-07-30T16:05:00Z',
        direction: 'BULLISH',
        liquidityType: 'PDL',
        liquidityPrice: 99,
        entryNearbyPrice: 100,
        riskUnit: 1,
        oneRAt: '2026-07-30T16:15:00Z',
        twoRAt: null,
        threeRAt: null,
        failed: false,
        failedAt: null,
        trackingStatus: 'TRACKING',
      }],
    },
  };
}

function watchlistReports(structurePhase) {
  return {
    results: [{
      symbol: 'BTCUSDT',
      status: 'SUCCESS',
      report: {
        symbol: 'BTCUSDT',
        current: {
          ...(structurePhase === undefined
            ? {}
            : { structurePhase }),
        },
      },
    }],
  };
}

test('renders the complete manual review structure', () => {
  const text = ManualReview.renderManualReview({
    symbol: 'BTCUSDT',
    date: '2026-07-31',
    h4Bias: '',
    structure: '',
    structurePhase:
      ManualReview.buildStructurePhaseData(null),
    primaryLiquidity: '',
    opportunityStatus: '',
    watchZoneTime: '',
    liquidityType: '',
    liquidityPrice: '',
    sweep: '',
    mss: '',
    displacement: '',
    oneR: '',
    twoR: '',
    threeR: '',
    failed: '',
  });

  for (const heading of [
    '# ICT Manual Review',
    '## 4H HTF Bias',
    '## 【4小时结构阶段】',
    '## Opportunity',
    '## 5M Confirmation',
    '## Outcome',
    '## 人工复盘',
  ]) {
    assert(text.includes(heading));
  }
  assert(text.includes('为什么交易/不交易:'));
  assert(text.includes('截图:'));
  assert(text.includes('备注:'));
  assert(text.includes('state: UNDETERMINED'));
  assert(text.includes(
    '下一等待事件: 等待方向性4小时结构确认'
  ));
});

test('fills Structure Phase from Watchlist Analyst reports', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-manual-phase-')
  );
  const input = fixture();

  try {
    const result =
      await ManualReview.generateManualReview({
        ...input,
        reports: watchlistReports({
          state: 'BULLISH_CONFIRMED',
          direction: 'BULLISH',
          context: 'POST_MSS',
          mssEvent: {
            type: 'BULLISH_MSS',
            breakType: 'CLOSE_BREAK',
            level: 100,
          },
          confirmationBos: {
            type: 'BULLISH_BOS',
            breakType: 'CLOSE_BREAK',
            level: 110,
          },
        }),
        symbols: ['BTCUSDT'],
        date: '2026-07-31',
        outputDirectory: directory,
      });
    const saved = await fs.readFile(
      result.files[0].path,
      'utf8'
    );

    assert(saved.includes('state: BULLISH_CONFIRMED'));
    assert(saved.includes('direction: BULLISH'));
    assert(saved.includes('context: POST_MSS'));
    assert(saved.includes(
      'MSS来源: BULLISH_MSS'
    ));
    assert(saved.includes(
      'confirmation BOS: BULLISH_BOS'
    ));
    assert(saved.includes(
      '下一等待事件: 等待后续Bullish BOS或Bearish MSS'
    ));
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test('missing Structure Phase renders UNDETERMINED', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-manual-no-phase-')
  );
  const input = fixture();

  try {
    const result =
      await ManualReview.generateManualReview({
        ...input,
        reports: watchlistReports(),
        symbols: ['BTCUSDT'],
        date: '2026-07-31',
        outputDirectory: directory,
      });
    const saved = await fs.readFile(
      result.files[0].path,
      'utf8'
    );

    assert(saved.includes('state: UNDETERMINED'));
    assert(saved.includes('direction: --'));
    assert(saved.includes('context: --'));
    assert(saved.includes('MSS来源: 暂无'));
    assert(saved.includes('confirmation BOS: 暂无'));
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test('generates UTC+8 dated symbol file with available data', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-manual-review-')
  );
  const input = fixture();

  try {
    const result =
      await ManualReview.generateManualReview({
        ...input,
        symbols: ['btcusdt'],
        generatedAt: '2026-07-30T16:30:00Z',
        outputDirectory: directory,
      });
    const file = result.files[0];
    const saved = await fs.readFile(file.path, 'utf8');

    assert.strictEqual(result.date, '2026-07-31');
    assert.strictEqual(
      path.basename(file.path),
      '2026-07-31-BTCUSDT.md'
    );
    assert(saved.includes('方向: BULLISH'));
    assert(saved.includes('状态: CONFIRMED'));
    assert(saved.includes(
      'WATCH_ZONE时间: 2026-07-31 00:00:00'
    ));
    assert(saved.includes('关注流动性: PDL'));
    assert(saved.includes('价格: 99'));
    assert(saved.includes('1R: 2026-07-31 00:15:00'));
    assert(saved.includes('结构: '));
    assert(saved.includes('Sweep: '));
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test('generates one isolated template per symbol', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-manual-symbols-')
  );
  const input = fixture();

  try {
    const result =
      await ManualReview.generateManualReview({
        ...input,
        symbols: ['BTCUSDT', 'ETHUSDT'],
        date: '2026-07-31',
        outputDirectory: directory,
      });

    assert.deepStrictEqual(
      result.files.map((file) => file.symbol),
      ['BTCUSDT', 'ETHUSDT']
    );
    assert.strictEqual(
      (await fs.readdir(directory)).length,
      2
    );
    const eth = await fs.readFile(
      path.join(
        directory,
        '2026-07-31-ETHUSDT.md'
      ),
      'utf8'
    );
    assert(eth.includes('Symbol: ETHUSDT'));
    assert(eth.includes('方向: '));
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test('does not overwrite an existing manual review by default', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-manual-preserve-')
  );
  const filePath = path.join(
    directory,
    '2026-07-31-BTCUSDT.md'
  );
  const input = fixture();

  try {
    await fs.writeFile(
      filePath,
      '人工备注已填写',
      'utf8'
    );
    const result =
      await ManualReview.generateManualReview({
        ...input,
        symbols: ['BTCUSDT'],
        date: '2026-07-31',
        outputDirectory: directory,
      });

    assert.strictEqual(result.files[0].written, false);
    assert.strictEqual(
      await fs.readFile(filePath, 'utf8'),
      '人工备注已填写'
    );
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test('template generation does not mutate history or outcomes', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-manual-immutable-')
  );
  const input = fixture();
  const snapshot = JSON.stringify(input);

  try {
    await ManualReview.generateManualReview({
      ...input,
      symbols: ['BTCUSDT'],
      date: '2026-07-31',
      outputDirectory: directory,
    });
    assert.strictEqual(JSON.stringify(input), snapshot);
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

(async () => {
  for (const item of tests) {
    try {
      await item.callback();
      testsPassed += 1;
      console.log('PASS:', item.name);
    } catch (error) {
      console.error('FAIL:', item.name);
      throw error;
    }
  }
  console.log('\n' + testsPassed + ' tests passed.');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
