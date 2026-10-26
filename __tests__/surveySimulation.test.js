// Week-long simulation of daily surveys: many people in awkward timezones,
// ticking every simulated minute, to prove each person gets exactly one DM
// per working day at their own 09:00 – including across a DST change – and
// that people finishing at the same moment share one daily thread.

const { DateTime } = require('luxon');
const { surveyTick } = require('../src/bot/surveyLifecycle');
const { handleSurveyDm } = require('../src/handlers/surveyDmHandlers');

// ── Fakes ─────────────────────────────────────────────────────────────────────

class MemoryStore {
  constructor(data = {}) { this.data = data; }
  get(key) { return this.data[key] || {}; }
  getItem(key, subKey) { return (this.data[key] || {})[subKey]; }
  setItem(key, subKey, value) { (this.data[key] ||= {})[subKey] = value; }
  deleteItem(key, subKey) { delete (this.data[key] || {})[subKey]; }
  save() {}
}

// Offsets chosen to hit half-hour, 45-minute, date-line and DST cases.
// Europe/London and America/New_York both leave DST during the simulated week.
const PEOPLE = {
  U_SYD: 'Australia/Sydney',
  U_LON: 'Europe/London',
  U_NYC: 'America/New_York',
  U_IND: 'Asia/Kolkata',
  U_NPL: 'Asia/Kathmandu',
  U_AKL: 'Pacific/Auckland',
  U_HNL: 'Pacific/Honolulu',
  U_NOTZ: undefined, // Slack gave no timezone → UTC
};

function makeBot(postMode = 'thread') {
  let ts = 0;
  // Slow, async Slack calls so concurrent handlers genuinely interleave
  const later = (value) => new Promise(resolve => setImmediate(() => resolve(value)));
  const client = {
    users: { info: jest.fn(async ({ user }) => later({ user: { tz: PEOPLE[user], real_name: user } })) },
    chat: {
      postMessage: jest.fn(async ({ channel }) => later({ ts: `${++ts}.000`, channel })),
      update: jest.fn(async () => later({})),
    },
    conversations: { join: jest.fn(async () => later({})) },
    reactions: { add: jest.fn(async () => later({})) },
  };
  return {
    app: { client },
    surveyStore: new MemoryStore({
      C1: { Standup: { name: 'Standup', members: Object.keys(PEOPLE), questions: ['Q1', 'Q2'],
        days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '09:00', postMode } },
    }),
    surveyStateStore: new MemoryStore(),
    leaveStore: new MemoryStore(),
    createBackup: jest.fn(async () => {}),
  };
}

// Intro DMs ("It's time for…") sent to each person, with the UTC send instant
function introsByPerson(bot) {
  const out = {};
  bot.app.client.chat.postMessage.mock.calls.forEach(([args], i) => {
    if (!PEOPLE.hasOwnProperty(args.channel) || !args.text.startsWith("Hi! It's time")) return;
    (out[args.channel] ||= []).push(bot.sentAt[i]);
  });
  return out;
}

const reply = (bot, user, text) =>
  handleSurveyDm(bot, { message: { channel_type: 'im', channel: `D_${user}`, ts: '1.0', user, text } });

// ── Week of ticks ─────────────────────────────────────────────────────────────

