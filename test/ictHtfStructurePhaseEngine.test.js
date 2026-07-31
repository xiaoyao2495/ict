'use strict';

const assert = require('assert');
const PhaseEngine = require(
  '../indicators/ictHtfStructurePhaseEngine'
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

function event(type, availableIndex, values) {
  return {
    type,
    direction: type.indexOf('BULLISH_') === 0
      ? 'BULLISH'
      : 'BEARISH',
    breakIndex: availableIndex - 2,
    availableIndex,
    breakType: 'CLOSE_BREAK',
    level: 100,
    ...(values || {}),
  };
}

function swing(type, extremeIndex, availableIndex, price) {
  return {
    type,
    index: extremeIndex,
    extremeIndex,
    confirmationIndex: availableIndex,
    availableIndex,
    price,
  };
}

test('empty input remains UNDETERMINED', () => {
  const result = PhaseEngine.analyze({ endIndex: 3 });

  assert.strictEqual(
    result.structurePhase,
    PhaseEngine.PHASES.UNDETERMINED
  );
  assert.strictEqual(result.states.length, 4);
  assert.ok(result.states.every((state) => (
    state.structurePhase ===
      PhaseEngine.PHASES.UNDETERMINED
  )));
});

test('bearish structure and BOS produce continuation', () => {
  const result = PhaseEngine.analyze({
    structureEvents: [
      event('BEARISH_STRUCTURE_CONFIRMED', 2, {
        protectedHigh: 110,
      }),
      event('BEARISH_BOS', 5, {
        protectedHigh: 108,
      }),
    ],
    confirmedSwings: [],
    endIndex: 5,
  });

  assert.strictEqual(
    result.states[2].structurePhase,
    PhaseEngine.PHASES.BEARISH_CONTINUATION
  );
  assert.strictEqual(
    result.current.structurePhase,
    PhaseEngine.PHASES.BEARISH_CONTINUATION
  );
  assert.strictEqual(result.current.invalidationLevel, 108);
});

test('Bullish MSS does not directly confirm a new trend', () => {
  const result = PhaseEngine.analyze({
    events: [
      event('BEARISH_STRUCTURE_CONFIRMED', 2, {
        protectedHigh: 110,
      }),
      event('BULLISH_MSS', 6, {
        breakIndex: 4,
        oldProtectedHigh: 110,
        newProtectedLow: 90,
      }),
    ],
    swings: [],
    endIndex: 8,
  });

  assert.strictEqual(
    result.states[6].structurePhase,
    PhaseEngine.PHASES.BULLISH_MSS
  );
  assert.strictEqual(
    result.current.structurePhase,
    PhaseEngine.PHASES.BULLISH_MSS
  );
  assert.strictEqual(result.current.transitionPending, true);
});

test('Bullish MSS waits for a causal valid pullback', () => {
  const result = PhaseEngine.analyze({
    events: [
      event('BEARISH_STRUCTURE_CONFIRMED', 2),
      event('BULLISH_MSS', 6, {
        breakIndex: 4,
        newProtectedLow: 90,
      }),
    ],
    swings: [
      swing('LOW', 3, 7, 95),
      swing('LOW', 7, 9, 94),
    ],
    endIndex: 9,
  });

  assert.strictEqual(
    result.states[7].structurePhase,
    PhaseEngine.PHASES.BULLISH_MSS
  );
  assert.strictEqual(
    result.states[8].structurePhase,
    PhaseEngine.PHASES.BULLISH_MSS
  );
  assert.strictEqual(
    result.states[9].structurePhase,
    PhaseEngine.PHASES.BULLISH_PULLBACK
  );
  assert.strictEqual(
    result.current.context,
    PhaseEngine.CONTEXTS.POST_MSS
  );
});

test('pullback crossing MSS invalidation is rejected', () => {
  const result = PhaseEngine.analyze({
    events: [
      event('BEARISH_STRUCTURE_CONFIRMED', 2),
      event('BULLISH_MSS', 6, {
        breakIndex: 4,
        newProtectedLow: 90,
      }),
    ],
    swings: [
      swing('LOW', 7, 9, 89),
    ],
    endIndex: 9,
  });

  assert.strictEqual(
    result.current.structurePhase,
    PhaseEngine.PHASES.BULLISH_MSS
  );
  assert.strictEqual(result.current.pullbackSwing, null);
});

test('Bullish BOS confirms only after the post-MSS pullback', () => {
  const result = PhaseEngine.analyze({
    events: [
      event('BEARISH_STRUCTURE_CONFIRMED', 2),
      event('BULLISH_MSS', 6, {
        breakIndex: 4,
        newProtectedLow: 90,
      }),
      event('BULLISH_BOS', 8, {
        protectedLow: 90,
      }),
      event('BULLISH_BOS', 11, {
        protectedLow: 94,
      }),
    ],
    swings: [
      swing('LOW', 7, 9, 94),
    ],
    endIndex: 11,
  });

  assert.strictEqual(
    result.states[8].structurePhase,
    PhaseEngine.PHASES.BULLISH_MSS
  );
  assert.strictEqual(
    result.states[9].structurePhase,
    PhaseEngine.PHASES.BULLISH_PULLBACK
  );
  assert.strictEqual(
    result.current.structurePhase,
    PhaseEngine.PHASES.BULLISH_CONFIRMED
  );
  assert.strictEqual(result.current.transitionPending, false);
  assert.strictEqual(
    result.current.confirmationBos.availableIndex,
    11
  );
});

test('subsequent Bullish BOS becomes continuation', () => {
  const result = PhaseEngine.analyze({
    events: [
      event('BEARISH_STRUCTURE_CONFIRMED', 1),
      event('BULLISH_MSS', 4, {
        breakIndex: 2,
        newProtectedLow: 90,
      }),
      event('BULLISH_BOS', 8, {
        protectedLow: 94,
      }),
      event('BULLISH_BOS', 11, {
        protectedLow: 96,
      }),
    ],
    swings: [
      swing('LOW', 5, 6, 94),
    ],
    endIndex: 11,
  });

  assert.strictEqual(
    result.states[8].structurePhase,
    PhaseEngine.PHASES.BULLISH_CONFIRMED
  );
  assert.strictEqual(
    result.current.structurePhase,
    PhaseEngine.PHASES.BULLISH_CONTINUATION
  );
  assert.strictEqual(
    result.current.context,
    PhaseEngine.CONTEXTS.CONTINUATION
  );
});

test('Bearish MSS pullback and confirmation are symmetric', () => {
  const result = PhaseEngine.analyze({
    events: [
      event('BULLISH_STRUCTURE_CONFIRMED', 1, {
        protectedLow: 90,
      }),
      event('BEARISH_MSS', 4, {
        breakIndex: 2,
        oldProtectedLow: 90,
        newProtectedHigh: 110,
      }),
      event('BEARISH_BOS', 8, {
        protectedHigh: 106,
      }),
      event('BEARISH_BOS', 11, {
        protectedHigh: 104,
      }),
    ],
    swings: [
      swing('HIGH', 5, 6, 106),
    ],
    endIndex: 11,
  });

  assert.strictEqual(
    result.states[4].structurePhase,
    PhaseEngine.PHASES.BEARISH_MSS
  );
  assert.strictEqual(
    result.states[6].structurePhase,
    PhaseEngine.PHASES.BEARISH_PULLBACK
  );
  assert.strictEqual(
    result.states[8].structurePhase,
    PhaseEngine.PHASES.BEARISH_CONFIRMED
  );
  assert.strictEqual(
    result.current.structurePhase,
    PhaseEngine.PHASES.BEARISH_CONTINUATION
  );
});

test('opposite MSS overrides every active directional phase', () => {
  const result = PhaseEngine.analyze({
    events: [
      event('BULLISH_STRUCTURE_CONFIRMED', 1),
      event('BEARISH_MSS', 4, {
        breakIndex: 2,
        newProtectedHigh: 110,
      }),
      event('BULLISH_MSS', 7, {
        breakIndex: 5,
        newProtectedLow: 92,
      }),
    ],
    swings: [
      swing('HIGH', 5, 6, 106),
    ],
    endIndex: 7,
  });

  assert.strictEqual(
    result.states[6].structurePhase,
    PhaseEngine.PHASES.BEARISH_PULLBACK
  );
  assert.strictEqual(
    result.current.structurePhase,
    PhaseEngine.PHASES.BULLISH_MSS
  );
  assert.strictEqual(result.current.direction, 'BULLISH');
});

test('wick and liquidity-taken events do not change phase', () => {
  const result = PhaseEngine.analyze({
    events: [
      event('BEARISH_STRUCTURE_CONFIRMED', 1),
      event('BSL_TAKEN', 3, {
        breakType: 'WICK_BREAK',
      }),
      event('BULLISH_MSS', 5, {
        breakType: 'WICK_BREAK',
        newProtectedLow: 90,
      }),
    ],
    swings: [],
    endIndex: 5,
  });

  assert.strictEqual(
    result.current.structurePhase,
    PhaseEngine.PHASES.BEARISH_CONTINUATION
  );
});

test('future available data cannot alter a historical phase', () => {
  const events = [
    event('BEARISH_STRUCTURE_CONFIRMED', 1),
    event('BULLISH_MSS', 4, {
      breakIndex: 2,
      newProtectedLow: 90,
    }),
    event('BULLISH_BOS', 8, {
      protectedLow: 94,
    }),
  ];
  const swings = [
    swing('LOW', 5, 6, 94),
  ];
  const prefix = PhaseEngine.analyze({
    events: events.slice(0, 2),
    swings: [],
    endIndex: 4,
  });
  const full = PhaseEngine.analyze({
    events,
    swings,
    endIndex: 8,
  });

  assert.deepStrictEqual(
    full.states.slice(0, 5),
    prefix.states
  );
});

test('break and extreme indexes never publish before available', () => {
  const result = PhaseEngine.analyze({
    events: [
      event('BEARISH_STRUCTURE_CONFIRMED', 1),
      event('BULLISH_MSS', 6, {
        breakIndex: 3,
        newProtectedLow: 90,
      }),
    ],
    swings: [
      swing('LOW', 7, 9, 94),
    ],
    endIndex: 9,
  });

  assert.strictEqual(
    result.states[3].structurePhase,
    PhaseEngine.PHASES.BEARISH_CONTINUATION
  );
  assert.strictEqual(
    result.states[5].structurePhase,
    PhaseEngine.PHASES.BEARISH_CONTINUATION
  );
  assert.strictEqual(
    result.states[6].structurePhase,
    PhaseEngine.PHASES.BULLISH_MSS
  );
  assert.strictEqual(
    result.states[7].structurePhase,
    PhaseEngine.PHASES.BULLISH_MSS
  );
  assert.strictEqual(
    result.states[8].structurePhase,
    PhaseEngine.PHASES.BULLISH_MSS
  );
  assert.strictEqual(
    result.states[9].structurePhase,
    PhaseEngine.PHASES.BULLISH_PULLBACK
  );
});

test('analysis does not mutate events or swings', () => {
  const events = [
    event('BEARISH_STRUCTURE_CONFIRMED', 1),
    event('BULLISH_MSS', 4, {
      breakIndex: 2,
      newProtectedLow: 90,
    }),
  ];
  const swings = [
    swing('LOW', 5, 7, 94),
  ];
  const original = JSON.parse(JSON.stringify({
    events,
    swings,
  }));

  PhaseEngine.analyze({
    events,
    swings,
    endIndex: 7,
  });

  assert.deepStrictEqual({ events, swings }, original);
});

console.log('\n' + testsPassed + ' tests passed.');
