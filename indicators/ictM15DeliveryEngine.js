'use strict';

const LtfExecution = require('./ictLtfExecutionEngine');
const DeliveryStateMachine = require(
  './ictM15DeliveryStateMachine'
);

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
    deliveryInvalidations: [],
  };
  let previousH4Bias = null;
  let pendingSweep = null;
  let pendingMss = null;
  let confirmed = null;
  let stageState = null;
  let retracementExtreme = null;

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

    const biasChanged = h4Bias !== previousH4Bias;
    if (biasChanged) {
      pendingSweep = null;
      pendingMss = null;
      confirmed = null;
      retracementExtreme = null;
      previousH4Bias = h4Bias;
    }

    const retracementActive = isRetracement(
      structure.state,
      h4Bias
    );
    if (
      retracementActive &&
      !pendingMss &&
      !confirmed
    ) {
      if (h4Bias === 'BEARISH') {
        retracementExtreme =
          retracementExtreme === null
            ? bar.high
            : Math.max(retracementExtreme, bar.high);
      } else if (h4Bias === 'BULLISH') {
        retracementExtreme =
          retracementExtreme === null
            ? bar.low
            : Math.min(retracementExtreme, bar.low);
      }
    }

    const invalidationMss = pendingMss ||
      (confirmed ? confirmed.mss : null);
    const deliveryInvalidated =
      DeliveryStateMachine.deliveryInvalidated({
        h4Bias,
        retracementExtreme: invalidationMss
          ? invalidationMss.retracementExtreme
          : null,
        structureShiftIndex: invalidationMss
          ? invalidationMss.index
          : null,
        index,
        high: bar.high,
        low: bar.low,
      });
    if (deliveryInvalidated) {
      events.deliveryInvalidations.push(
        Object.freeze({
          direction: h4Bias,
          retracementExtreme:
            invalidationMss.retracementExtreme,
          index,
          availableIndex: index,
          time: bar.closeTime,
        })
      );
      pendingSweep = null;
      pendingMss = null;
      confirmed = null;
      retracementExtreme = null;
    }

    let confirmationReset = false;
    if (
      !deliveryInvalidated &&
      confirmed &&
      retracementActive &&
      latestStructurePublicationIndex(structure) >
        confirmed.index
    ) {
      confirmed = null;
      pendingSweep = null;
      pendingMss = null;
      retracementExtreme = null;
      confirmationReset = true;
    }

    const requiredSide = expectedSweepSide(h4Bias);
    const requiredLabel = expectedStructureLabel(h4Bias);
    const qualifyingSweeps = requiredSide &&
      retracementActive
      ? liquidity.currentSweeps.filter(
        (level) => level.side === requiredSide
      )
      : [];
    let liquidityTaken = false;
    if (
      !confirmed &&
      !pendingMss &&
      !deliveryInvalidated &&
      qualifyingSweeps.length > 0
    ) {
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
          retracementExtreme,
          index,
          time: bar.closeTime,
        });
        liquidityTaken = true;
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
    let currentMss = null;
    if (
      !confirmed &&
      !pendingMss &&
      !deliveryInvalidated
    ) {
      const candidate = mssCandidate(
        pendingSweep,
        bar,
        index
      );
      if (candidate) {
        currentMss = Object.freeze({
          ...candidate,
          retracementExtreme,
        });
        pendingMss = currentMss;
        events.mss.push(currentMss);
      }
    }
    const direction = evaluateDeliveryConfirmation({
      h4Bias,
      retracementState: pendingSweep
        ? pendingSweep.retracementState
        : null,
      sweep: pendingSweep ? pendingSweep.sweep : null,
      mss: pendingMss,
      displacement,
    });
    if (direction && !deliveryInvalidated) {
      confirmed = Object.freeze({
        direction,
        index,
        time: bar.closeTime,
        sweep: pendingSweep.sweep,
        mss: pendingMss,
        displacement,
      });
      events.deliveryConfirmations.push(confirmed);
      pendingSweep = null;
      pendingMss = null;
    }
    stageState = DeliveryStateMachine.transition(
      stageState,
      {
        h4Bias,
        retracement: retracementActive,
        liquidityTaken,
        structureShift: Boolean(currentMss),
        deliveryConfirmed: Boolean(direction),
        invalidated: deliveryInvalidated,
        reset: biasChanged || confirmationReset,
        index,
        time: bar.closeTime,
      }
    );

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
      m15DeliveryStage: stageState.stage,
      waitingLiquiditySide:
        stageState.waitingLiquiditySide,
      deliveryDirection: m15DeliveryDirection,
      deliveryState: deliveryState(
        m15DeliveryDirection,
        m15Relation
      ),
      relationToH4: m15Relation,
      confirmation: {
        pendingSweep,
        pendingMss,
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
      hasDeliveryStateMachine: true,
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
  DeliveryStateMachine,
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
