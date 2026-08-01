'use strict';

var fs = require('fs');
var path = require('path');
var OpportunityIdentity = require(
  '../indicators/ictOpportunityIdentityV2'
);

var STATE_VERSION = 2;

var DEFAULT_LIFECYCLE_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-opportunity-lifecycle.json'
);

var SUPPORTED_STATES = {
  WATCH_ZONE: true,
  CONFIRMING: true,
  READY_OBSERVATION: true,
  INVALIDATED: true,
};

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function emptyState() {
  return {
    version: STATE_VERSION,
    symbols: {},
  };
}

function normalizeSymbol(value) {
  var symbol = typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
  return /^[A-Z0-9]{5,30}$/.test(symbol)
    ? symbol
    : null;
}

function normalizeTimestamp(value, fallback) {
  var candidate = value;
  var timestamp;
  if (candidate === undefined || candidate === null) {
    candidate = fallback;
  }
  if (candidate instanceof Date) {
    timestamp = candidate.getTime();
  } else if (typeof candidate === 'string') {
    timestamp = Date.parse(candidate);
  } else {
    timestamp = candidate;
  }
  if (typeof timestamp !== 'number' || !isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function opportunityId(activeOpportunity) {
  return OpportunityIdentity.rawOpportunityId(activeOpportunity);
}

function normalizeProgress(value) {
  value = isObject(value) ? value : {};
  return {
    sweepCompleted: value.sweepCompleted === true,
    mssCompleted: value.mssCompleted === true,
    displacementCompleted:
      value.displacementCompleted === true,
    strictConfirmationCompleted:
      value.strictConfirmationCompleted === true,
  };
}

function mergeProgress(previous, current) {
  previous = normalizeProgress(previous);
  current = normalizeProgress(current);
  return {
    sweepCompleted:
      previous.sweepCompleted || current.sweepCompleted,
    mssCompleted:
      previous.mssCompleted || current.mssCompleted,
    displacementCompleted:
      previous.displacementCompleted ||
      current.displacementCompleted,
    strictConfirmationCompleted:
      previous.strictConfirmationCompleted ||
      current.strictConfirmationCompleted,
  };
}

function progressAdvanced(previous, current) {
  previous = normalizeProgress(previous);
  current = normalizeProgress(current);
  return (
    (!previous.sweepCompleted && current.sweepCompleted) ||
    (!previous.mssCompleted && current.mssCompleted) ||
    (
      !previous.displacementCompleted &&
      current.displacementCompleted
    ) ||
    (
      !previous.strictConfirmationCompleted &&
      current.strictConfirmationCompleted
    )
  );
}

function normalizeEvent(value, fallbackTimestamp) {
  var timestamp;
  if (!isObject(value)) return null;
  timestamp = normalizeTimestamp(
    value.timestamp,
    fallbackTimestamp
  );
  if (!timestamp) return null;
  return {
    timestamp: timestamp,
    from: typeof value.from === 'string'
      ? value.from
      : null,
    to: typeof value.to === 'string'
      ? value.to
      : null,
    reasonCode: typeof value.reasonCode === 'string'
      ? value.reasonCode
      : null,
    activeOpportunity: value.activeOpportunity === undefined
      ? null
      : clone(value.activeOpportunity),
    progress: value.progress === undefined
      ? null
      : clone(value.progress),
  };
}

function normalizeAuditEvent(value, fallbackTimestamp) {
  var event = normalizeEvent(value, fallbackTimestamp);
  if (!event) return null;
  return {
    timestamp: event.timestamp,
    from: event.from,
    to: event.to,
    reasonCode: event.reasonCode,
    rawOpportunityId:
      typeof value.rawOpportunityId === 'string'
        ? value.rawOpportunityId
        : opportunityId(event.activeOpportunity),
    canonicalZoneId:
      typeof value.canonicalZoneId === 'string'
        ? value.canonicalZoneId
        : null,
    sameZone: value.sameZone === true,
    identityReason:
      typeof value.identityReason === 'string'
        ? value.identityReason
        : null,
    activeOpportunity: event.activeOpportunity,
    progress: event.progress,
  };
}

function opportunityFromId(value) {
  var parts;
  var price;
  if (typeof value !== 'string') return null;
  parts = value.split('|');
  if (parts.length < 3) return null;
  price = Number(parts[2]);
  return OpportunityIdentity.normalizeOpportunity({
    direction: parts[0],
    liquidityType: parts[1],
    price: price,
  });
}

function firstRecordOpportunity(value, events, id) {
  var source;
  if (isObject(value.identity)) {
    source = {
      direction: value.identity.direction,
      liquidityType: value.identity.liquidityType,
      price: value.identity.anchorPrice,
    };
    if (OpportunityIdentity.normalizeOpportunity(source)) {
      return source;
    }
  }
  if (events.length > 0) {
    source = events[0].activeOpportunity;
    if (OpportunityIdentity.normalizeOpportunity(source)) {
      return source;
    }
  }
  return opportunityFromId(id);
}

function normalizeIdentity(value, opportunity, createdAt) {
  var source = isObject(value) && isObject(value.identity)
    ? value.identity
    : null;
  var normalized;
  if (source) {
    normalized = OpportunityIdentity.previousZone(source);
    if (normalized) return normalized;
  }
  if (!OpportunityIdentity.normalizeOpportunity(opportunity)) {
    return null;
  }
  return OpportunityIdentity.resolve({
    opportunity: opportunity,
    observedAt: createdAt,
    tolerancePercent: isObject(value)
      ? value.tolerancePercent
      : undefined,
    toleranceSource: isObject(value)
      ? value.toleranceSource
      : undefined,
    maxZoneAgeMs: isObject(value)
      ? value.maxZoneAgeMs
      : undefined,
  });
}

function appendUnique(values, value) {
  var result = Array.isArray(values) ? values.slice() : [];
  if (typeof value === 'string' && result.indexOf(value) < 0) {
    result.push(value);
  }
  return result;
}

function rawIdsFromEvents(events, seed) {
  var ids = Array.isArray(seed) ? seed.slice() : [];
  events.forEach(function (event) {
    ids = appendUnique(
      ids,
      opportunityId(event.activeOpportunity)
    );
  });
  return ids;
}

function normalizeRecord(value, fallbackSymbol) {
  var symbol;
  var events;
  var auditEvents;
  var id;
  var canonicalZoneId;
  var createdAt;
  var currentState;
  var opportunity;
  var identity;
  var rawOpportunityIds;
  var progress;
  if (!isObject(value)) return null;
  symbol = normalizeSymbol(value.symbol || fallbackSymbol);
  if (!symbol) return null;
  events = Array.isArray(value.events)
    ? value.events.map(function (event) {
      return normalizeEvent(event, value.createdAt);
    }).filter(function (event) {
      return event !== null;
    })
    : [];
  id = typeof value.opportunityId === 'string' &&
    value.opportunityId
    ? value.opportunityId
    : opportunityId(
      events.length > 0
        ? events[0].activeOpportunity
        : null
    );
  if (!id) return null;
  createdAt = normalizeTimestamp(
    value.createdAt,
    events.length > 0 ? events[0].timestamp : null
  );
  if (!createdAt) return null;
  canonicalZoneId = typeof value.canonicalZoneId === 'string' &&
    value.canonicalZoneId
    ? value.canonicalZoneId
    : id;
  opportunity = firstRecordOpportunity(value, events, id);
  identity = normalizeIdentity(value, opportunity, createdAt);
  if (identity && identity.zoneId !== canonicalZoneId) {
    identity.zoneId = canonicalZoneId;
    identity.canonicalZoneId = canonicalZoneId;
  }
  rawOpportunityIds = rawIdsFromEvents(
    events,
    Array.isArray(value.rawOpportunityIds)
      ? value.rawOpportunityIds
      : []
  );
  if (identity) {
    identity.rawOpportunityIds.forEach(function (rawId) {
      rawOpportunityIds = appendUnique(rawOpportunityIds, rawId);
    });
  }
  rawOpportunityIds = appendUnique(rawOpportunityIds, id);
  auditEvents = Array.isArray(value.auditEvents)
    ? value.auditEvents.map(function (event) {
      return normalizeAuditEvent(event, createdAt);
    }).filter(function (event) {
      return event !== null;
    })
    : [];
  currentState = typeof value.currentState === 'string'
    ? value.currentState
    : events.length > 0
      ? events[events.length - 1].to
      : null;
  progress = normalizeProgress(
    value.progress || (
      events.length > 0
        ? events[events.length - 1].progress
        : null
    )
  );
  return {
    opportunityId: id,
    canonicalZoneId: canonicalZoneId,
    symbol: symbol,
    createdAt: createdAt,
    events: events,
    auditEvents: auditEvents,
    rawOpportunityIds: rawOpportunityIds,
    identity: identity,
    progress: progress,
    currentState: currentState,
    completed: value.completed === true,
  };
}

function addNormalizedRecord(state, value, fallbackSymbol) {
  var record = normalizeRecord(value, fallbackSymbol);
  var symbolState;
  if (!record) return;
  symbolState = state.symbols[record.symbol];
  if (!symbolState) {
    symbolState = {
      currentOpportunityId: null,
      opportunities: {},
    };
    state.symbols[record.symbol] = symbolState;
  }
  symbolState.opportunities[record.opportunityId] = record;
  if (!record.completed) {
    symbolState.currentOpportunityId = record.opportunityId;
  }
}

function normalizeState(value) {
  var state = emptyState();
  var symbols = isObject(value) && isObject(value.symbols)
    ? value.symbols
    : {};
  Object.keys(symbols).forEach(function (symbol) {
    var source = symbols[symbol];
    var opportunities = isObject(source) &&
      isObject(source.opportunities)
      ? source.opportunities
      : {};
    Object.keys(opportunities).forEach(function (id) {
      addNormalizedRecord(state, opportunities[id], symbol);
    });
    if (
      state.symbols[symbol] &&
      isObject(source) &&
      typeof source.currentOpportunityId === 'string' &&
      state.symbols[symbol].opportunities[
        source.currentOpportunityId
      ]
    ) {
      state.symbols[symbol].currentOpportunityId =
        source.currentOpportunityId;
    }
  });

  if (isObject(value) && Array.isArray(value.opportunities)) {
    value.opportunities.forEach(function (record) {
      addNormalizedRecord(state, record, null);
    });
  }
  if (isObject(value) && Array.isArray(value.records)) {
    value.records.forEach(function (record) {
      addNormalizedRecord(state, record, null);
    });
  }
  return state;
}

function reportCurrent(input) {
  var report = isObject(input) && isObject(input.report)
    ? input.report
    : input;
  return isObject(report) && isObject(report.current)
    ? report.current
    : report;
}

function inputSymbol(input) {
  var report = isObject(input) && isObject(input.report)
    ? input.report
    : input;
  return normalizeSymbol(
    isObject(input) && input.symbol
      ? input.symbol
      : isObject(report)
        ? report.symbol
        : null
  );
}

function extractTransition(input, recordedAt) {
  var current = reportCurrent(input);
  var gate = isObject(current) && isObject(current.decisionGate)
    ? current.decisionGate
    : isObject(input) && isObject(input.decisionGate)
      ? input.decisionGate
      : null;
  var transition;
  var timestamp;
  var identityOpportunity;
  var symbol = inputSymbol(input);
  if (!symbol || !gate || !isObject(gate.transition)) {
    return null;
  }
  transition = gate.transition;
  if (
    transition.changed !== true ||
    !SUPPORTED_STATES[gate.state]
  ) {
    return null;
  }
  timestamp = normalizeTimestamp(
    transition.occurredAt,
    recordedAt
  );
  if (!timestamp) return null;
  identityOpportunity = OpportunityIdentity.normalizeOpportunity(
    gate.activeOpportunity
  ) || OpportunityIdentity.normalizeOpportunity(
    isObject(current) ? current.opportunity : null
  );
  return {
    symbol: symbol,
    state: gate.state,
    opportunityId: opportunityId(gate.activeOpportunity),
    identityOpportunity: identityOpportunity,
    event: {
      timestamp: timestamp,
      from: typeof transition.from === 'string'
        ? transition.from
        : null,
      to: typeof transition.to === 'string'
        ? transition.to
        : gate.state,
      reasonCode: typeof gate.reasonCode === 'string'
        ? gate.reasonCode
        : null,
      activeOpportunity: gate.activeOpportunity === undefined
        ? null
        : clone(gate.activeOpportunity),
      progress: gate.progress === undefined
        ? null
        : clone(gate.progress),
    },
  };
}

function sameTransition(left, right) {
  if (!left || !right) return false;
  return (
    left.from === right.from &&
    left.to === right.to &&
    left.reasonCode === right.reasonCode &&
    JSON.stringify(left.activeOpportunity) ===
      JSON.stringify(right.activeOpportunity) &&
    JSON.stringify(left.progress) ===
      JSON.stringify(right.progress)
  );
}

function sameAuditEvent(left, right) {
  if (!left || !right) return false;
  return (
    left.from === right.from &&
    left.to === right.to &&
    left.reasonCode === right.reasonCode &&
    left.rawOpportunityId === right.rawOpportunityId &&
    left.canonicalZoneId === right.canonicalZoneId &&
    JSON.stringify(left.activeOpportunity) ===
      JSON.stringify(right.activeOpportunity) &&
    JSON.stringify(left.progress) ===
      JSON.stringify(right.progress)
  );
}

function createAuditEvent(event, identity, rawId) {
  return {
    timestamp: event.timestamp,
    from: event.from,
    to: event.to,
    reasonCode: event.reasonCode,
    rawOpportunityId: rawId,
    canonicalZoneId: identity ? identity.zoneId : null,
    sameZone: identity ? identity.sameZone === true : false,
    identityReason: identity ? identity.reason : null,
    activeOpportunity: clone(event.activeOpportunity),
    progress: clone(event.progress),
  };
}

function appendAuditEvent(events, event) {
  var result = Array.isArray(events) ? events.slice() : [];
  var previous = result.length > 0
    ? result[result.length - 1]
    : null;
  if (!sameAuditEvent(previous, event)) {
    result.push(clone(event));
  }
  return result;
}

function resolveIdentity(opportunity, record, timestamp) {
  if (!OpportunityIdentity.normalizeOpportunity(opportunity)) {
    return null;
  }
  return OpportunityIdentity.resolve({
    opportunity: opportunity,
    previousIdentity: record ? record.identity : null,
    observedAt: timestamp,
  });
}

function lifecycleId(symbolState, identity, timestamp) {
  var base = identity.zoneId;
  var suffix;
  var candidate;
  if (!symbolState.opportunities[base]) return base;
  suffix = normalizeTimestamp(timestamp, timestamp) || 'NEW';
  candidate = base + '@' + suffix;
  while (symbolState.opportunities[candidate]) {
    candidate += '@NEW';
  }
  return candidate;
}

function stateRank(value) {
  if (value === 'WATCH_ZONE') return 1;
  if (value === 'CONFIRMING') return 2;
  if (value === 'READY_OBSERVATION') return 3;
  return 0;
}

function monotonicState(previous, current) {
  if (!previous) return current;
  if (current === 'INVALIDATED') return current;
  return stateRank(current) < stateRank(previous)
    ? previous
    : current;
}

function applyTransition(rawState, input, recordedAt) {
  var state = normalizeState(rawState);
  var extracted = extractTransition(input, recordedAt);
  var symbolState;
  var currentId;
  var currentRecord;
  var identity;
  var rawId;
  var id;
  var record;
  var events;
  var previousEvent;
  var auditEvent;
  var auditEvents;
  var mergedProgress;
  var canonicalState;
  var canonicalEvent;
  var canonicalChanged;
  var auditChanged;
  if (!extracted) {
    return {
      changed: false,
      state: state,
      record: null,
      event: null,
      auditEvent: null,
    };
  }
  symbolState = state.symbols[extracted.symbol];
  if (!symbolState) {
    symbolState = {
      currentOpportunityId: null,
      opportunities: {},
    };
    state.symbols[extracted.symbol] = symbolState;
  }
  currentId = symbolState.currentOpportunityId;
  currentRecord = currentId
    ? symbolState.opportunities[currentId]
    : null;
  identity = resolveIdentity(
    extracted.identityOpportunity,
    currentRecord,
    extracted.event.timestamp
  );
  rawId = extracted.opportunityId || opportunityId(
    extracted.identityOpportunity
  );

  if (
    extracted.state === 'INVALIDATED' &&
    extracted.event.reasonCode === 'OPPORTUNITY_REPLACED' &&
    currentRecord &&
    identity &&
    identity.sameZone
  ) {
    auditEvent = createAuditEvent(
      extracted.event,
      identity,
      rawId
    );
    auditEvents = appendAuditEvent(
      currentRecord.auditEvents,
      auditEvent
    );
    auditChanged = auditEvents.length !==
      currentRecord.auditEvents.length;
    record = {
      opportunityId: currentRecord.opportunityId,
      canonicalZoneId: currentRecord.canonicalZoneId,
      symbol: currentRecord.symbol,
      createdAt: currentRecord.createdAt,
      events: currentRecord.events.slice(),
      auditEvents: auditEvents,
      rawOpportunityIds: identity.rawOpportunityIds.slice(),
      identity: identity,
      progress: mergeProgress(
        currentRecord.progress,
        extracted.event.progress
      ),
      currentState: currentRecord.currentState,
      completed: false,
    };
    symbolState.opportunities[currentId] = record;
    symbolState.currentOpportunityId = currentId;
    return {
      changed: auditChanged,
      canonicalChanged: false,
      state: state,
      record: clone(record),
      event: null,
      auditEvent: auditChanged ? clone(auditEvent) : null,
    };
  }

  if (extracted.state === 'INVALIDATED') {
    id = currentId;
    identity = currentRecord ? currentRecord.identity : null;
  } else if (identity && currentRecord && identity.sameZone) {
    id = currentId;
  } else if (identity) {
    id = lifecycleId(
      symbolState,
      identity,
      extracted.event.timestamp
    );
  } else {
    id = extracted.opportunityId || currentId;
  }
  if (!id) {
    return {
      changed: false,
      canonicalChanged: false,
      state: state,
      record: null,
      event: null,
      auditEvent: null,
    };
  }
  record = symbolState.opportunities[id];
  if (!record) {
    record = {
      opportunityId: id,
      canonicalZoneId: identity ? identity.zoneId : id,
      symbol: extracted.symbol,
      createdAt: extracted.event.timestamp,
      events: [],
      auditEvents: [],
      rawOpportunityIds: [],
      identity: identity,
      progress: normalizeProgress(null),
      currentState: extracted.state,
      completed: false,
    };
  }
  if (!identity) identity = record.identity;
  rawId = rawId || (
    identity ? identity.rawOpportunityId : null
  );
  auditEvent = createAuditEvent(
    extracted.event,
    identity,
    rawId
  );
  auditEvents = appendAuditEvent(record.auditEvents, auditEvent);
  auditChanged = auditEvents.length !== record.auditEvents.length;
  mergedProgress = mergeProgress(
    record.progress,
    extracted.event.progress
  );
  canonicalState = monotonicState(
    record.events.length > 0 ? record.currentState : null,
    extracted.state
  );
  events = record.events.slice();
  previousEvent = events.length > 0
    ? events[events.length - 1]
    : null;
  canonicalChanged = (
    events.length === 0 ||
    record.currentState !== canonicalState ||
    progressAdvanced(record.progress, mergedProgress)
  );
  canonicalEvent = {
    timestamp: extracted.event.timestamp,
    from: events.length > 0
      ? record.currentState
      : extracted.event.from,
    to: canonicalState,
    reasonCode: extracted.event.reasonCode,
    activeOpportunity: clone(
      extracted.event.activeOpportunity
    ),
    progress: clone(mergedProgress),
  };
  if (
    canonicalChanged &&
    !sameTransition(previousEvent, canonicalEvent)
  ) {
    events.push(clone(canonicalEvent));
  } else {
    canonicalChanged = false;
  }
  record = {
    opportunityId: record.opportunityId,
    canonicalZoneId: identity
      ? identity.zoneId
      : record.canonicalZoneId,
    symbol: record.symbol,
    createdAt: record.createdAt,
    events: events,
    auditEvents: auditEvents,
    rawOpportunityIds: identity
      ? identity.rawOpportunityIds.slice()
      : appendUnique(record.rawOpportunityIds, rawId),
    identity: identity,
    progress: mergedProgress,
    currentState: canonicalState,
    completed: canonicalState === 'INVALIDATED',
  };
  symbolState.opportunities[id] = record;
  symbolState.currentOpportunityId = record.completed
    ? null
    : id;
  return {
    changed: canonicalChanged || auditChanged,
    canonicalChanged: canonicalChanged,
    state: state,
    record: clone(record),
    event: canonicalChanged ? clone(canonicalEvent) : null,
    auditEvent: auditChanged ? clone(auditEvent) : null,
  };
}

function recordResults(options) {
  options = options || {};
  var inputs = Array.isArray(options.results)
    ? options.results
    : [];
  var store = options.store || createFileStore(
    options.lifecycleFilePath
  );
  var recordedAt = options.recordedAt === undefined
    ? Date.now()
    : options.recordedAt;
  return Promise.resolve(store.load()).then(function (loaded) {
    var state = normalizeState(loaded);
    var changes = [];
    inputs.forEach(function (input) {
      var applied;
      if (!input || input.status === 'FAILED') return;
      applied = applyTransition(state, input, recordedAt);
      state = applied.state;
      if (!applied.changed) return;
      changes.push({
        symbol: applied.record.symbol,
        opportunityId: applied.record.opportunityId,
        canonicalZoneId: applied.record.canonicalZoneId,
        canonicalChanged: applied.canonicalChanged === true,
        event: applied.event,
        auditEvent: applied.auditEvent,
        record: applied.record,
      });
    });
    if (changes.length === 0) {
      return {
        changed: false,
        changes: [],
        state: state,
      };
    }
    return Promise.resolve(store.save(state)).then(function () {
      return {
        changed: true,
        changes: clone(changes),
        state: clone(state),
      };
    });
  });
}

function createMemoryStore(initialState) {
  var value = initialState === undefined
    ? null
    : clone(initialState);
  return {
    load: function () {
      return Promise.resolve(clone(value));
    },
    save: function (nextState) {
      value = clone(nextState);
      return Promise.resolve();
    },
  };
}

function createFileStore(filePath) {
  var resolvedPath = path.resolve(
    filePath || DEFAULT_LIFECYCLE_PATH
  );
  return {
    filePath: resolvedPath,
    load: function () {
      return new Promise(function (resolve, reject) {
        fs.readFile(resolvedPath, 'utf8', function (error, body) {
          var parsed;
          if (error && error.code === 'ENOENT') {
            resolve(null);
            return;
          }
          if (error) {
            reject(error);
            return;
          }
          try {
            parsed = JSON.parse(body);
          } catch (parseError) {
            reject(parseError);
            return;
          }
          resolve(parsed);
        });
      });
    },
    save: function (nextState) {
      return new Promise(function (resolve, reject) {
        fs.mkdir(
          path.dirname(resolvedPath),
          { recursive: true },
          function (directoryError) {
            if (directoryError) {
              reject(directoryError);
              return;
            }
            fs.writeFile(
              resolvedPath,
              JSON.stringify(nextState, null, 2) + '\n',
              'utf8',
              function (writeError) {
                if (writeError) reject(writeError);
                else resolve();
              }
            );
          }
        );
      });
    },
  };
}

module.exports = {
  DEFAULT_LIFECYCLE_PATH: DEFAULT_LIFECYCLE_PATH,
  STATE_VERSION: STATE_VERSION,
  SUPPORTED_STATES: clone(SUPPORTED_STATES),
  appendAuditEvent: appendAuditEvent,
  applyTransition: applyTransition,
  createFileStore: createFileStore,
  createMemoryStore: createMemoryStore,
  emptyState: emptyState,
  extractTransition: extractTransition,
  normalizeEvent: normalizeEvent,
  normalizeAuditEvent: normalizeAuditEvent,
  normalizeProgress: normalizeProgress,
  normalizeRecord: normalizeRecord,
  normalizeState: normalizeState,
  normalizeTimestamp: normalizeTimestamp,
  opportunityId: opportunityId,
  mergeProgress: mergeProgress,
  progressAdvanced: progressAdvanced,
  recordResults: recordResults,
  sameAuditEvent: sameAuditEvent,
  sameTransition: sameTransition,
};
