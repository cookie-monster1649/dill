// Regression tests for the survey audit: restarts, failed profile lookups,
// deactivated users, stale surveys, renames, attachments and text escaping.

const { surveyTick } = require('../src/bot/surveyLifecycle');
const { handleSurveyDm } = require('../src/handlers/surveyDmHandlers');
const { escapeSlack, unescapeSlack, buildEditAnswersView } = require('../src/utils/surveyBlocks');
const { enqueueSurvey, renameSurveyInState } = require('../src/utils/surveyConversation');

// ── Fakes ─────────────────────────────────────────────────────────────────────

class MemoryStore {
  constructor(data = {}) { this.data = data; }
  get(key) { return this.data[key] || {}; }
  getItem(key, subKey) { return (this.data[key] || {})[subKey]; }
  setItem(key, subKey, value) { (this.data[key] ||= {})[subKey] = value; }
  deleteItem(key, subKey) { delete (this.data[key] || {})[subKey]; }
  save() {}
}

// Each test uses fresh user IDs because profiles are cached per process
let seq = 0;
function makeBot({ users = {}, infoFails = false } = {}) {
  let ts = 0;
  const client = {
    users: { info: jest.fn(async ({ user }) => {
      if (infoFails) throw Object.assign(new Error('ratelimited'), { data: { error: 'ratelimited' } });
      return { user: { id: user, tz: 'Australia/Sydney', real_name: user, ...users[user] } };
    }) },
    chat: { postMessage: jest.fn(async ({ channel }) => ({ ts: `${++ts}.000`, channel })), update: jest.fn(async () => ({})) },
    conversations: { join: jest.fn(async () => ({})) },
    reactions: { add: jest.fn(async () => ({})) },
  };
  const members = Object.keys(users).length ? Object.keys(users) : [`U${++seq}`];
  return {
    members,
    app: { client },
    surveyStore: new MemoryStore({ C1: { Standup: { name: 'Standup', members, questions: ['Q1', 'Q2'], days: ['mon', 'tue'], time: '09:00', postMode: 'individual' } } }),
    surveyStateStore: new MemoryStore(),
    leaveStore: new MemoryStore(),
    createBackup: jest.fn(async () => {}),
  };
}

const dmsTo = (bot, user) => bot.app.client.chat.postMessage.mock.calls.map(([a]) => a).filter(a => a.channel === user);
const reply = (bot, user, text, extra = {}) => handleSurveyDm(bot, { message: { channel_type: 'im', channel: 'D1', ts: '1.0', user, text, ...extra } });

// Mon 26 Oct 2026, 09:00 Sydney
beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-25T22:00:00Z'), doNotFake: ['setTimeout', 'setImmediate'] }));
afterEach(() => jest.useRealTimers());

// ── Restarts ──────────────────────────────────────────────────────────────────

describe('restarts', () => {
  test('sends and partial answers are backed up', async () => {
    const bot = makeBot();
    const [u] = bot.members;
    await surveyTick(bot);
    expect(bot.createBackup).toHaveBeenCalledTimes(1);
    await reply(bot, u, 'A1');
    expect(bot.createBackup).toHaveBeenCalledTimes(2);
  });

  test('restoring the backed-up state neither re-sends nor loses answers', async () => {
    const bot = makeBot();
    const [u] = bot.members;
    await surveyTick(bot);
    await reply(bot, u, 'A1');

    // "Restart": a new bot whose state is the last backup
    const restored = makeBot();
    restored.surveyStore = bot.surveyStore;
    restored.surveyStateStore = new MemoryStore(JSON.parse(JSON.stringify(bot.surveyStateStore.data)));
    jest.setSystemTime(new Date('2026-10-25T22:30:00Z'));
    await surveyTick(restored);
    expect(dmsTo(restored, u)).toHaveLength(0);

    await reply(restored, u, 'A2');
    const [post] = restored.app.client.chat.postMessage.mock.calls.map(([a]) => a).filter(a => a.channel === 'C1');
    expect(post.attachments.map(a => a.blocks[0].text.text)).toEqual(['*Q1*\nA1', '*Q2*\nA2']);
  });
});

// ── Profiles ──────────────────────────────────────────────────────────────────

describe('profiles', () => {
  test('a failed lookup waits instead of sending at UTC time', async () => {
    const bot = makeBot({ infoFails: true });
    await surveyTick(bot);
    expect(bot.app.client.chat.postMessage).not.toHaveBeenCalled();
    expect(bot.surveyStateStore.get('sent')).toEqual({});
  });

  test('deactivated users and bots are skipped', async () => {
    const bot = makeBot({ users: { U_GONE: { deleted: true }, U_BOT: { is_bot: true }, U_OK: {} } });
    await surveyTick(bot);
    expect(dmsTo(bot, 'U_GONE')).toHaveLength(0);
    expect(dmsTo(bot, 'U_BOT')).toHaveLength(0);
    expect(dmsTo(bot, 'U_OK').length).toBeGreaterThan(0);
  });
});

// ── Stale surveys ─────────────────────────────────────────────────────────────

