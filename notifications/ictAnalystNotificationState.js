'use strict';

const fs = require('fs/promises');
const path = require('path');

const DEFAULT_STATE_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-analyst-notification-state.json'
);

const CHANGE_REASONS = Object.freeze({
  INITIAL_STATE: 'INITIAL_STATE',
  H4_BIAS_CHANGED: 'H4_BIAS_CHANGED',
  H1_RELATION_CHANGED: 'H1_RELATION_CHANGED',
  NEW_5M_MSS: 'NEW_5M_MSS',
});

function normalizeMss(mss) {
  if (!mss || typeof mss !== 'object') return null;
  return {
    direction: mss.direction || 'UNKNOWN',
    availableIndex: Number.isInteger(mss.availableIndex)
      ? mss.availableIndex
      : null,
    time: Number.isFinite(mss.time) ? mss.time : null,
  };
}

function mssIdentity(mss) {
  if (!mss) return null;
  return [
    mss.direction,
    mss.availableIndex,
    mss.time,
  ].join('|');
}

function extractState(report) {
  const current = report && report.current
    ? report.current
    : report;
  if (
    !current ||
    !current.fourHourAnalysis ||
    !current.oneHourAnalysis ||
    !current.fiveMinuteObservation
  ) {
    throw new Error(
      'A current ICT Analyst Report snapshot is required.'
    );
  }

  const latest = current.fiveMinuteObservation
    .latestConfirmed || {};
  return {
    h4Bias:
      current.fourHourAnalysis.bias || 'UNAVAILABLE',
    h1Relation:
      current.oneHourAnalysis.relationToH4 || 'UNCLEAR',
    latestMss: normalizeMss(latest.mss),
  };
}

function compareStates(previousState, currentState) {
  if (!previousState) {
    return {
      shouldNotify: true,
      reasons: [CHANGE_REASONS.INITIAL_STATE],
    };
  }

  const reasons = [];
  if (previousState.h4Bias !== currentState.h4Bias) {
    reasons.push(CHANGE_REASONS.H4_BIAS_CHANGED);
  }
  if (
    previousState.h1Relation !== currentState.h1Relation
  ) {
    reasons.push(CHANGE_REASONS.H1_RELATION_CHANGED);
  }

  const currentMssId = mssIdentity(currentState.latestMss);
  const previousMssId = mssIdentity(previousState.latestMss);
  if (currentMssId && currentMssId !== previousMssId) {
    reasons.push(CHANGE_REASONS.NEW_5M_MSS);
  }

  return {
    shouldNotify: reasons.length > 0,
    reasons,
  };
}

function evaluate(previousState, report) {
  const currentState = extractState(report);
  return {
    ...compareStates(previousState, currentState),
    previousState: previousState || null,
    currentState,
  };
}

function createMemoryStore(initialState) {
  let state = initialState || null;
  return {
    async load() {
      return state;
    },
    async save(nextState) {
      state = JSON.parse(JSON.stringify(nextState));
    },
  };
}

function createFileStore(filePath) {
  const resolvedPath = path.resolve(
    filePath || DEFAULT_STATE_PATH
  );
  return {
    filePath: resolvedPath,
    async load() {
      try {
        const content = await fs.readFile(
          resolvedPath,
          'utf8'
        );
        return JSON.parse(content);
      } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(nextState) {
      await fs.mkdir(path.dirname(resolvedPath), {
        recursive: true,
      });
      await fs.writeFile(
        resolvedPath,
        JSON.stringify(nextState, null, 2) + '\n',
        'utf8'
      );
    },
  };
}

module.exports = {
  CHANGE_REASONS,
  DEFAULT_STATE_PATH,
  compareStates,
  createFileStore,
  createMemoryStore,
  evaluate,
  extractState,
  mssIdentity,
  normalizeMss,
};
