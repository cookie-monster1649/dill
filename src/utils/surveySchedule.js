// ── Survey Schedule ───────────────────────────────────────────────────────────
//
// Pure rules for when a daily survey is due for one person. Each person gets
// the survey at the configured time in *their own* Slack timezone, so the
// caller ticks every minute and asks "is this person due right now?".
//
// No Slack or store I/O lives here so it can be unit-tested directly.

const { DateTime } = require('luxon');

// ── Constants ─────────────────────────────────────────────────────────────────

// luxon weekday (1 = Mon … 7 = Sun) → the day values stored in configs,
// matching the rotation config format
const WEEKDAY_TO_DAY = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 7: 'sun' };

// If the bot was down at send time it catches up on restart, but only within
// this window – nobody wants a "morning" standup DM at 6pm
const CATCH_UP_MINUTES = 120;

// Used when Slack has no timezone for a person (rare; e.g. some bots)
const FALLBACK_TZ = 'UTC';

// ── Due check ─────────────────────────────────────────────────────────────────

/**
 * Decides whether a survey should be sent to one person right now.
 *
 * @param {object}   survey         - { days: ['mon', ...], time: '09:30' }
 * @param {DateTime} nowInUserZone  - Current time in the person's timezone
 * @param {string}   [lastSentDate] - ISO date the person last got this survey
 * @returns {boolean}
 *
 * @example
 * isSurveyDue({ days: ['mon'], time: '09:00' },
 *             DateTime.fromISO('2026-10-26T09:01', { zone: 'Australia/Sydney' }),
 *             '2026-10-23')
 * // → true
 */
function isSurveyDue(survey, nowInUserZone, lastSentDate) {
  if (!survey?.time || !Array.isArray(survey.days) || survey.days.length === 0) return false;

  const today = WEEKDAY_TO_DAY[nowInUserZone.weekday];
  if (!survey.days.includes(today)) return false;

  // Never send the same survey to the same person twice in one local day
  const localDate = nowInUserZone.toISODate();
  if (lastSentDate === localDate) return false;

  const minutesLate = minutesSinceSendTime(survey.time, nowInUserZone);
  return minutesLate >= 0 && minutesLate <= CATCH_UP_MINUTES;
}

/**
 * Minutes between today's send time and now, in the person's zone.
 * Negative before the send time.
 *
 * @example
 * minutesSinceSendTime('09:00', <09:45 local>) // → 45
 */
function minutesSinceSendTime(time, nowInUserZone) {
  const [hour, minute] = time.split(':').map(Number);
  const sendAt = nowInUserZone.set({ hour, minute, second: 0, millisecond: 0 });
  return Math.floor(nowInUserZone.diff(sendAt, 'minutes').minutes);
}

/**
 * Returns "now" in the person's timezone, falling back to UTC if Slack gave
 * us nothing usable.
 *
 * @param {string}   [tz]  - IANA zone from users.info, e.g. 'Australia/Sydney'
 * @param {DateTime} [now] - Injectable for tests
 * @returns {DateTime}
 */
function nowInZone(tz, now = DateTime.now()) {
  const zoned = now.setZone(tz || FALLBACK_TZ);
  return zoned.isValid ? zoned : now.setZone(FALLBACK_TZ);
}

module.exports = { CATCH_UP_MINUTES, isSurveyDue, minutesSinceSendTime, nowInZone };
