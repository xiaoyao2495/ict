'use strict';

var LifecycleRecorder = require(
  './ictOpportunityLifecycleRecorder'
);

var UNKNOWN_VALUE = 'UNAVAILABLE';
var TRANSITIONS = [
  {
    key: 'waitingOpportunityToWatchZone',
    from: 'WAITING_OPPORTUNITY',
    to: 'WATCH_ZONE',
  },
  {
    key: 'watchZoneToConfirming',
    from: 'WATCH_ZONE',
    to: 'CONFIRMING',
  },
  {
    key: 'confirmingToReadyObservation',
    from: 'CONFIRMING',
    to: 'READY_OBSERVATION',
  },
  {
    key: 'readyObservationToInvalidated',
    from: 'READY_OBSERVATION',
    to: 'INVALIDATED',
  },
];
var DIMENSIONS = [
  { key: 'biasSourceVersion', label: 'Bias Source Version' },
  { key: 'h4Bias', label: 'HTF Bias' },
  { key: 'structurePhase', label: 'Structure Phase' },
  { key: 'htfAlignment', label: 'HTF Alignment' },
  { key: 'liquidityType', label: 'Liquidity Type' },
  { key: 'direction', label: 'Direction' },
];

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function valueOrUnknown(value) {
  return value === undefined || value === null || value === ''
    ? UNKNOWN_VALUE
    : String(value);
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function normalizeCases(input) {
  var cases;
  if (Array.isArray(input)) cases = input;
  else if (isObject(input) && Array.isArray(input.cases)) {
    cases = input.cases;
  } else cases = [];
  return cases.map(function (item) {
    return isObject(item) && isObject(item.data)
      ? item.data
      : item;
  }).filter(function (item) {
    return isObject(item);
  }).map(clone);
}

function normalizeLifecycle(input) {
  var state = LifecycleRecorder.normalizeState(input);
  var records = [];
  Object.keys(state.symbols).sort().forEach(function (symbol) {
    var opportunities = state.symbols[symbol].opportunities;
    Object.keys(opportunities).sort().forEach(function (id) {
      records.push(clone(opportunities[id]));
    });
  });
  return records;
}

function normalizeSymbol(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function activeOpportunityFromRecord(record) {
  var events = Array.isArray(record && record.events)
    ? record.events
    : [];
  var index;
  for (index = 0; index < events.length; index += 1) {
    if (isObject(events[index].activeOpportunity)) {
      return events[index].activeOpportunity;
    }
  }
  return null;
}

function caseOpportunityId(caseData) {
  var gate = isObject(caseData && caseData.decisionGate)
    ? caseData.decisionGate
    : {};
  var active = isObject(gate.activeOpportunity)
    ? gate.activeOpportunity
    : null;
  var opportunity = isObject(caseData && caseData.opportunity)
    ? caseData.opportunity
    : {};
  var id = LifecycleRecorder.opportunityId(active);
  if (id) return id;
  id = LifecycleRecorder.opportunityId({
    direction: opportunity.direction,
    liquidityType: opportunity.liquidityType,
    price: opportunity.liquidityPrice === undefined
      ? opportunity.price
      : opportunity.liquidityPrice,
  });
  if (id) return id;
  return typeof caseData.opportunityId === 'string'
    ? caseData.opportunityId
    : null;
}

function recordKey(symbol, opportunityId) {
  var normalized = normalizeSymbol(symbol);
  if (!normalized || !opportunityId) return null;
  return normalized + '|' + opportunityId;
}

function casesByOpportunity(cases) {
  var groups = {};
  normalizeCases(cases).forEach(function (caseData) {
    var key = recordKey(
      caseData.symbol,
      caseOpportunityId(caseData)
    );
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(caseData);
  });
  return groups;
}

function outcomeCompleted(caseData) {
  var outcome = isObject(caseData && caseData.outcome)
    ? caseData.outcome
    : {};
  return outcome.trackingStatus === 'COMPLETED' ||
    Boolean(outcome.threeRAt);
}

function matchingCase(record, caseGroups) {
  var key = recordKey(record.symbol, record.opportunityId);
  var matches = key && Array.isArray(caseGroups[key])
    ? caseGroups[key]
    : [];
  if (matches.length === 0) return null;
  return matches.slice().sort(function (left, right) {
    var leftTime = Date.parse(left.createdAt);
    var rightTime = Date.parse(right.createdAt);
    var recordTime = Date.parse(record.createdAt);
    var leftDistance = isFinite(leftTime) && isFinite(recordTime)
      ? Math.abs(leftTime - recordTime)
      : Number.MAX_VALUE;
    var rightDistance = isFinite(rightTime) && isFinite(recordTime)
      ? Math.abs(rightTime - recordTime)
      : Number.MAX_VALUE;
    return leftDistance - rightDistance;
  })[0];
}

function hasTransition(record, from, to) {
  return Array.isArray(record && record.events) &&
    record.events.some(function (event) {
      return event.from === from && event.to === to;
    });
}

function reachedState(record, state) {
  if (record && record.currentState === state) return true;
  return Array.isArray(record && record.events) &&
    record.events.some(function (event) {
      return event.from === state || event.to === state;
    });
}

function contextFor(record, caseData) {
  var opportunity = activeOpportunityFromRecord(record) || {};
  var gate = isObject(caseData && caseData.decisionGate)
    ? caseData.decisionGate
    : {};
  var source = isObject(gate.sourceState)
    ? gate.sourceState
    : {};
  var caseOpportunity = isObject(caseData && caseData.opportunity)
    ? caseData.opportunity
    : {};
  var bias = isObject(caseData && caseData.htfBias)
    ? caseData.htfBias
    : {};
  var phase = isObject(caseData && caseData.structurePhase)
    ? caseData.structurePhase
    : {};
  var alignment = isObject(caseData && caseData.htfAlignment)
    ? caseData.htfAlignment
    : {};
  var htfContext = isObject(record && record.htfContext)
    ? record.htfContext
    : {};
  return {
    /*
     * biasSourceVersion 优先取生命周期记录的 htfContext，
     * 其次取 Golden Case 顶层字段，旧数据默认 htf_bias_v3。
     */
    biasSourceVersion: valueOrUnknown(
      htfContext.biasSourceVersion ||
      (caseData && caseData.biasSourceVersion) ||
      'htf_bias_v3'
    ),
    h4Bias: valueOrUnknown(
      source.h4Bias === undefined ? bias.bias : source.h4Bias
    ),
    structurePhase: valueOrUnknown(
      source.structurePhase === undefined
        ? phase.state
        : source.structurePhase
    ),
    htfAlignment: valueOrUnknown(
      source.htfAlignment === undefined
        ? alignment.status
        : source.htfAlignment
    ),
    liquidityType: valueOrUnknown(
      opportunity.liquidityType === undefined
        ? caseOpportunity.liquidityType
        : opportunity.liquidityType
    ),
    direction: valueOrUnknown(
      opportunity.direction === undefined
        ? caseOpportunity.direction
        : opportunity.direction
    ),
  };
}

function lifecycleFacts(record, caseData, relatedCases) {
  var watchZone = reachedState(record, 'WATCH_ZONE');
  var confirming = reachedState(record, 'CONFIRMING');
  var ready = reachedState(record, 'READY_OBSERVATION');
  var invalidated = reachedState(record, 'INVALIDATED');
  var completed = ready && relatedCases.some(outcomeCompleted);
  return {
    record: record,
    context: contextFor(record, caseData),
    watchZone: watchZone,
    confirming: confirming,
    ready: ready,
    invalidated: invalidated,
    watchToConfirming: hasTransition(
      record,
      'WATCH_ZONE',
      'CONFIRMING'
    ),
    confirmingToReady: hasTransition(
      record,
      'CONFIRMING',
      'READY_OBSERVATION'
    ),
    readyToInvalidated: hasTransition(
      record,
      'READY_OBSERVATION',
      'INVALIDATED'
    ),
    completedOutcome: completed,
  };
}

function emptyMetrics() {
  return {
    totalOpportunities: 0,
    watchZoneCount: 0,
    confirmingCount: 0,
    readyCount: 0,
    invalidatedCount: 0,
    watchToConfirmingCount: 0,
    confirmingToReadyCount: 0,
    completedOutcomeCount: 0,
  };
}

function addFact(metrics, fact) {
  metrics.totalOpportunities += 1;
  if (fact.watchZone) metrics.watchZoneCount += 1;
  if (fact.confirming) metrics.confirmingCount += 1;
  if (fact.ready) metrics.readyCount += 1;
  if (fact.invalidated) metrics.invalidatedCount += 1;
  if (fact.watchToConfirming) {
    metrics.watchToConfirmingCount += 1;
  }
  if (fact.confirmingToReady) {
    metrics.confirmingToReadyCount += 1;
  }
  if (fact.completedOutcome) {
    metrics.completedOutcomeCount += 1;
  }
}

function finalizeMetrics(metrics) {
  return {
    totalOpportunities: metrics.totalOpportunities,
    watchZoneCount: metrics.watchZoneCount,
    confirmingCount: metrics.confirmingCount,
    readyCount: metrics.readyCount,
    invalidatedCount: metrics.invalidatedCount,
    watchToConfirmingCount: metrics.watchToConfirmingCount,
    confirmingToReadyCount: metrics.confirmingToReadyCount,
    completedOutcomeCount: metrics.completedOutcomeCount,
    watchZoneToConfirmingRate: ratio(
      metrics.watchToConfirmingCount,
      metrics.watchZoneCount
    ),
    confirmingToReadyRate: ratio(
      metrics.confirmingToReadyCount,
      metrics.confirmingCount
    ),
    readyOutcomeSuccessRate: ratio(
      metrics.completedOutcomeCount,
      metrics.readyCount
    ),
  };
}

function dimensionGroups(facts, key) {
  var groups = {};
  facts.forEach(function (fact) {
    var value = fact.context[key] || UNKNOWN_VALUE;
    if (!groups[value]) groups[value] = emptyMetrics();
    addFact(groups[value], fact);
  });
  return Object.keys(groups).map(function (value) {
    var metrics = finalizeMetrics(groups[value]);
    metrics.value = value;
    return metrics;
  }).sort(function (left, right) {
    if (right.totalOpportunities !== left.totalOpportunities) {
      return right.totalOpportunities - left.totalOpportunities;
    }
    return left.value.localeCompare(right.value);
  });
}

function transitionStatistics(records) {
  var counts = {};
  var items = TRANSITIONS.map(function (definition) {
    var count = 0;
    records.forEach(function (record) {
      if (Array.isArray(record.events)) {
        record.events.forEach(function (event) {
          if (
            event.from === definition.from &&
            event.to === definition.to
          ) {
            count += 1;
          }
        });
      }
    });
    counts[definition.key] = count;
    return {
      key: definition.key,
      from: definition.from,
      to: definition.to,
      count: count,
    };
  });
  return { counts: counts, items: items };
}

function analyze(input, caseInput) {
  var options = isObject(input) && (
    Object.prototype.hasOwnProperty.call(input, 'lifecycle') ||
    Object.prototype.hasOwnProperty.call(input, 'lifecycleState') ||
    Object.prototype.hasOwnProperty.call(input, 'lifecycleData') ||
    Object.prototype.hasOwnProperty.call(input, 'cases') ||
    Object.prototype.hasOwnProperty.call(input, 'goldenCases')
  ) ? input : { lifecycle: input, cases: caseInput };
  var lifecycle = options.lifecycle;
  var cases = options.cases;
  if (lifecycle === undefined) lifecycle = options.lifecycleState;
  if (lifecycle === undefined) lifecycle = options.lifecycleData;
  if (cases === undefined) cases = options.goldenCases;
  var records = normalizeLifecycle(lifecycle);
  var caseGroups = casesByOpportunity(cases);
  var facts = records.map(function (record) {
    var key = recordKey(record.symbol, record.opportunityId);
    var relatedCases = key && caseGroups[key]
      ? caseGroups[key]
      : [];
    return lifecycleFacts(
      record,
      matchingCase(record, caseGroups),
      relatedCases
    );
  });
  var metrics = emptyMetrics();
  var transitions = transitionStatistics(records);
  var dimensions = {};

  facts.forEach(function (fact) {
    addFact(metrics, fact);
  });
  DIMENSIONS.forEach(function (dimension) {
    dimensions[dimension.key] = dimensionGroups(
      facts,
      dimension.key
    );
  });
  metrics = finalizeMetrics(metrics);

  return {
    totalOpportunities: records.length,
    overview: metrics,
    transitionCounts: transitions.counts,
    transitions: transitions.items,
    conversionRates: {
      watchZoneToConfirming: {
        eligibleCount: metrics.watchZoneCount,
        convertedCount: metrics.watchToConfirmingCount,
        rate: metrics.watchZoneToConfirmingRate,
      },
      confirmingToReady: {
        eligibleCount: metrics.confirmingCount,
        convertedCount: metrics.confirmingToReadyCount,
        rate: metrics.confirmingToReadyRate,
      },
      readyToCompletedOutcome: {
        eligibleCount: metrics.readyCount,
        convertedCount: metrics.completedOutcomeCount,
        rate: metrics.readyOutcomeSuccessRate,
      },
    },
    dimensions: dimensions,
  };
}

module.exports = {
  DIMENSIONS: clone(DIMENSIONS),
  TRANSITIONS: clone(TRANSITIONS),
  UNKNOWN_VALUE: UNKNOWN_VALUE,
  analyze: analyze,
  caseOpportunityId: caseOpportunityId,
  casesByOpportunity: casesByOpportunity,
  contextFor: contextFor,
  dimensionGroups: dimensionGroups,
  hasTransition: hasTransition,
  normalizeCases: normalizeCases,
  normalizeLifecycle: normalizeLifecycle,
  outcomeCompleted: outcomeCompleted,
  ratio: ratio,
  reachedState: reachedState,
  transitionStatistics: transitionStatistics,
};