describe('a simulated week', () => {
  afterEach(() => jest.useRealTimers());

  test('everyone gets exactly one survey per local weekday at 09:00 local', async () => {
    const bot = makeBot();
    bot.sentAt = [];
    const record = bot.app.client.chat.postMessage.getMockImplementation();
    bot.app.client.chat.postMessage.mockImplementation(async (args) => {
      bot.sentAt.push(DateTime.now().toUTC());
      return record(args);
    });

    // Sat 24 Oct 2026 00:00 UTC → Mon 2 Nov 00:00 UTC (London leaves DST 25 Oct, New York 1 Nov)
    let now = DateTime.fromISO('2026-10-24T00:00:00Z');
    const end = DateTime.fromISO('2026-11-02T00:00:00Z');
    jest.useFakeTimers({ now: now.toJSDate(), doNotFake: ['setImmediate', 'setTimeout'] });

    while (now < end) {
      jest.setSystemTime(now.toJSDate());
      await surveyTick(bot);
      // Everyone answers straight away so the next day starts clean
      for (const user of Object.keys(PEOPLE)) {
        const active = bot.surveyStateStore.getItem('people', user)?.active;
        if (active) { await reply(bot, user, 'a'); await reply(bot, user, 'b'); }
      }
      now = now.plus({ minutes: 1 });
    }

    const intros = introsByPerson(bot);
    for (const [user, zone] of Object.entries(PEOPLE)) {
      const local = (intros[user] || []).map(t => t.setZone(zone || 'UTC'));
      const days = local.map(t => t.toISODate());

      // One per day, no duplicates
      expect(new Set(days).size).toBe(days.length);
      // Only weekdays, always at exactly 09:00 local
      for (const t of local) {
        expect(t.weekday).toBeLessThanOrEqual(5);
        expect(t.toFormat('HH:mm')).toBe('09:00');
      }
      // Every local weekday fully inside the window was covered
      const expected = [];
      for (let d = DateTime.fromISO('2026-10-26', { zone: zone || 'UTC' }); d.toISODate() <= '2026-10-30'; d = d.plus({ days: 1 })) {
        expected.push(d.toISODate());
      }
      expect(days).toEqual(expect.arrayContaining(expected));
    }
  }, 60000);
});

// ── Concurrency ───────────────────────────────────────────────────────────────

describe('people finishing at the same moment', () => {
  afterEach(() => jest.useRealTimers());

  test('share a single daily thread parent that lists them all', async () => {
    const bot = makeBot('thread');
    const sydney = ['U_SYD', 'U_SYD2', 'U_SYD3'];
    bot.surveyStore.data.C1.Standup.members = sydney;
    sydney.forEach(u => { PEOPLE[u] = 'Australia/Sydney'; });

    // Mon 09:00 Sydney
    jest.useFakeTimers({ now: new Date('2026-10-25T22:00:00Z'), doNotFake: ['setImmediate', 'setTimeout'] });
    await surveyTick(bot);
    for (const u of sydney) await reply(bot, u, 'a');

    // All three send their last answer at once
    await Promise.all(sydney.map(u => reply(bot, u, 'b')));

    const channelPosts = bot.app.client.chat.postMessage.mock.calls.map(([a]) => a).filter(a => a.channel === 'C1');
    const parents = channelPosts.filter(a => !a.thread_ts);
    const replies = channelPosts.filter(a => a.thread_ts);
    expect(parents).toHaveLength(1);
    expect(replies).toHaveLength(3);
    expect(new Set(replies.map(r => r.thread_ts)).size).toBe(1);

    const thread = bot.surveyStateStore.getItem('threads', 'C1::Standup')['2026-10-26'];
    expect([...thread.completed].sort()).toEqual([...sydney].sort());
    sydney.forEach(u => { if (u !== 'U_SYD') delete PEOPLE[u]; });
  });

  test('fast consecutive DMs from one person are each recorded once, in order', async () => {
    const bot = makeBot('individual');
    bot.surveyStore.data.C1.Standup.members = ['U_SYD'];
    bot.surveyStore.data.C1.Standup.questions = ['Q1', 'Q2', 'Q3'];
    jest.useFakeTimers({ now: new Date('2026-10-25T22:00:00Z'), doNotFake: ['setImmediate', 'setTimeout'] });
    await surveyTick(bot);

    await Promise.all([reply(bot, 'U_SYD', 'one'), reply(bot, 'U_SYD', 'two'), reply(bot, 'U_SYD', 'three')]);

    const posts = bot.app.client.chat.postMessage.mock.calls.map(([a]) => a).filter(a => a.channel === 'C1');
    expect(posts).toHaveLength(1);
    expect(posts[0].attachments.map(a => a.blocks[0].text.text)).toEqual(['*Q1*\none', '*Q2*\ntwo', '*Q3*\nthree']);
  });
});
