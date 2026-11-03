// Tests for re-filing pick acceptances under the pick's own date, using the
// real 3–4 Nov 2026 case: Tuesday's 06:00 Sydney Sweep pick was accepted from
// another timezone after Sydney midnight, which made Wednesday's pick skip.

const { refileMisdatedAccepts } = require('../src/utils/acceptRepair');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SYDNEY = () => 'Australia/Sydney';
const TUESDAY_PICK_TS = '1793646000.000100'; // 2026-11-02T19:00Z = Tue 3 Nov 06:00 Sydney

const accept = (messageTs, date) => ({
  type: 'pick_accepted',
  timestamp: '2026-11-03T14:14:56.709Z',
  data: { channelId: 'G1', name: 'Sweep', user: 'U8', responder: 'U8', messageTs, date },
});

// ── Repair ────────────────────────────────────────────────────────────────────

describe('refileMisdatedAccepts', () => {
  test('moves a late acceptance back to the day its pick was posted', () => {
    const { events, moved } = refileMisdatedAccepts({ '2026-11-04': [accept(TUESDAY_PICK_TS, '2026-11-04')] }, SYDNEY);

    expect(events['2026-11-04']).toBeUndefined();
    expect(events['2026-11-03']).toHaveLength(1);
    expect(events['2026-11-03'][0].data.date).toBe('2026-11-03');
    expect(moved).toEqual([{ channelId: 'G1', name: 'Sweep', user: 'U8', from: '2026-11-04', to: '2026-11-03' }]);
  });

  test('leaves correctly dated acceptances and other events alone', () => {
    const skip = { type: 'pick_skipped', data: { channelId: 'G1', messageTs: TUESDAY_PICK_TS } };
    const input = { '2026-11-03': [accept(TUESDAY_PICK_TS, '2026-11-03'), skip] };
    const { events, moved } = refileMisdatedAccepts(input, SYDNEY);

    expect(moved).toEqual([]);
    expect(events).toEqual(input);
  });

  test('keeps events with no message ts where they are', () => {
    const legacy = { type: 'pick_accepted', data: { channelId: 'G1', name: 'Sweep' } };
    const { events, moved } = refileMisdatedAccepts({ '2026-11-04': [legacy] }, SYDNEY);
    expect(moved).toEqual([]);
    expect(events['2026-11-04']).toEqual([legacy]);
  });

  test('is a no-op when run again on repaired data', () => {
    const once = refileMisdatedAccepts({ '2026-11-04': [accept(TUESDAY_PICK_TS, '2026-11-04')] }, SYDNEY).events;
    const twice = refileMisdatedAccepts(once, SYDNEY);
    expect(twice.moved).toEqual([]);
    expect(twice.events).toEqual(once);
  });
});
