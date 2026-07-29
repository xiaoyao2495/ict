'use strict';

const LtfExecution = require('./ictLtfExecutionEngine');

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function h4BiasOf(snapshot) {
  return LtfExecution.h4BiasOf(snapshot);
}

function isRetracement(structureState, h4Bias) {
  return (
    (h4Bias === 'BULLISH' && structureState === 'BEARISH') ||
    (h4Bias === 'BEARISH' && structureState === 'BULLISH')
  );
}

function expectedSweepSide(h4Bias) {
  if (h4Bias === 'BULLISH') return 'SELL_SIDE';
  if (h4Bias === 'BEARISH') return 'BUY_SIDE';
  return null;
}

function expectedStructureLabel(h4Bias) {
  if (h4Bias === 'BULLISH') return 'LH';
  if (h4Bias === 'BEARISH') return 'HL';
  return null;
}

function latestPreSweepLevel(structure, label, sweepIndex) {
  const sequence = structure &&
    Array.isArray(structure.swingSequence)
    ? structure.swingSequence
    : [];
  for (let index = sequence.length - 1; index >= 0; index -= 1) {
    const level = sequence[index];
    if (
      level.label === label &&
      Number.isInteger(level.availableIndex) &&
      level.availableIndex < sweepIndex
    ) {
      return level;
    }
  }
  return null;
}

function mssCandidate(pendingSweep, bar, index) {
  if (
    !pendingSweep ||
    !pendingSweep.level ||
    index <= pendingSweep.index
  ) {
    return null;
  }
  const level = pendingSweep.level;
  const bullish = (
    pendingSweep.h4Bias === 'BULLISH' &&
    bar.close > level.price
  );
  const bearish = (
    pendingSweep.h4Bias === 'BEARISH' &&
    bar.close < level.price
  );
  if (!bullish && !bearish) return null;
  return Object.freeze({
    direction: bullish ? 'BULLISH' : 'BEARISH',
    level,
    time: bar.closeTime,
    index,
    sweep: pendingSweep.sweep,
  });
}

function evaluateDeliveryConfirmation(input) {
  input = input || {};
  const expectedDirection = input.h4Bias === 'BULLISH'
    ? 'BULLISH'
    : input.h4Bias === 'BEARISH'
      ? 'BEARISH'
      : null;
  const expectedSide = expectedSweepSide(input.h4Bias);
  if (
    !expectedDirection ||
    input.retracementState !== (
      input.h4Bias === 'BULLISH' ? 'BEARISH' : 'BULLISH'
    ) ||
    !input.sweep ||
    input.sweep.side !== expectedSide ||
    !input.mss ||
    input.mss.direction !== expectedDirection ||
    !input.displacement ||
    input.displacement.direction !== expectedDirection
  ) {
    return null;
  }
  return expectedDirection;
}

function latestStructurePublicationIndex(structure) {
  const sequence = structure &&
    Array.isArray(structure.swingSequence)
    ? structure.swingSequence
    : [];
  return sequence.reduce((latest, swing) => (
    Number.isInteger(swing.availableIndex)
      ? Math.max(latest, swing.availableIndex)
      : latest
  ), -1);
}

function deliveryState(direction, relation) {
  if (relation === 'RETRACEMENT') return 'RETRACEMENT';
  if (relation === 'ALIGNED' && direction === 'BULLISH') {
    return 'ALIGNED_BULLISH';
  }
  if (relation === 'ALIGNED' && direction === 'BEARISH') {
    return 'ALIGNED_BEARISH';
  }
  return 'NEUTRAL';
}

function publicStructure(structure) {
  return {
    state: structure.state,
    swingSequence: structure.swingSequence,
    lastConfirmedSwingHigh: structure.lastConfirmedSwingHigh,
    lastConfirmedSwingLow: structure.lastConfirmedSwingLow,
  };
}

function primaryDrawOf(snapshot) {
  if (!snapshot) return null;
  if (
    snapshot.narrative &&
    snapshot.narrative.primaryDraw
  ) {
    return { ...snapshot.narrative.primaryDraw };
  }
  if (
    snapshot.liquidity &&
    snapshot.liquidity.primaryDraw
  ) {
    return { ...snapshot.liquidity.primaryDraw };
  }
  return null;
}

