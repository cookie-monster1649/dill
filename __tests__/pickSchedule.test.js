// Tests for the shared pick-schedule rules. These pin down the behaviour the
// overview's "Next pick date is …" line and the scheduler both rely on.

const { DateTime } = require('luxon');
const {
  isPickDay,
  upcomingPickTimes,
  nextPickTime,
  initialAnchorWeek,
  legacyAnchorWeek,
} = require('../src/utils/pickSchedule');

// ── Helpers ───────────────────────────────────────────────────────────────────

const TZ = 'Australia/Sydney';

function at(iso) {
  return DateTime.fromISO(iso, { zone: TZ });
}

function cfg(overrides) {
  return { days: ['tue'], time: '10:00', tz: TZ, frequency: 'weekly', ...overrides };
}

function fmt(times) {
  return times.map(t => t.toFormat('ccc d LLL HH:mm'));
}

// ── Week gate ─────────────────────────────────────────────────────────────────

describe('fortnightly rotations', () => {
  const fortnightly = cfg({ days: ['mon', 'thu'], frequency: 'fortnightly', anchorWeek: '2026-10-26' });

  test('every pick day in a pick week fires, then a week off', () => {
    expect(fmt(upcomingPickTimes(fortnightly, at('2026-10-26'), 20))).toEqual([
      'Mon 26 Oct 10:00', 'Thu 29 Oct 10:00',
      'Mon 9 Nov 10:00', 'Thu 12 Nov 10:00',
    ]);
  });

  test('handles dates before the anchor week', () => {
    expect(isPickDay(fortnightly, at('2026-10-12T10:00'))).toBe(true);
    expect(isPickDay(fortnightly, at('2026-10-19T10:00'))).toBe(false);
  });

  test('stays in phase across a daylight-saving change', () => {
    // Sydney DST ends Sun 5 Apr 2026 – anchor before, check after
    const acrossDst = cfg({ frequency: 'fortnightly', anchorWeek: '2026-03-23' });
    expect(fmt(upcomingPickTimes(acrossDst, at('2026-03-23'), 30))).toEqual([
      'Tue 24 Mar 10:00', 'Tue 7 Apr 10:00', 'Tue 21 Apr 10:00',
    ]);
  });
});

describe('monthly (every 4 weeks) rotations', () => {
  test('fires every fourth week', () => {
    const monthly = cfg({ frequency: 'monthly', anchorWeek: '2026-10-26' });
    expect(fmt(upcomingPickTimes(monthly, at('2026-10-26'), 60))).toEqual([
      'Tue 27 Oct 10:00', 'Tue 24 Nov 10:00', 'Tue 22 Dec 10:00',
    ]);
  });
});

describe('weekly rotations', () => {
  test('ignore any anchor and fire every week', () => {
    const weekly = cfg({ anchorWeek: '2026-10-26' });
    expect(upcomingPickTimes(weekly, at('2026-10-26'), 21)).toHaveLength(3);
  });
});

// ── Next pick ─────────────────────────────────────────────────────────────────

describe('nextPickTime', () => {
  const fortnightly = cfg({ frequency: 'fortnightly', anchorWeek: '2026-10-26' });

  test('is today when the pick time has not passed yet', () => {
    expect(nextPickTime(fortnightly, at('2026-10-27T09:59')).toISO()).toBe(at('2026-10-27T10:00').toISO());
  });

  test('skips to the next pick week once today has passed', () => {
    expect(nextPickTime(fortnightly, at('2026-10-27T10:01')).toISODate()).toBe('2026-11-10');
  });

  test('is null when the rotation has no days', () => {
    expect(nextPickTime(cfg({ days: [] }), at('2026-10-27'))).toBeNull();
  });
});

// ── Anchors ───────────────────────────────────────────────────────────────────

describe('initialAnchorWeek', () => {
  const fortnightly = cfg({ frequency: 'fortnightly' });

  test('first pick is the next matching day, even next week', () => {
    // Saved Wed 28 Oct → next Tue is 3 Nov
    const anchorWeek = initialAnchorWeek(fortnightly, at('2026-10-28T12:00'));
    expect(anchorWeek).toBe('2026-11-02');
    expect(nextPickTime({ ...fortnightly, anchorWeek }, at('2026-10-28T12:00')).toISODate()).toBe('2026-11-03');
  });

  test('first pick is today if saved before the pick time', () => {
    expect(initialAnchorWeek(fortnightly, at('2026-10-27T09:00'))).toBe('2026-10-26');
  });
});

describe('legacyAnchorWeek', () => {
  test('keeps the next pick date the old startDate rule produced', () => {
    // Old rule: created Sat 24 Oct 14:00, fortnightly Wed 17:00 → fired Wed 4 Nov
    const legacy = cfg({
      days: ['wed'], time: '17:00', frequency: 'fortnightly',
      startDate: at('2026-10-24T14:00').toISO(),
    });
    const now = at('2026-10-26T09:00');
    const anchorWeek = legacyAnchorWeek(legacy, now);
    expect(nextPickTime({ ...legacy, anchorWeek }, now).toISODate()).toBe('2026-11-04');
  });
});

// ── Scheduler and overview agree ──────────────────────────────────────────────

describe('scheduler gate matches upcoming picks', () => {
  test('every day for a year, across frequencies and day sets', () => {
    const configs = [
      cfg({ days: ['mon', 'wed', 'fri'], frequency: 'fortnightly', anchorWeek: '2026-11-02' }),
      cfg({ days: ['sun'], frequency: 'monthly', anchorWeek: '2026-10-19' }),
      cfg({ days: ['tue', 'sat'] }),
    ];
    const from = at('2026-10-26');

    for (const c of configs) {
      const predicted = new Set(upcomingPickTimes(c, from, 365).map(t => t.toISODate()));
      for (let i = 0; i <= 365; i++) {
        const tick = from.plus({ days: i }).set({ hour: 10 });
        expect(isPickDay(c, tick)).toBe(predicted.has(tick.toISODate()));
      }
    }
  });
});
