'use strict';

const TIME_ZONE = 'Asia/Shanghai';
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    return Date.parse(value);
  }
  return NaN;
}

function formatBeijingTime(value) {
  const timestamp = toTimestamp(value);
  if (!Number.isFinite(timestamp)) return '不可用';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '不可用';

  const parts = {};
  for (const part of formatter.formatToParts(
    date
  )) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }
  return (
    parts.year + '-' + parts.month + '-' + parts.day +
    ' ' + parts.hour + ':' + parts.minute + ':' +
    parts.second
  );
}

module.exports = {
  TIME_ZONE,
  formatBeijingTime,
  toTimestamp,
};
