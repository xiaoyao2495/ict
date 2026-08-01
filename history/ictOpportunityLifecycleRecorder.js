'use strict';

var fs = require('fs');
var path = require('path');

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
    version: 1,
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
  var direction;
  var liquidityType;
  var price;
  if (!isObject(activeOpportunity)) return null;
  direction = activeOpportunity.direction;
  liquidityType = activeOpportunity.liquidityType;
  price = activeOpportunity.price;
  if (
    direction !== 'BULLISH' &&
    direction !== 'BEARISH'
  ) {
    return null;
  }
  if (
    typeof liquidityType !== 'string' ||
    !liquidityType ||
    typeof price !== 'number' ||
    !isFinite(price)
  ) {
    return null;
  }
  return [direction, liquidityType, String(price)].join('|');
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

function normalizeRecord(value, fallbackSymbol) {
  var symbol;
  var events;
  var id;
  var createdAt;
  var currentState;
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
  currentState = typeof value.currentState === 'string'
    ? value.currentState
    : events.length > 0
      ? events[events.length - 1].to
      : null;
  return {
    opportunityId: id,
    symbol: symbol,
    createdAt: createdAt,
    events: events,
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
  return {
    symbol: symbol,
    state: gate.state,
    opportunityId: opportunityId(gate.activeOpportunity),
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

function applyTransition(rawState, input, recordedAt) {
  var state = normalizeState(rawState);
  var extracted = extractTransition(input, recordedAt);
  var symbolState;
  var id;
  var record;
  var events;
  var previousEvent;
  if (!extracted) {
    return {
      changed: false,
      state: state,
      record: null,
      event: null,
    };
  }
  symbolState = state.symbols[extracted.symbol];
  id = extracted.opportunityId || (
    symbolState ? symbolState.currentOpportunityId : null
  );
  if (!id) {
    return {
      changed: false,
      state: state,
      record: null,
      event: null,
    };
  }
  if (!symbolState) {
    symbolState = {
      currentOpportunityId: null,
      opportunities: {},
    };
    state.symbols[extracted.symbol] = symbolState;
  }
  record = symbolState.opportunities[id];
  if (!record) {
    record = {
      opportunityId: id,
      symbol: extracted.symbol,
      createdAt: extracted.event.timestamp,
      events: [],
      currentState: extracted.state,
      completed: false,
    };
  }
  events = record.events.slice();
  previousEvent = events.length > 0
    ? events[events.length - 1]
    : null;
  if (sameTransition(previousEvent, extracted.event)) {
    return {
      changed: false,
      state: state,
      record: clone(record),
      event: null,
    };
  }
  events.push(clone(extracted.event));
  record = {
    opportunityId: record.opportunityId,
    symbol: record.symbol,
    createdAt: record.createdAt,
    events: events,
    currentState: extracted.state,
    completed: extracted.state === 'INVALIDATED',
  };
  symbolState.opportunities[id] = record;
  symbolState.currentOpportunityId = record.completed
    ? null
    : id;
  return {
    changed: true,
    state: state,
    record: clone(record),
    event: clone(extracted.event),
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
        event: applied.event,
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
  SUPPORTED_STATES: clone(SUPPORTED_STATES),
  applyTransition: applyTransition,
  createFileStore: createFileStore,
  createMemoryStore: createMemoryStore,
  emptyState: emptyState,
  extractTransition: extractTransition,
  normalizeEvent: normalizeEvent,
  normalizeRecord: normalizeRecord,
  normalizeState: normalizeState,
  normalizeTimestamp: normalizeTimestamp,
  opportunityId: opportunityId,
  recordResults: recordResults,
  sameTransition: sameTransition,
};
