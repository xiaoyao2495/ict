'use strict';

const MAX_SWEEP_TO_MSS_BARS = 12;
const MAX_MSS_TO_DISPLACEMENT_BARS = 6;

function eventIndex(event, kind) {
  if (!event || typeof event !== 'object') return null;
  if (Number.isInteger(event.index)) return event.index;
  if (
    kind === 'sweep' &&
    Number.isInteger(event.sweptIndex)
  ) {
    return event.sweptIndex;
  }
  if (Number.isInteger(event.availableIndex)) {
    return event.availableIndex;
  }
  return null;
}

function expectedSweepSide(direction) {
  if (direction === 'BULLISH') return 'SELL_SIDE';
  if (direction === 'BEARISH') return 'BUY_SIDE';
  return null;
}

function sweepFromMss(mss) {
  if (!mss || !mss.sweep) return null;
  if (mss.sweep.level) {
    return {
      ...mss.sweep.level,
      side: mss.sweep.side || mss.sweep.level.side,
      index: mss.sweep.index,
      availableIndex: mss.sweep.index,
      time: mss.sweep.time,
    };
  }
  return mss.sweep;
}

function validateEventChain(input) {
  input = input || {};
  const sweep = input.sweep;
  const mss = input.mss;
  const displacement = input.displacement;
  const direction = mss && mss.direction;
  const sweepIndex = eventIndex(sweep, 'sweep');
  const mssIndex = eventIndex(mss, 'mss');
  const displacementIndex = eventIndex(
    displacement,
    'displacement'
  );

  if (
    !sweep ||
    !mss ||
    !displacement ||
    !expectedSweepSide(direction)
  ) {
    return {
      confirmed: false,
      direction: null,
      reason: 'INCOMPLETE_CHAIN',
    };
  }
  if (sweep.side !== expectedSweepSide(direction)) {
    return {
      confirmed: false,
      direction: null,
      reason: 'SWEEP_DIRECTION_MISMATCH',
    };
  }
  if (displacement.direction !== direction) {
    return {
      confirmed: false,
      direction: null,
      reason: 'DISPLACEMENT_DIRECTION_MISMATCH',
    };
  }
  if (
    !Number.isInteger(sweepIndex) ||
    !Number.isInteger(mssIndex) ||
    !Number.isInteger(displacementIndex) ||
    !(sweepIndex < mssIndex && mssIndex < displacementIndex)
  ) {
    return {
      confirmed: false,
      direction: null,
      reason: 'INVALID_EVENT_ORDER',
    };
  }
  if (
    mssIndex - sweepIndex >
    MAX_SWEEP_TO_MSS_BARS
  ) {
    return {
      confirmed: false,
      direction: null,
      reason: 'SWEEP_TO_MSS_TOO_FAR',
    };
  }
  if (
    displacementIndex - mssIndex >
    MAX_MSS_TO_DISPLACEMENT_BARS
  ) {
    return {
      confirmed: false,
      direction: null,
      reason: 'MSS_TO_DISPLACEMENT_TOO_FAR',
    };
  }
  return {
    confirmed: true,
    direction,
    reason: 'CONFIRMED_' + direction,
  };
}

function groupByIndex(events, kind) {
  const grouped = new Map();
  for (const event of events || []) {
    const index = eventIndex(event, kind);
    if (!Number.isInteger(index)) continue;
    if (!grouped.has(index)) grouped.set(index, []);
    grouped.get(index).push(event);
  }
  return grouped;
}

function analyze(input) {
  input = input || {};
  const events = input.events || {};
  const klines = input.ltf5mKlines;
  if (!Array.isArray(klines)) {
    throw new Error('Complete closed 5m Klines are required.');
  }

  const mssAt = groupByIndex(events.mss, 'mss');
  const displacementAt = groupByIndex(
    events.displacements,
    'displacement'
  );
  const pendingMss = [];
  const consumedMss = new Set();
  const confirmations = [];
  const states = [];

  for (let index = 0; index < klines.length; index += 1) {
    for (const mss of mssAt.get(index) || []) {
      pendingMss.push(mss);
    }
    const currentConfirmations = [];
    for (
      const displacement of
      displacementAt.get(index) || []
    ) {
      for (
        let candidateIndex = pendingMss.length - 1;
        candidateIndex >= 0;
        candidateIndex -= 1
      ) {
        const mss = pendingMss[candidateIndex];
        if (consumedMss.has(mss)) continue;
        const sweep = sweepFromMss(mss);
        const validation = validateEventChain({
          sweep,
          mss,
          displacement,
        });
        if (!validation.confirmed) continue;

        const confirmation = Object.freeze({
          status: 'CONFIRMED',
          direction: validation.direction,
          sweep,
          mss,
          displacement,
          index,
          availableIndex: index,
          time: klines[index].closeTime,
        });
        consumedMss.add(mss);
        confirmations.push(confirmation);
        currentConfirmations.push(confirmation);
        break;
      }
    }

    while (
      pendingMss.length > 0 &&
      index - eventIndex(pendingMss[0], 'mss') >
        MAX_MSS_TO_DISPLACEMENT_BARS
    ) {
      pendingMss.shift();
    }
    states.push({
      index,
      availableIndex: index,
      time: klines[index].closeTime,
      currentConfirmation:
        currentConfirmations[
          currentConfirmations.length - 1
        ] || null,
      latestConfirmation:
        confirmations[confirmations.length - 1] || null,
    });
  }

  return {
    protocol: {
      version: 'ICT_5M_CONFIRMATION_ENGINE_V1',
      eventOrder:
        'Sweep < MSS < Displacement',
      maxSweepToMssBars: MAX_SWEEP_TO_MSS_BARS,
      maxMssToDisplacementBars:
        MAX_MSS_TO_DISPLACEMENT_BARS,
      usesAvailableIndex: true,
      prefixInvariant: true,
      readsFutureCandles: false,
    },
    confirmations,
    states,
  };
}

module.exports = {
  MAX_MSS_TO_DISPLACEMENT_BARS,
  MAX_SWEEP_TO_MSS_BARS,
  analyze,
  eventIndex,
  expectedSweepSide,
  groupByIndex,
  sweepFromMss,
  validateEventChain,
};
