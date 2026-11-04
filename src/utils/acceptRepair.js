// ── Accept Date Repair ────────────────────────────────────────────────────────
//
// Before the fix in pickActionHandlers, an acceptance was filed under the
// date the button was *clicked* (in the rotation's timezone) rather than the
// date the pick was *posted*. Someone in Europe accepting Tuesday's Sydney
// pick on their Tuesday afternoon – already Wednesday in Sydney – made
// Wednesday's pick think it had already happened, and it was skipped.
//
// This re-files those events under the pick's own date. Pure, so it can be
// unit-tested; running it again on fixed data changes nothing.

const { getIsoDateTz } = require('./dateHelpers');

/**
 * @param {object} events - analytics events by date:
 *   { '2026-11-04': [{ type: 'pick_accepted', data: { channelId, name, user, messageTs, date } }] }
 * @param {(channelId: string, name: string) => string|undefined} tzFor - rotation timezone lookup
 * @returns {{ events: object, moved: object[] }} New events object, plus what moved
 *
 * @example
 * refileMisdatedAccepts({ '2026-11-04': [<accept of a pick posted 2026-11-03 06:00 Sydney>] }, () => 'Australia/Sydney')
 * // → { events: { '2026-11-03': [<accept, data.date '2026-11-03'>] },
 * //     moved: [{ channelId, name, user, from: '2026-11-04', to: '2026-11-03' }] }
 */
function refileMisdatedAccepts(events, tzFor) {
  const result = {};
  const moved = [];
  const add = (date, event) => { (result[date] ||= []).push(event); };

  for (const [dateKey, daily] of Object.entries(events || {})) {
    if (!Array.isArray(daily)) { result[dateKey] = daily; continue; }

    for (const event of daily) {
      const seconds = parseFloat(event?.data?.messageTs);
      if (event?.type !== 'pick_accepted' || !Number.isFinite(seconds)) { add(dateKey, event); continue; }

      const pickDate = getIsoDateTz(new Date(seconds * 1000), tzFor(event.data.channelId, event.data.name));
      if (pickDate === dateKey) { add(dateKey, event); continue; }

      add(pickDate, { ...event, data: { ...event.data, date: pickDate } });
      moved.push({ channelId: event.data.channelId, name: event.data.name, user: event.data.user, from: dateKey, to: pickDate });
    }
  }

  return { events: result, moved };
}

module.exports = { refileMisdatedAccepts };
