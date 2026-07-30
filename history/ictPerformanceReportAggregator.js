'use strict';

const OpportunityHistory = require(
  './ictOpportunityHistory'
);
const OutcomeTracker = require(
  './ictOpportunityOutcomeTracker'
);

const HISTORY_STATUSES = Object.freeze([
  'WAITING',
  'WATCH_ZONE',
  'CONFIRMING',
  'CONFIRMED',
]);

function rate(numerator, denominator) {
  return denominator > 0
    ? numerator / denominator
    : 0;
}

function elapsedMinutes(start, end) {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    endTime < startTime
  ) {
    return null;
  }
  return (endTime - startTime) / 60000;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length > 0
    ? valid.reduce((sum, value) => sum + value, 0) /
      valid.length
    : null;
}

function historyCoverage(input) {
  const history = OpportunityHistory.normalizeHistory(input);
  const statusCounts = Object.fromEntries(
    HISTORY_STATUSES.map((status) => [status, 0])
  );
  const times = [];
  let transitionCount = 0;

  for (const record of Object.values(history.symbols)) {
    for (const transition of record.transitions) {
      transitionCount += 1;
      statusCounts[transition.status] =
        (statusCounts[transition.status] || 0) + 1;
      times.push(Date.parse(transition.changedAt));
    }
  }
  const validTimes = times.filter(Number.isFinite);

  return {
    symbolCount: Object.keys(history.symbols).length,
    transitionCount,
    statusCounts,
    firstChangedAt: validTimes.length > 0
      ? new Date(Math.min(...validTimes)).toISOString()
      : null,
    lastChangedAt: validTimes.length > 0
      ? new Date(Math.max(...validTimes)).toISOString()
      : null,
  };
}

function isEligible(outcome) {
  return (
    Number.isFinite(outcome.entryNearbyPrice) &&
    Number.isFinite(outcome.riskUnit) &&
    outcome.riskUnit > 0
  );
}

function summarizeOutcomes(outcomes, label) {
  const eligible = outcomes.filter(isEligible);
  const oneR = eligible.filter(
    (outcome) => Boolean(outcome.oneRAt)
  );
  const twoR = eligible.filter(
    (outcome) => Boolean(outcome.twoRAt)
  );
  const threeR = eligible.filter(
    (outcome) => Boolean(outcome.threeRAt)
  );
  const failed = eligible.filter(
    (outcome) => outcome.failed === true
  );

  return {
    label,
    outcomeCount: outcomes.length,
    eligibleCount: eligible.length,
    oneRCount: oneR.length,
    oneRRate: rate(oneR.length, eligible.length),
    twoRCount: twoR.length,
    twoRRate: rate(twoR.length, eligible.length),
    threeRCount: threeR.length,
    threeRRate: rate(threeR.length, eligible.length),
    failedCount: failed.length,
    failedRate: rate(failed.length, eligible.length),
    averageMinutesToOneR: average(oneR.map(
      (outcome) => elapsedMinutes(
        outcome.confirmedAt,
        outcome.oneRAt
      )
    )),
    averageMinutesToTwoR: average(twoR.map(
      (outcome) => elapsedMinutes(
        outcome.confirmedAt,
        outcome.twoRAt
      )
    )),
    averageMinutesToThreeR: average(threeR.map(
      (outcome) => elapsedMinutes(
        outcome.confirmedAt,
        outcome.threeRAt
      )
    )),
  };
}

function groupOutcomes(outcomes, getLabel, fixedLabels) {
  const groups = new Map();
  for (const label of fixedLabels || []) {
    groups.set(label, []);
  }
  for (const outcome of outcomes) {
    const label = getLabel(outcome) || 'UNAVAILABLE';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(outcome);
  }
  return Array.from(groups.entries())
    .map(([label, items]) => (
      summarizeOutcomes(items, label)
    ))
    .sort((left, right) => (
      left.label.localeCompare(right.label)
    ));
}

function trackingStatusCounts(outcomes) {
  const result = {};
  for (const outcome of outcomes) {
    const status = outcome.trackingStatus || 'UNAVAILABLE';
    result[status] = (result[status] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(result).sort(
      ([left], [right]) => left.localeCompare(right)
    )
  );
}

function aggregate(input) {
  input = input || {};
  const history = OpportunityHistory.normalizeHistory(
    input.history
  );
  const outcomeState =
    OutcomeTracker.normalizeOutcomeState(
      input.outcomeState
    );
  const outcomes = outcomeState.outcomes;
  const confirmedEvents =
    OutcomeTracker.extractConfirmedEvents(history);
  const confirmedIds = new Set(
    confirmedEvents.map((event) => event.id)
  );
  const outcomeIds = new Set(
    outcomes.map((outcome) => outcome.id)
  );

  return {
    coverage: historyCoverage(history),
    statisticsText:
      typeof input.statisticsText === 'string'
        ? input.statisticsText.trim()
        : '',
    confirmedEventCount: confirmedEvents.length,
    overall: summarizeOutcomes(outcomes, 'ALL'),
    trackingStatusCounts: trackingStatusCounts(outcomes),
    bySymbol: groupOutcomes(
      outcomes,
      (outcome) => outcome.symbol
    ),
    byDirection: groupOutcomes(
      outcomes,
      (outcome) => outcome.direction,
      ['BULLISH', 'BEARISH']
    ),
    byLiquidityType: groupOutcomes(
      outcomes,
      (outcome) => outcome.liquidityType
    ),
    consistency: {
      matchedOutcomeCount: outcomes.filter(
        (outcome) => confirmedIds.has(outcome.id)
      ).length,
      missingOutcomeCount: confirmedEvents.filter(
        (event) => !outcomeIds.has(event.id)
      ).length,
      orphanOutcomeCount: outcomes.filter(
        (outcome) => !confirmedIds.has(outcome.id)
      ).length,
    },
  };
}

module.exports = {
  HISTORY_STATUSES,
  aggregate,
  average,
  elapsedMinutes,
  groupOutcomes,
  historyCoverage,
  isEligible,
  rate,
  summarizeOutcomes,
  trackingStatusCounts,
};