function analyze15mDelivery(input) {
  input = input || {};
  const klines = input.m15Klines;
  const h4States = input.h4BiasSnapshots || [];
  LtfExecution.validateClosedLtfKlines(
    klines,
    FIFTEEN_MINUTES
  );

  const structureTimeline =
    LtfExecution.buildLtfStructureTimeline(klines);
  const levels = LtfExecution.applyLiquidityLifecycle(
    LtfExecution.buildInternalLiquidity(structureTimeline)
      .concat(
        LtfExecution.buildExternalLiquidity(h4States, klines)
      ),
    klines
  );
  const liquidityTimeline =
    LtfExecution.buildLiquidityTimeline(levels, klines);
  const states = [];
  const events = {
    sweeps: liquidityTimeline.sweepEvents,
    mss: [],
    displacements: [],
    deliveryConfirmations: [],
  };
  let previousH4Bias = null;
  let pendingSweep = null;
  let confirmed = null;

  for (let index = 0; index < klines.length; index += 1) {
    const bar = klines[index];
    const h4Index = LtfExecution.latestSnapshotIndex(
      h4States,
      bar.closeTime
    );
    const h4Snapshot = h4Index >= 0
      ? h4States[h4Index]
      : null;
    const h4Bias = h4BiasOf(h4Snapshot);
    const structure =
      structureTimeline.states[index];
    const liquidity =
      liquidityTimeline.snapshots[index];

    if (h4Bias !== previousH4Bias) {
      pendingSweep = null;
      confirmed = null;
      previousH4Bias = h4Bias;
    }

    if (
      confirmed &&
      isRetracement(structure.state, h4Bias) &&
      latestStructurePublicationIndex(structure) >
        confirmed.index
    ) {
      confirmed = null;
    }

    const requiredSide = expectedSweepSide(h4Bias);
    const requiredLabel = expectedStructureLabel(h4Bias);
    const qualifyingSweeps = requiredSide &&
      isRetracement(structure.state, h4Bias)
      ? liquidity.currentSweeps.filter(
        (level) => level.side === requiredSide
      )
      : [];
    if (qualifyingSweeps.length > 0) {
      const sweep = LtfExecution.selectSweep(
        qualifyingSweeps,
        h4Bias,
        bar.close
      );
      const level = latestPreSweepLevel(
        structure,
        requiredLabel,
        index
      );
      if (level) {
        pendingSweep = Object.freeze({
          h4Bias,
          retracementState: structure.state,
          sweep,
          level,
          index,
          time: bar.closeTime,
        });
      }
    }

    const displacement =
      LtfExecution.detectDisplacement(
        klines,
        index,
        input.displacementOptions
      );
    if (displacement) {
      events.displacements.push(displacement);
    }
    const candidate = mssCandidate(
      pendingSweep,
      bar,
      index
    );
    const direction = evaluateDeliveryConfirmation({
      h4Bias,
      retracementState: pendingSweep
        ? pendingSweep.retracementState
        : null,
      sweep: pendingSweep ? pendingSweep.sweep : null,
      mss: candidate,
      displacement,
    });
    let currentMss = null;
    if (direction) {
      currentMss = candidate;
      events.mss.push(currentMss);
      confirmed = Object.freeze({
        direction,
        index,
        time: bar.closeTime,
        sweep: pendingSweep.sweep,
        mss: currentMss,
        displacement,
      });
      events.deliveryConfirmations.push(confirmed);
      pendingSweep = null;
    }

    let m15DeliveryDirection = 'NEUTRAL';
    let m15Relation = 'UNCLEAR';
    if (confirmed && confirmed.direction === h4Bias) {
      m15DeliveryDirection = confirmed.direction;
      m15Relation = 'ALIGNED';
    } else if (isRetracement(structure.state, h4Bias)) {
      m15Relation = 'RETRACEMENT';
    }

    states.push({
      index,
      availableIndex: index,
      time: bar.closeTime,
      referencePrice: bar.close,
      timeframe: '15m',
      structure: publicStructure(structure),
      liquidity: {
        activeLevels: liquidity.activeLevels,
        activeLevelCount: liquidity.activeLevelCount,
        sweptLevels: liquidity.sweptLevels,
        currentSweeps: liquidity.currentSweeps,
      },
      m15DeliveryDirection,
      m15Relation,
      deliveryDirection: m15DeliveryDirection,
      deliveryState: deliveryState(
        m15DeliveryDirection,
        m15Relation
      ),
      relationToH4: m15Relation,
      confirmation: {
        pendingSweep,
        mss: currentMss,
        displacement,
        latestConfirmed: confirmed,
      },
      h4Context: {
        snapshotTime: h4Snapshot
          ? h4Snapshot.time
          : null,
        bias: h4Bias,
        primaryDraw: primaryDrawOf(h4Snapshot),
      },
    });
  }

  return {
    protocol: {
      version: 'ICT_M15_DELIVERY_ENGINE_V1',
      input: 'Complete closed 15m Klines and published 4H snapshots',
      usesConfirmedSwings: true,
      usesAvailableIndex: true,
      capturesPreSweepStructureLevel: true,
      requiresSweepMssDisplacement: true,
      reads5m: false,
      readsTrades: false,
      generatesEntry: false,
      canModify4HBias: false,
    },
    swings: structureTimeline.swings,
    states,
    events,
  };
}

module.exports = {
  FIFTEEN_MINUTES,
  analyze: analyze15mDelivery,
  analyze15mDelivery,
  deliveryState,
  evaluateDeliveryConfirmation,
  expectedStructureLabel,
  expectedSweepSide,
  h4BiasOf,
  isRetracement,
  latestPreSweepLevel,
  latestStructurePublicationIndex,
  mssCandidate,
  primaryDrawOf,
  publicStructure,
};
