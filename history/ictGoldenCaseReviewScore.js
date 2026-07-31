'use strict';

var fs = require('fs');
var path = require('path');

var PROJECT_ROOT = path.resolve(__dirname, '..');
var DEFAULT_CASES_DIRECTORY = path.join(
  PROJECT_ROOT,
  'reports',
  'cases'
);
var SCORE_FIELDS = [
  'htfClarity',
  'structureClarity',
  'liquidityQuality',
  'alignmentQuality',
  'executionQuality',
];

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeCase(caseData) {
  var normalized = isObject(caseData)
    ? clone(caseData)
    : {};
  if (!hasOwn(normalized, 'review')) {
    normalized.review = null;
  }
  return normalized;
}

function normalizeTime(value) {
  var timestamp;
  if (value instanceof Date) timestamp = value.getTime();
  else if (typeof value === 'string') timestamp = Date.parse(value);
  else timestamp = value;
  if (typeof timestamp !== 'number' || !isFinite(timestamp)) {
    throw new Error('A valid review time is required.');
  }
  return new Date(timestamp).toISOString();
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  value = String(value).trim();
  return value ? value : null;
}

function normalizeScoreValue(value, field) {
  var number;
  if (value === undefined || value === null || value === '') {
    return null;
  }
  number = Number(value);
  if (!isFinite(number)) {
    throw new Error(field + ' must be a finite number.');
  }
  return number;
}

function normalizeScore(score) {
  var source = isObject(score) ? score : {};
  var normalized = {};
  SCORE_FIELDS.forEach(function (field) {
    normalized[field] = normalizeScoreValue(
      source[field],
      field
    );
  });
  return normalized;
}

function reviewContent(review) {
  var source = isObject(review) ? review : {};
  return {
    reviewer: normalizeText(source.reviewer),
    score: normalizeScore(source.score),
    notes: normalizeText(source.notes),
  };
}

function mergedReviewContent(source, existingReview) {
  var existing = isObject(existingReview)
    ? existingReview
    : {};
  var suppliedScore = isObject(source.score)
    ? source.score
    : {};
  var existingScore = isObject(existing.score)
    ? existing.score
    : {};
  var score = {};
  SCORE_FIELDS.forEach(function (field) {
    score[field] = normalizeScoreValue(
      hasOwn(suppliedScore, field)
        ? suppliedScore[field]
        : existingScore[field],
      field
    );
  });
  return {
    reviewer: normalizeText(
      hasOwn(source, 'reviewer')
        ? source.reviewer
        : existing.reviewer
    ),
    score: score,
    notes: normalizeText(
      hasOwn(source, 'notes')
        ? source.notes
        : existing.notes
    ),
  };
}

function sameReviewContent(left, right) {
  return JSON.stringify(reviewContent(left)) ===
    JSON.stringify(reviewContent(right));
}

function buildReview(input, existingReview, currentTime) {
  var source = isObject(input && input.review)
    ? input.review
    : (isObject(input) ? input : {});
  var content = mergedReviewContent(source, existingReview);
  var explicitTime = source.reviewedAt;
  var reviewedAt;

  if (explicitTime !== undefined && explicitTime !== null) {
    reviewedAt = normalizeTime(explicitTime);
  } else if (
    isObject(existingReview) &&
    sameReviewContent(existingReview, content) &&
    existingReview.reviewedAt
  ) {
    reviewedAt = normalizeTime(existingReview.reviewedAt);
  } else {
    reviewedAt = normalizeTime(
      currentTime === undefined ? Date.now() : currentTime
    );
  }

  return {
    reviewedAt: reviewedAt,
    reviewer: content.reviewer,
    score: content.score,
    notes: content.notes,
  };
}

function applyReview(caseData, input, options) {
  options = options || {};
  var original = normalizeCase(caseData);
  var updated = clone(original);
  var review = buildReview(
    input,
    original.review,
    options.currentTime
  );

  if (
    isObject(original.review) &&
    JSON.stringify(original.review) === JSON.stringify(review)
  ) {
    return {
      changed: false,
      caseData: updated,
      review: clone(original.review),
    };
  }
  updated.review = review;
  return {
    changed: true,
    caseData: updated,
    review: clone(review),
  };
}

function readJson(filePath) {
  return new Promise(function (resolve, reject) {
    fs.readFile(filePath, 'utf8', function (error, content) {
      var parsed;
      if (error) {
        reject(error);
        return;
      }
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        reject(parseError);
        return;
      }
      resolve(parsed);
    });
  });
}

function writeJson(filePath, value) {
  var body = JSON.stringify(value, null, 2) + '\n';
  return new Promise(function (resolve, reject) {
    fs.writeFile(filePath, body, 'utf8', function (error) {
      if (error) reject(error);
      else resolve();
    });
  });
}

function readCase(filePath) {
  var resolvedPath = path.resolve(filePath);
  return readJson(resolvedPath).then(function (caseData) {
    return normalizeCase(caseData);
  });
}

function updateGoldenCaseReviewScore(options) {
  options = options || {};
  var suppliedPath = options.caseFilePath || options.filePath;
  var filePath;
  var applied;
  var reviewInput;

  if (typeof suppliedPath !== 'string' || !suppliedPath.trim()) {
    return Promise.reject(new Error(
      'A Golden Case file path is required.'
    ));
  }
  filePath = path.resolve(suppliedPath);
  reviewInput = isObject(options.review)
    ? clone(options.review)
    : options;
  if (
    isObject(reviewInput) &&
    reviewInput.reviewedAt === undefined &&
    options.reviewedAt !== undefined
  ) {
    reviewInput.reviewedAt = options.reviewedAt;
  }

  return readJson(filePath).then(function (caseData) {
    applied = applyReview(caseData, reviewInput, {
      currentTime: options.currentTime,
    });
    if (!applied.changed) return false;
    return writeJson(filePath, applied.caseData).then(function () {
      return true;
    });
  }).then(function () {
    return {
      filePath: filePath,
      changed: applied.changed,
      review: clone(applied.review),
      caseData: clone(applied.caseData),
    };
  });
}

module.exports = {
  DEFAULT_CASES_DIRECTORY: DEFAULT_CASES_DIRECTORY,
  SCORE_FIELDS: SCORE_FIELDS,
  applyReview: applyReview,
  buildReview: buildReview,
  normalizeCase: normalizeCase,
  normalizeScore: normalizeScore,
  mergedReviewContent: mergedReviewContent,
  readCase: readCase,
  sameReviewContent: sameReviewContent,
  updateGoldenCaseReviewScore: updateGoldenCaseReviewScore,
  updateReviewScore: updateGoldenCaseReviewScore,
};
