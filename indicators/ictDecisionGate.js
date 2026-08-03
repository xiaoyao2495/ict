'use strict';

const STATES = Object.freeze({
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
  WAITING_HTF: 'WAITING_HTF',
  HTF_TRANSITION: 'HTF_TRANSITION',
  HTF_CONFLICT: 'HTF_CONFLICT',
  WAITING_OPPORTUNITY: 'WAITING_OPPORTUNITY',
  WATCH_ZONE: 'WATCH_ZONE',
  CONFIRMING: 'CONFIRMING',
  READY_OBSERVATION: 'READY_OBSERVATION',
  INVALIDATED: 'INVALIDATED',
});

const ACTIVE_STATES = new Set([
  STATES.WATCH_ZONE,
  STATES.CONFIRMING,
  STATES.READY_OBSERVATION,
  STATES.DATA_UNAVAILABLE,
]);

const TRANSITION_PHASES = new Set([
  'BULLISH_MSS',
  'BEARISH_MSS',
]);

function clone(value) {
  return value === undefined || value === null
    ? value === undefined ? null : value
    : JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function directionOf(value) {
  return value === 'BULLISH' || value === 'BEARISH'
    ? value
    : null;
}

function phaseOf(value) {
  if (typeof value === 'string') return value;
  if (!isObject(value)) return 'UNDETERMINED';
  return value.state ||
    value.structurePhase ||
    'UNDETERMINED';
}

function htfBiasOf(fourHourAnalysis) {
  const h4 = isObject(fourHourAnalysis)
    ? fourHourAnalysis
    : {};
  const dailyBias = isObject(h4.dailyBias)
    ? h4.dailyBias
    : {};
  if (
    dailyBias.marketBias === 'BULLISH' ||
    dailyBias.marketBias === 'BEARISH' ||
    dailyBias.marketBias === 'NEUTRAL'
  ) {
    return dailyBias.marketBias;
  }
  return h4.bias || 'UNAVAILABLE';
}

function dailyBiasTransitionContextOf(current) {
  const h4 = isObject(current) &&
    isObject(current.fourHourAnalysis)
    ? current.fourHourAnalysis
    : {};
  const dailyBias = isObject(h4.dailyBias)
    ? h4.dailyBias
    : {};
  const dailyStructure = dailyBias.structureState;
  if (dailyBias.structureContext === 'POST_MSS') {
    return 'POST_MSS';
  }
  if (dailyBias.context === 'POST_MSS') {
    return 'POST_MSS';
  }
  if (
    isObject(dailyStructure) &&
    dailyStructure.context === 'POST_MSS'
  ) {
    return 'POST_MSS';
  }
  if (dailyStructure === 'POST_MSS') {
    return 'POST_MSS';
  }
  const structurePhase = isObject(current) &&
    isObject(current.structurePhase)
    ? current.structurePhase
    : {};
  return structurePhase.context || null;
}

function isDailyBiasTransition(current) {
  const h4 = isObject(current) &&
    isObject(current.fourHourAnalysis)
    ? current.fourHourAnalysis
    : {};
  const dailyBias = isObject(h4.dailyBias)
    ? h4.dailyBias
    : {};
  return Boolean(
    dailyBias.marketBias === 'NEUTRAL' &&
    directionOf(dailyBias.transitionDirection) &&
    dailyBiasTransitionContextOf(current) === 'POST_MSS'
  );
}

function finiteTime(value) {
  if (Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventTime(event) {
  if (!isObject(event)) return null;
  return finiteTime(
    event.time === undefined
      ? event.confirmedAt
      : event.time
  );
}

function eventAvailableIndex(event) {
  if (!isObject(event)) return null;
  if (Number.isInteger(event.availableIndex)) {
    return event.availableIndex;
  }
  if (Number.isInteger(event.confirmationIndex)) {
    return event.confirmationIndex;
  }
  if (Number.isInteger(event.index)) return event.index;
  if (Number.isInteger(event.sweptIndex)) {
    return event.sweptIndex;
  }
  return null;
}

function currentTimeOf(current) {
  if (!isObject(current)) return null;
  const direct = finiteTime(
    current.asOf === undefined ? current.time : current.asOf
  );
  if (direct !== null) return direct;
  return eventTime(current.fiveMinuteObservation);
}

function currentAvailableIndexOf(current) {
  if (!isObject(current)) return null;
  if (Number.isInteger(current.availableIndex)) {
    return current.availableIndex;
  }
  if (Number.isInteger(current.index)) return current.index;
  return eventAvailableIndex(current.fiveMinuteObservation);
}

function opportunityId(opportunity) {
  if (!isObject(opportunity)) return null;
  const direction = directionOf(opportunity.direction);
  if (
    !direction ||
    typeof opportunity.liquidityType !== 'string' ||
    opportunity.liquidityType.length === 0 ||
    !Number.isFinite(opportunity.price) ||
    opportunity.price <= 0
  ) {
    return null;
  }
  return [
    direction,
    opportunity.liquidityType,
    String(opportunity.price),
  ].join('|');
}

function createOpportunity(opportunity, current) {
  const id = opportunityId(opportunity);
  if (!id) return null;
  return {
    id,
    direction: opportunity.direction,
    liquidityType: opportunity.liquidityType,
    price: opportunity.price,
    enteredAt: currentTimeOf(current),
    enteredAvailableIndex: currentAvailableIndexOf(current),
  };
}

function previousOpportunity(previousGateState) {
  if (
    !isObject(previousGateState) ||
    !isObject(previousGateState.activeOpportunity) ||
    typeof previousGateState.activeOpportunity.id !== 'string'
  ) {
    return null;
  }
  return clone(previousGateState.activeOpportunity);
}

function emptyProgress() {
  return {
    sweepCompleted: false,
    mssCompleted: false,
    displacementCompleted: false,
    strictConfirmationCompleted: false,
  };
}

function progressOf(previousGateState) {
  const value = isObject(previousGateState) &&
    isObject(previousGateState.progress)
    ? previousGateState.progress
    : {};
  return {
    sweepCompleted: value.sweepCompleted === true,
    mssCompleted: value.mssCompleted === true,
    displacementCompleted:
      value.displacementCompleted === true,
    strictConfirmationCompleted:
      value.strictConfirmationCompleted === true,
  };
}

function isAtOrAfterOpportunity(event, opportunity) {
  if (!event || !opportunity) return false;
  const sourceTime = eventTime(event);
  const enteredAt = finiteTime(opportunity.enteredAt);
  if (sourceTime !== null && enteredAt !== null) {
    return sourceTime >= enteredAt;
  }
  const sourceIndex = eventAvailableIndex(event);
  const enteredIndex = opportunity.enteredAvailableIndex;
  return Boolean(
    Number.isInteger(sourceIndex) &&
    Number.isInteger(enteredIndex) &&
    sourceIndex >= enteredIndex
  );
}

function expectedSweepSide(direction) {
  if (direction === 'BULLISH') return 'SELL_SIDE';
  if (direction === 'BEARISH') return 'BUY_SIDE';
  return null;
}

function sweepLevel(sweep) {
  if (!isObject(sweep)) return null;
  return isObject(sweep.level) ? sweep.level : sweep;
}

function sweepMatchesOpportunity(sweep, opportunity) {
  if (!isObject(sweep) || !opportunity) return false;
  const level = sweepLevel(sweep);
  const side = sweep.side || (level && level.side);
  if (side !== expectedSweepSide(opportunity.direction)) {
    return false;
  }
  if (!level) return false;
  return (
    level.type === opportunity.liquidityType &&
    Number.isFinite(level.price) &&
    level.price === opportunity.price
  );
}

function sameSweep(left, right) {
  if (!isObject(left) || !isObject(right)) return false;
  const leftLevel = sweepLevel(left);
  const rightLevel = sweepLevel(right);
  const leftSide = left.side || (leftLevel && leftLevel.side);
  const rightSide = right.side || (rightLevel && rightLevel.side);
  if (leftSide !== rightSide) return false;
  if (
    leftLevel &&
    rightLevel &&
    typeof leftLevel.type === 'string' &&
    typeof rightLevel.type === 'string' &&
    Number.isFinite(leftLevel.price) &&
    Number.isFinite(rightLevel.price)
  ) {
    return leftLevel.type === rightLevel.type &&
      leftLevel.price === rightLevel.price;
  }
  const leftTime = eventTime(left);
  const rightTime = eventTime(right);
  if (leftTime !== null && rightTime !== null) {
    return leftTime === rightTime;
  }
  const leftIndex = eventAvailableIndex(left);
  const rightIndex = eventAvailableIndex(right);
  return Number.isInteger(leftIndex) &&
    Number.isInteger(rightIndex) &&
    leftIndex === rightIndex;
}

function orderedEvents(sweep, mss, displacement) {
  const sweepTime = eventTime(sweep);
  const mssTime = eventTime(mss);
  const displacementTime = eventTime(displacement);
  if (
    sweepTime !== null &&
    mssTime !== null &&
    displacementTime !== null
  ) {
    return sweepTime < mssTime &&
      mssTime < displacementTime;
  }
  const sweepIndex = eventAvailableIndex(sweep);
  const mssIndex = eventAvailableIndex(mss);
  const displacementIndex = eventAvailableIndex(displacement);
  return Boolean(
    Number.isInteger(sweepIndex) &&
    Number.isInteger(mssIndex) &&
    Number.isInteger(displacementIndex) &&
    sweepIndex < mssIndex &&
    mssIndex < displacementIndex
  );
}

function validStrictConfirmation(
  confirmation,
  opportunity,
  biasDirection
) {
  if (
    !isObject(confirmation) ||
    confirmation.status !== 'CONFIRMED' ||
    confirmation.direction !== biasDirection ||
    confirmation.direction !== opportunity.direction ||
    !isObject(confirmation.sweep) ||
    !isObject(confirmation.mss) ||
    !isObject(confirmation.displacement)
  ) {
    return false;
  }
  if (
    confirmation.mss.direction !== biasDirection ||
    confirmation.displacement.direction !== biasDirection ||
    !sweepMatchesOpportunity(
      confirmation.sweep,
      opportunity
    ) ||
    !sameSweep(
      confirmation.sweep,
      confirmation.mss.sweep
    ) ||
    !orderedEvents(
      confirmation.sweep,
      confirmation.mss,
      confirmation.displacement
    )
  ) {
    return false;
  }
  return [
    confirmation.sweep,
    confirmation.mss,
    confirmation.displacement,
  ].every((event) => (
    isAtOrAfterOpportunity(event, opportunity)
  ));
}

function observationOf(current) {
  return isObject(current) &&
    isObject(current.fiveMinuteObservation)
    ? current.fiveMinuteObservation
    : {};
}

function currentConfirmedOf(current) {
  const observation = observationOf(current);
  return isObject(observation.currentConfirmed)
    ? observation.currentConfirmed
    : {};
}

function latestConfirmedOf(current) {
  const observation = observationOf(current);
  return isObject(observation.latestConfirmed)
    ? observation.latestConfirmed
    : {};
}

function strictConfirmationsOf(current) {
  const currentConfirmed = currentConfirmedOf(current);
  const latestConfirmed = latestConfirmedOf(current);
  const result = [];
  if (isObject(currentConfirmed.confirmation)) {
    result.push(currentConfirmed.confirmation);
  }
  if (
    isObject(latestConfirmed.confirmation) &&
    latestConfirmed.confirmation !==
      currentConfirmed.confirmation
  ) {
    result.push(latestConfirmed.confirmation);
  }
  return result;
}

function matchingStrictConfirmation(
  current,
  opportunity,
  biasDirection
) {
  return strictConfirmationsOf(current).find(
    (confirmation) => validStrictConfirmation(
      confirmation,
      opportunity,
      biasDirection
    )
  ) || null;
}

function opposingStrictConfirmation(
  current,
  opportunity
) {
  return strictConfirmationsOf(current).find(
    (confirmation) => (
      confirmation.status === 'CONFIRMED' &&
      directionOf(confirmation.direction) &&
      confirmation.direction !== opportunity.direction &&
      isAtOrAfterOpportunity(confirmation, opportunity)
    )
  ) || null;
}

function sweepCandidates(current) {
  const currentConfirmed = currentConfirmedOf(current);
  const latestConfirmed = latestConfirmedOf(current);
  const result = Array.isArray(
    currentConfirmed.liquiditySweeps
  )
    ? currentConfirmed.liquiditySweeps.slice()
    : [];
  if (isObject(latestConfirmed.liquiditySweep)) {
    result.push(latestConfirmed.liquiditySweep);
  }
  return result;
}

function mssCandidates(current) {
  const currentConfirmed = currentConfirmedOf(current);
  const latestConfirmed = latestConfirmedOf(current);
  return [currentConfirmed.mss, latestConfirmed.mss]
    .filter(isObject);
}

function eventProgress(current, opportunity, previousProgress) {
  const progress = {
    ...emptyProgress(),
    ...(previousProgress || {}),
  };
  const matchingSweep = sweepCandidates(current).find(
    (sweep) => (
      sweepMatchesOpportunity(sweep, opportunity) &&
      isAtOrAfterOpportunity(sweep, opportunity)
    )
  );
  if (matchingSweep) progress.sweepCompleted = true;

  const matchingMss = mssCandidates(current).find((mss) => (
    mss.direction === opportunity.direction &&
    isObject(mss.sweep) &&
    sweepMatchesOpportunity(mss.sweep, opportunity) &&
    isAtOrAfterOpportunity(mss.sweep, opportunity) &&
    isAtOrAfterOpportunity(mss, opportunity)
  ));
  if (matchingMss) {
    progress.sweepCompleted = true;
    progress.mssCompleted = true;
  }
  return progress;
}

function sourceStateOf(current) {
  const h4 = isObject(current) &&
    isObject(current.fourHourAnalysis)
    ? current.fourHourAnalysis
    : {};
  const htfAlignment = isObject(current) &&
    isObject(current.htfAlignment)
    ? current.htfAlignment
    : {};
  const opportunity = isObject(current) &&
    isObject(current.opportunity)
    ? current.opportunity
    : {};
  const ltfAlignment = isObject(current) &&
    isObject(current.alignment)
    ? current.alignment
    : {};
  const currentConfirmation = currentConfirmedOf(current)
    .confirmation;
  const latestConfirmation = latestConfirmedOf(current)
    .confirmation;
  const confirmation = isObject(currentConfirmation)
    ? currentConfirmation
    : isObject(latestConfirmation)
      ? latestConfirmation
      : {};
  return {
    h4Bias: htfBiasOf(h4),
    structurePhase: phaseOf(
      isObject(current) ? current.structurePhase : null
    ),
    htfAlignment: htfAlignment.status || 'UNAVAILABLE',
    opportunityStatus:
      opportunity.status || 'UNAVAILABLE',
    opportunityDirection:
      directionOf(opportunity.direction),
    ltfAlignment: ltfAlignment.status || 'UNAVAILABLE',
    confirmationDirection:
      directionOf(confirmation.direction),
  };
}

function requiredDataAvailable(current) {
  return Boolean(
    isObject(current) &&
    isObject(current.fourHourAnalysis) &&
    current.structurePhase !== undefined &&
    current.structurePhase !== null &&
    isObject(current.htfAlignment) &&
    isObject(current.opportunity) &&
    isObject(current.fiveMinuteObservation)
  );
}

function progressChanged(left, right) {
  const keys = Object.keys(emptyProgress());
  return keys.some((key) => (
    Boolean(left && left[key]) !== Boolean(right && right[key])
  ));
}

function finalize(result, previousGateState, current) {
  const previousState = isObject(previousGateState)
    ? previousGateState.state || null
    : null;
  const previousId = isObject(previousGateState) &&
    isObject(previousGateState.activeOpportunity)
    ? previousGateState.activeOpportunity.id || null
    : null;
  const currentId = result.activeOpportunity
    ? result.activeOpportunity.id
    : null;
  const changed = (
    previousState !== result.state ||
    previousId !== currentId ||
    progressChanged(
      isObject(previousGateState)
        ? previousGateState.progress
        : null,
      result.progress
    )
  );
  return {
    ...result,
    transition: {
      changed,
      from: previousState,
      to: result.state,
      reason: changed
        ? result.reasonCode
        : 'STATE_UNCHANGED',
      occurredAt: currentTimeOf(current),
    },
    informationalOnly: true,
  };
}

function resultFor(
  state,
  direction,
  activeOpportunity,
  progress,
  sourceState,
  blockers,
  reasonCode
) {
  return {
    state,
    direction,
    activeOpportunity: clone(activeOpportunity),
    progress: { ...emptyProgress(), ...(progress || {}) },
    sourceState,
    blockers: blockers.slice(),
    reasonCode,
  };
}

function invalidationReason(
  current,
  sourceState,
  opportunity,
  currentOpportunityId
) {
  if (!opportunity) return null;
  const biasDirection = directionOf(sourceState.h4Bias);
  if (!biasDirection || biasDirection !== opportunity.direction) {
    return 'HTF_DIRECTION_CHANGED';
  }
  if (sourceState.htfAlignment === 'CONFLICT') {
    return 'HTF_STRUCTURE_CONFLICT';
  }
  if (sourceState.htfAlignment !== 'ALIGNED') {
    return 'HTF_ALIGNMENT_LOST';
  }
  if (sourceState.ltfAlignment === 'CONFLICT') {
    return 'LTF_DIRECTION_CONFLICT';
  }
  const currentDirection = directionOf(
    current && current.opportunity
      ? current.opportunity.direction
      : null
  );
  if (
    currentDirection &&
    currentDirection !== opportunity.direction
  ) {
    return 'OPPORTUNITY_DIRECTION_MISMATCH';
  }
  if (opposingStrictConfirmation(current, opportunity)) {
    return 'OPPOSITE_CONFIRMATION';
  }
  if (
    currentOpportunityId &&
    currentOpportunityId !== opportunity.id
  ) {
    return 'OPPORTUNITY_REPLACED';
  }
  return null;
}

function analyze(input) {
  input = input || {};
  const current = input.current;
  const previousGateState = input.previousGateState || null;
  const sourceState = sourceStateOf(current);
  const previousActive = previousOpportunity(
    previousGateState
  );
  const previousProgress = progressOf(previousGateState);

  if (!requiredDataAvailable(current)) {
    return finalize(resultFor(
      STATES.DATA_UNAVAILABLE,
      null,
      previousActive,
      previousProgress,
      sourceState,
      ['REQUIRED_ANALYSIS_DATA_UNAVAILABLE'],
      'DATA_UNAVAILABLE'
    ), previousGateState, current);
  }

  const h4Bias = directionOf(sourceState.h4Bias);
  const opportunity = current.opportunity;
  const currentOpportunityId = opportunityId(opportunity);
  const hasPreviousLifecycle = Boolean(
    previousActive &&
    isObject(previousGateState) &&
    ACTIVE_STATES.has(previousGateState.state)
  );
  if (hasPreviousLifecycle) {
    const reason = invalidationReason(
      current,
      sourceState,
      previousActive,
      currentOpportunityId
    );
    if (reason) {
      return finalize(resultFor(
        STATES.INVALIDATED,
        null,
        null,
        previousProgress,
        sourceState,
        [reason],
        reason
      ), previousGateState, current);
    }
  }

  if (isDailyBiasTransition(current)) {
    return finalize(resultFor(
      STATES.HTF_TRANSITION,
      null,
      null,
      emptyProgress(),
      sourceState,
      ['WAITING_STRUCTURE_CONFIRMATION'],
      'HTF_STRUCTURE_TRANSITION'
    ), previousGateState, current);
  }

  if (!h4Bias) {
    return finalize(resultFor(
      STATES.WAITING_HTF,
      null,
      null,
      emptyProgress(),
      sourceState,
      ['HTF_BIAS_UNCLEAR'],
      'WAITING_FOR_HTF_BIAS'
    ), previousGateState, current);
  }

  if (sourceState.htfAlignment === 'CONFLICT') {
    return finalize(resultFor(
      STATES.HTF_CONFLICT,
      null,
      null,
      emptyProgress(),
      sourceState,
      ['HTF_STRUCTURE_CONFLICT'],
      'HTF_STRUCTURE_CONFLICT'
    ), previousGateState, current);
  }

  if (TRANSITION_PHASES.has(sourceState.structurePhase)) {
    return finalize(resultFor(
      STATES.HTF_TRANSITION,
      h4Bias,
      null,
      emptyProgress(),
      sourceState,
      ['WAITING_STRUCTURE_CONFIRMATION'],
      'HTF_STRUCTURE_TRANSITION'
    ), previousGateState, current);
  }

  if (sourceState.htfAlignment !== 'ALIGNED') {
    return finalize(resultFor(
      STATES.WAITING_HTF,
      h4Bias,
      null,
      emptyProgress(),
      sourceState,
      ['HTF_ALIGNMENT_UNDETERMINED'],
      'WAITING_FOR_HTF_ALIGNMENT'
    ), previousGateState, current);
  }

  let activeOpportunity = null;
  if (
    previousActive &&
    previousActive.direction === h4Bias &&
    hasPreviousLifecycle
  ) {
    activeOpportunity = previousActive;
  } else if (
    opportunity.status === 'WATCH_ZONE' &&
    opportunity.direction === h4Bias &&
    currentOpportunityId
  ) {
    activeOpportunity = createOpportunity(
      opportunity,
      current
    );
  }

  if (activeOpportunity) {
    const strictConfirmation = matchingStrictConfirmation(
      current,
      activeOpportunity,
      h4Bias
    );
    const progress = eventProgress(
      current,
      activeOpportunity,
      activeOpportunity === previousActive
        ? previousProgress
        : emptyProgress()
    );
    if (
      strictConfirmation ||
      (
        activeOpportunity === previousActive &&
        previousProgress.strictConfirmationCompleted
      )
    ) {
      progress.sweepCompleted = true;
      progress.mssCompleted = true;
      progress.displacementCompleted = true;
      progress.strictConfirmationCompleted = true;
      return finalize(resultFor(
        STATES.READY_OBSERVATION,
        h4Bias,
        activeOpportunity,
        progress,
        sourceState,
        [],
        'STRICT_CONFIRMATION_COMPLETED'
      ), previousGateState, current);
    }
    if (progress.sweepCompleted || progress.mssCompleted) {
      return finalize(resultFor(
        STATES.CONFIRMING,
        h4Bias,
        activeOpportunity,
        progress,
        sourceState,
        ['WAITING_STRICT_CONFIRMATION'],
        progress.mssCompleted
          ? 'MSS_COMPLETED'
          : 'SWEEP_COMPLETED'
      ), previousGateState, current);
    }
    if (
      opportunity.status !== 'WATCH_ZONE' &&
      activeOpportunity === previousActive
    ) {
      return finalize(resultFor(
        STATES.WAITING_OPPORTUNITY,
        h4Bias,
        null,
        emptyProgress(),
        sourceState,
        ['WATCH_ZONE_EXITED_WITHOUT_PROGRESS'],
        'WATCH_ZONE_EXITED'
      ), previousGateState, current);
    }
    return finalize(resultFor(
      STATES.WATCH_ZONE,
      h4Bias,
      activeOpportunity,
      progress,
      sourceState,
      ['WAITING_LTF_CONFIRMATION'],
      'OPPORTUNITY_ACTIVE'
    ), previousGateState, current);
  }

  const blockers = [];
  if (sourceState.ltfAlignment === 'CONFLICT') {
    blockers.push('LTF_DIRECTION_CONFLICT');
  }
  if (
    directionOf(opportunity.direction) &&
    opportunity.direction !== h4Bias
  ) {
    blockers.push('OPPORTUNITY_DIRECTION_MISMATCH');
  }
  if (
    opportunity.status === 'WATCH_ZONE' &&
    !currentOpportunityId
  ) {
    blockers.push('CONCRETE_LIQUIDITY_NOT_SELECTED');
  }
  if (blockers.length === 0) {
    blockers.push('WATCH_ZONE_NOT_ACTIVE');
  }
  return finalize(resultFor(
    STATES.WAITING_OPPORTUNITY,
    h4Bias,
    null,
    emptyProgress(),
    sourceState,
    blockers,
    'WAITING_FOR_OPPORTUNITY'
  ), previousGateState, current);
}

module.exports = {
  STATES,
  analyze,
  createOpportunity,
  eventAvailableIndex,
  eventProgress,
  eventTime,
  expectedSweepSide,
  dailyBiasTransitionContextOf,
  htfBiasOf,
  isAtOrAfterOpportunity,
  isDailyBiasTransition,
  opportunityId,
  orderedEvents,
  phaseOf,
  sourceStateOf,
  sweepMatchesOpportunity,
  validStrictConfirmation,
};