describe('stale surveys', () => {
  test('an ignored survey from yesterday does not block today’s other survey', () => {
    const yesterday = { active: { channel: 'C1', name: 'A', date: '2026-10-25', answers: [] }, queue: [] };
    const { state, startNow } = enqueueSurvey(yesterday, { channel: 'C2', name: 'B', date: '2026-10-26' });
    expect(startNow).toBe(true);
    expect(state.active.name).toBe('B');
    expect(state.queue).toEqual([]);
  });

  test('a stale queued survey is dropped rather than started under an old date', () => {
    const state = {
      active: { channel: 'C1', name: 'A', date: '2026-10-25', answers: [] },
      queue: [{ channel: 'C2', name: 'B', date: '2026-10-25', answers: [] }],
    };
    const next = enqueueSurvey(state, { channel: 'C1', name: 'A', date: '2026-10-26' }).state;
    expect(next.active).toEqual({ channel: 'C1', name: 'A', date: '2026-10-26', answers: [] });
    expect(next.queue).toEqual([]);
  });
});

// ── Renames ───────────────────────────────────────────────────────────────────

describe('renames', () => {
  test('in-progress and queued surveys follow the new name', () => {
    const state = {
      active: { channel: 'C1', name: 'Old', date: '2026-10-26', answers: ['A1'] },
      queue: [{ channel: 'C1', name: 'Old', date: '2026-10-26', answers: [] }, { channel: 'C2', name: 'Old', date: '2026-10-26', answers: [] }],
    };
    const next = renameSurveyInState(state, 'C1', 'Old', 'New');
    expect(next.active).toEqual({ channel: 'C1', name: 'New', date: '2026-10-26', answers: ['A1'] });
    expect(next.queue.map(q => `${q.channel}:${q.name}`)).toEqual(['C1:New', 'C2:Old']);
  });
});

// ── DM edge cases ─────────────────────────────────────────────────────────────

describe('DM edge cases', () => {
  test('a reply with a screenshot and text counts as an answer', async () => {
    const bot = makeBot();
    const [u] = bot.members;
    await surveyTick(bot);
    await reply(bot, u, 'See screenshot', { subtype: 'file_share' });
    expect(bot.surveyStateStore.getItem('people', u).active.answers).toEqual(['See screenshot']);
  });

  test('an image with no text gets a helpful reply instead of silence', async () => {
    const bot = makeBot();
    const [u] = bot.members;
    await surveyTick(bot);
    await reply(bot, u, '', { subtype: 'file_share' });
    expect(dmsTo(bot, u).at(-1).text).toContain('text answers');
    expect(bot.surveyStateStore.getItem('people', u).active.answers).toEqual([]);
  });
});

// ── Escaping ──────────────────────────────────────────────────────────────────

describe('Slack text escaping', () => {
  test('round-trips &, < and > through the edit form', () => {
    const stored = 'R&amp;D &lt;3 &gt; ops';
    expect(escapeSlack(unescapeSlack(stored))).toBe(stored);
  });

  test('keeps mentions and links intact', () => {
    expect(escapeSlack('ask <@U123> & see <https://x.io|docs>')).toBe('ask <@U123> &amp; see <https://x.io|docs>');
  });

  test('the edit form shows unescaped text within Slack’s length limit', () => {
    const view = buildEditAnswersView({ name: 'S', questions: ['Q'] }, 'C1', ['R&amp;D ' + 'x'.repeat(5000)]);
    const value = view.blocks[0].element.initial_value;
    expect(value.startsWith('R&D ')).toBe(true);
    expect(value.length).toBeLessThanOrEqual(3000);
  });
});

// ── Editing DM replies ────────────────────────────────────────────────────────

describe('editing a DM reply', () => {
  const edit = (bot, user, ts, text) => handleSurveyDm(bot, {
    message: { channel_type: 'im', channel: 'D1', subtype: 'message_changed', message: { user, ts, text }, previous_message: { user, ts } },
  });

  test('before finishing: the edited text is what gets posted', async () => {
    const bot = makeBot();
    const [u] = bot.members;
    await surveyTick(bot);
    await reply(bot, u, 'Typo', { ts: '10.0' });
    await edit(bot, u, '10.0', 'Fixed');
    await reply(bot, u, 'A2', { ts: '11.0' });

    const [post] = bot.app.client.chat.postMessage.mock.calls.map(([a]) => a).filter(a => a.channel === 'C1');
    expect(post.attachments[0].blocks[0].text.text).toBe('*Q1*\nFixed');
  });

  test('after finishing: the channel post is updated in place', async () => {
    const bot = makeBot();
    const [u] = bot.members;
    await surveyTick(bot);
    await reply(bot, u, 'A1', { ts: '10.0' });
    await reply(bot, u, 'Typo', { ts: '11.0' });
    await edit(bot, u, '11.0', 'Fixed');

    const update = bot.app.client.chat.update.mock.calls.map(([a]) => a).find(a => a.channel === 'C1');
    expect(update.attachments[1].blocks[0].text.text).toBe('*Q2*\nFixed');
    expect(bot.app.client.chat.postMessage.mock.calls.filter(([a]) => a.channel === 'C1')).toHaveLength(1);
  });

  test('edits to unrelated DMs are ignored', async () => {
    const bot = makeBot();
    const [u] = bot.members;
    await edit(bot, u, '99.0', 'whatever');
    expect(bot.app.client.chat.postMessage).not.toHaveBeenCalled();
    expect(bot.app.client.chat.update).not.toHaveBeenCalled();
  });
});
