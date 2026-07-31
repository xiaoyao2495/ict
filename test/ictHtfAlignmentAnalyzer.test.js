'use strict';

const assert = require('assert');
const HtfAlignment = require(
  '../indicators/ictHtfAlignmentAnalyzer'
);
const HumanSummary = require(
  '../formatters/ictAnalystHumanSummary'
);

let testsPassed = 0;

function test(name, callback) {
  try {
    callback();
    testsPassed += 1;
    console.log('PASS:', name);
  } catch (error) {
    console.error('FAIL:', name);
    throw error;
  }
}

test('bullish Bias aligns with all established bullish phases', () => {
  for (const phase of HtfAlignment.BULLISH_PHASES) {
    assert.deepStrictEqual(
      HtfAlignment.analyze({
        biasDirection: 'BULLISH',
        structurePhase: { state: phase },
      }),
      {
        status: 'ALIGNED',
        biasDirection: 'BULLISH',
        structureDirection: 'BULLISH',
        reason: '4H Bias与Structure Phase方向一致',
      }
    );
  }
});

test('bearish Bias alignment is symmetric', () => {
  for (const phase of HtfAlignment.BEARISH_PHASES) {
    const result = HtfAlignment.analyze({
      biasDirection: 'BEARISH',
      structurePhase: { structurePhase: phase },
    });
    assert.strictEqual(result.status, 'ALIGNED');
    assert.strictEqual(
      result.structureDirection,
      'BEARISH'
    );
  }
});

test('opposing established directions are CONFLICT', () => {
  const bullishConflict = HtfAlignment.analyze({
    biasDirection: 'BULLISH',
    structurePhase: 'BEARISH_CONFIRMED',
  });
  const bearishConflict = HtfAlignment.analyze({
    biasDirection: 'BEARISH',
    structurePhase: 'BULLISH_CONTINUATION',
  });

  assert.strictEqual(bullishConflict.status, 'CONFLICT');
  assert.strictEqual(
    bullishConflict.structureDirection,
    'BEARISH'
  );
  assert.strictEqual(bearishConflict.status, 'CONFLICT');
  assert.strictEqual(
    bearishConflict.structureDirection,
    'BULLISH'
  );
});

test('unclear Bias and transition-only MSS are UNDETERMINED', () => {
  const noBias = HtfAlignment.analyze({
    biasDirection: 'NEUTRAL',
    structurePhase: 'BULLISH_CONFIRMED',
  });
  const transition = HtfAlignment.analyze({
    biasDirection: 'BULLISH',
    structurePhase: 'BULLISH_MSS',
  });

  assert.strictEqual(noBias.status, 'UNDETERMINED');
  assert.strictEqual(noBias.biasDirection, null);
  assert.strictEqual(transition.status, 'UNDETERMINED');
  assert.strictEqual(
    transition.structureDirection,
    'BULLISH'
  );
});

test('an opposing MSS direction is CONFLICT', () => {
  const result = HtfAlignment.analyze({
    biasDirection: 'BULLISH',
    structurePhase: 'BEARISH_MSS',
  });

  assert.strictEqual(result.status, 'CONFLICT');
  assert.strictEqual(result.biasDirection, 'BULLISH');
  assert.strictEqual(
    result.structureDirection,
    'BEARISH'
  );
});

test('analysis is read-only', () => {
  const input = {
    biasDirection: 'BULLISH',
    structurePhase: {
      state: 'BULLISH_PULLBACK',
      context: 'POST_MSS',
    },
  };
  const snapshot = JSON.stringify(input);

  HtfAlignment.analyze(input);

  assert.strictEqual(JSON.stringify(input), snapshot);
});

test('Human Summary displays HTF Alignment fields', () => {
  const lines = HumanSummary.htfAlignmentSectionLines({
    status: 'CONFLICT',
    biasDirection: 'BULLISH',
    structureDirection: 'BEARISH',
    reason: '4H Bias与Structure Phase方向冲突',
  }).join('\n');

  assert(lines.includes('【HTF Alignment】'));
  assert(lines.includes('状态：CONFLICT'));
  assert(lines.includes('Bias方向：BULLISH'));
  assert(lines.includes('结构方向：BEARISH'));
  assert(lines.includes(
    '说明：4H Bias与Structure Phase方向冲突'
  ));
});

console.log('\n' + testsPassed + ' tests passed.');
