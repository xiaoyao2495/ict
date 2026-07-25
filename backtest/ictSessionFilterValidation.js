'use strict';

const DeliveryValidation = require(
  './ictHtfBiasLtfConfirmationValidation'
);
const PdConfluence = require(
  './ictHtfPdArrayConfluenceValidation'
);

const HORIZONS = PdConfluence.HORIZONS;
const YEARS = PdConfluence.YEARS;
const SESSION_WINDOWS = Object.freeze({
  ALL_DAY: [],
  LONDON: [[7 * 60, 10 * 60]],
  NEW_YORK: [[12 * 60, 15 * 60]],
  LONDON_NEW_YORK: [
    [7 * 60, 10 * 60],
    [12 * 60, 15 * 60],
  ],
});

function utcMinuteOfDay(timestamp) {
  const date = new Date(timestamp);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function inWindow(timestamp, window) {
  const minute = utcMinuteOfDay(timestamp);
  return minute >= window[0] && minute < window[1];
}

function inSession(timestamp, session) {
  const windows = SESSION_WINDOWS[session];
  if (!windows) throw new Error('Unknown session: ' + session);
  if (session === 'ALL_DAY') return true;
  return windows.some((window) => inWindow(timestamp, window));
}

function filterSession(events, session) {
  return events.filter((event) => inSession(event.time, session));
}

function directionDistribution(events) {
  return {
    BULLISH: events.filter(
      (event) => event.bias === 'BULLISH'
    ).length,
    BEARISH: events.filter(
      (event) => event.bias === 'BEARISH'
    ).length,
  };
}

function buildYearly(events, years, horizons) {
  return Object.fromEntries(years.map((year) => {
    const samples = events.filter(
      (event) => event.year === year
    );
    return [
      String(year),
      {
        events: samples.length,
        directionDistribution:
          directionDistribution(samples),
        horizons: DeliveryValidation.summarizeHorizons(
          samples,
          horizons
        ),
      },
    ];
  }));
}

function summarizeSession(
  events,
  session,
  years,
  horizons
) {
  const samples = filterSession(events, session);
  return {
    session,
    utcWindows: SESSION_WINDOWS[session].map((window) => ({
      startMinute: window[0],
      endMinute: window[1],
    })),
    events: samples.length,
    directionDistribution: directionDistribution(samples),
    horizons: DeliveryValidation.summarizeHorizons(
      samples,
      horizons
    ),
    yearly: buildYearly(samples, years, horizons),
  };
}

function analyze(input) {
  input = input || {};
  const horizons = input.horizons || HORIZONS;
  const years = input.years || YEARS;
  const confluence = PdConfluence.analyze(input);
  const sessions = Object.fromEntries(
    Object.keys(SESSION_WINDOWS).map((session) => [
      session,
      summarizeSession(
        confluence.events,
        session,
        years,
        horizons
      ),
    ])
  );
  const allDayHorizons = sessions.ALL_DAY.horizons;
  for (const session of Object.keys(sessions)) {
    sessions[session].deltaVsAllDay =
      PdConfluence.compareHorizons(
        allDayHorizons,
        sessions[session].horizons,
        horizons
      );
  }
  return {
    protocol: {
      validation: 'ICT_SESSION_FILTER_VALIDATION_V1',
      sourceExperiment:
        'ICT_HTF_PD_ARRAY_CONFLUENCE_VALIDATION_V1',
      eventTimestamp: 'Confirmed 5m MSS close time',
      timezone: 'UTC',
      intervalConvention: '[start, end)',
      daylightSavingAdjustment: false,
      windows: {
        LONDON: '07:00-10:00 UTC',
        NEW_YORK: '12:00-15:00 UTC',
      },
      readsTrades: false,
      readsBaseline: false,
      generatesEntry: false,
      generatesStop: false,
      generatesTarget: false,
      parameterSearch: false,
      modifiesProduction: false,
    },
    source: confluence.source,
    upstreamEventCounts: confluence.eventCounts,
    sessions,
  };
}

module.exports = {
  HORIZONS,
  SESSION_WINDOWS,
  YEARS,
  analyze,
  buildYearly,
  directionDistribution,
  filterSession,
  inSession,
  inWindow,
  summarizeSession,
  utcMinuteOfDay,
};
