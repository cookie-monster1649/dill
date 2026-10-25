// ── Pick Schedule ─────────────────────────────────────────────────────────────
//
// Single source of truth for *when* a rotation picks. The scheduler (which
// fires picks) and the overview (which predicts them) both call into here, so
// they cannot drift apart.
//
// How non-weekly rotations work:
//   A rotation stores `anchorWeek` – the Monday (ISO date, rotation timezone)
//   of a week in which it picks. A week is a pick week when the number of
//   whole calendar weeks since the anchor is a multiple of the interval
//   (2 for fortnightly, 4 for monthly). Every pick day in that Mon–Sun week
//   fires; every pick day in other weeks doesn't.
//
//   Example – fortnightly Mon + Thu, anchorWeek '2026-10-26':
//     week of 26 Oct → Mon 26, Thu 29 fire
//     week of  2 Nov → nothing
//     week of  9 Nov → Mon 9, Thu 12 fire

const { DateTime } = require('luxon');

// ── Constants ─────────────────────────────────────────────────────────────────

// Luxon weekday numbers (1 = Mon … 7 = Sun) keyed by config day values
const DAY_TO_WEEKDAY = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

// How far ahead to look for the next pick before giving up
const DEFAULT_SEARCH_DAYS = 120;

// ── Basics ────────────────────────────────────────────────────────────────────

function weekInterval(config) {
  if (config.frequency === 'fortnightly') return 2;
  if (config.frequency === 'monthly') return 4;
  return 1;
}

function isSchedulable(config) {
  return Boolean(config?.days?.length && config.time && config.tz);
}

/**
 * The pick moment on a given day, in the rotation's timezone.
 *
 * @example
 * pickTimeOn({ time: '10:30', tz: 'Australia/Sydney' }, DateTime.fromISO('2026-11-03'))
 * // → DateTime 2026-11-03T10:30:00+11:00
 */
function pickTimeOn(config, day) {
  const [hour, minute] = config.time.split(':').map(Number);
  return day.setZone(config.tz).set({ hour, minute, second: 0, millisecond: 0 });
}

// Monday of the week containing `dt`, as an ISO date string
function mondayOf(dt) {
  return dt.startOf('week').toISODate();
}

// ── Week gate ─────────────────────────────────────────────────────────────────

/**
 * True when `dt` falls in a week this rotation picks in. Weekly rotations
 * always pass. Non-weekly rotations without an anchor also pass, matching the
 * scheduler's long-standing "fire rather than silently skip" fallback.
 */
function isPickWeek(config, dt) {
  const interval = weekInterval(config);
  if (interval === 1 || !config.anchorWeek) return true;

  const anchor = DateTime.fromISO(config.anchorWeek, { zone: config.tz }).startOf('week');
  const current = dt.setZone(config.tz).startOf('week');

  // Both are Monday 00:00, so the diff is a whole number of weeks; round only
  // absorbs the hour gained or lost when a DST change falls in between
  const weeks = Math.round(current.diff(anchor, 'weeks').weeks);
  return ((weeks % interval) + interval) % interval === 0;
}

/**
 * True when a pick should fire at `dt`: a configured day in a pick week.
 * The scheduler's cron already handles the time of day.
 */
function isPickDay(config, dt) {
  const local = dt.setZone(config.tz);
  const weekdays = config.days.map(d => DAY_TO_WEEKDAY[d]);
  return weekdays.includes(local.weekday) && isPickWeek(config, local);
}

// ── Upcoming picks ────────────────────────────────────────────────────────────

/**
 * Pick moments from the start of `from`'s day onwards. Today is included even
 * if its pick time has passed, because that pick may still be awaiting
 * accept/skip – callers that need strictly-future picks filter themselves.
 *
 * @example
 * // fortnightly Tue 10:00, anchorWeek '2026-10-26', from Mon 26 Oct
 * upcomingPickTimes(cfg, from, 30)
 * // → [Tue 27 Oct 10:00, Tue 10 Nov 10:00, Tue 24 Nov 10:00]
 */
function upcomingPickTimes(config, from, maxDays = DEFAULT_SEARCH_DAYS) {
  if (!isSchedulable(config)) return [];

  const startDay = from.setZone(config.tz).startOf('day');
  const times = [];
  for (let i = 0; i <= maxDays; i++) {
    const day = startDay.plus({ days: i });
    if (isPickDay(config, day)) times.push(pickTimeOn(config, day));
  }
  return times;
}

/**
 * The next pick moment strictly after `now`, or null if none is scheduled.
 */
function nextPickTime(config, now = DateTime.now()) {
  return upcomingPickTimes(config, now).find(t => t > now) || null;
}

// ── Anchors ───────────────────────────────────────────────────────────────────

/**
 * Anchor for a new (or newly non-weekly) rotation: the week of the next
 * configured day/time after `now`. This makes the first pick the very next
 * occurrence, which is what people expect when they save a rotation.
 *
 * @example
 * // Saved on Wed 28 Oct, fortnightly Tue → next Tue is 3 Nov
 * initialAnchorWeek(cfg, now) // → '2026-11-02'
 */
function initialAnchorWeek(config, now = DateTime.now()) {
  if (!isSchedulable(config)) return mondayOf(now.setZone(config.tz || 'UTC'));

  const weekly = { ...config, frequency: 'weekly' };
  const first = nextPickTime(weekly, now.setZone(config.tz));
  return mondayOf(first || now.setZone(config.tz));
}

/**
 * Anchor for a rotation saved before anchors existed. Reproduces the old
 * rule (rounded weeks since startDate, at pick time) to find its next pick,
 * so the next pick date doesn't jump when the new rule takes over.
 */
function legacyAnchorWeek(config, now = DateTime.now()) {
  if (!config.startDate || !isSchedulable(config)) return initialAnchorWeek(config, now);

  const interval = weekInterval(config);
  const start = DateTime.fromISO(config.startDate).setZone(config.tz);
  const weekly = { ...config, frequency: 'weekly' };

  const legacyNext = upcomingPickTimes(weekly, now, interval * 7 + 7)
    .filter(t => t > now)
    .find(t => Math.round(t.diff(start, 'weeks').weeks) % interval === 0);

  return legacyNext ? mondayOf(legacyNext) : initialAnchorWeek(config, now);
}

module.exports = {
  weekInterval,
  isPickDay,
  upcomingPickTimes,
  nextPickTime,
  initialAnchorWeek,
  legacyAnchorWeek,
};
