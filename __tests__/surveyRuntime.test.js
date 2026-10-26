// End-to-end tests for daily surveys with a fake Slack client: the minute
// tick sends DMs at each person's local time, DM replies are recorded as
// answers, and finished surveys post to the channel in either mode.

const { surveyTick } = require('../src/bot/surveyLifecycle');
const { handleSurveyDm } = require('../src/handlers/surveyDmHandlers');
const { parseSurveyForm } = require('../src/handlers/surveyHandlers');

// ── Fakes ─────────────────────────────────────────────────────────────────────

// In-memory stand-in for NestedStore (the real one writes files)
class MemoryStore {
  constructor(data = {}) { this.data = data; }
  get(key) { return this.data[key] || {}; }
  getItem(key, subKey) { return (this.data[key] || {})[subKey]; }
  setItem(key, subKey, value) { (this.data[key] ||= {})[subKey] = value; }
  deleteItem(key, subKey) { delete (this.data[key] || {})[subKey]; }
  save() {}
}

const TZ = { U1: 'Australia/Sydney', U2: 'Europe/London' };

function makeBot(postMode = 'thread') {
  let ts = 0;
  const client = {
    users: { info: jest.fn(async ({ user }) => ({ user: { tz: TZ[user] } })) },
    chat: {
      postMessage: jest.fn(async () => ({ ts: `${++ts}.000` })),
      update: jest.fn(async () => ({})),
    },
    conversations: { join: jest.fn(async () => ({})) },
  };
  return {
    app: { client },
    surveyStore: new MemoryStore({
      C1: { Standup: { name: 'Standup', members: ['U1', 'U2'], questions: ['Q1', 'Q2'], days: ['mon'], time: '09:00', postMode } },
    }),
    surveyStateStore: new MemoryStore(),
    leaveStore: new MemoryStore(),
    createBackup: jest.fn(async () => {}),
  };
}

// Texts of every message sent to one Slack channel/user
function sentTo(bot, channel) {
  return bot.app.client.chat.postMessage.mock.calls.map(([a]) => a).filter(a => a.channel === channel);
}

const reply = (bot, user, text) => handleSurveyDm(bot, { message: { channel_type: 'im', user, text } });

// 2026-10-25T22:00Z is Mon 09:00 in Sydney but Sun 22:00 in London
beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-25T22:00:00Z'), doNotFake: ['setTimeout'] }));
afterEach(() => jest.useRealTimers());

// ── Sending ───────────────────────────────────────────────────────────────────

describe('surveyTick', () => {
  test('DMs only people whose local time has reached the send time', async () => {
    const bot = makeBot();
    await surveyTick(bot);

    expect(sentTo(bot, 'U1').map(m => m.text)).toEqual([expect.stringContaining('Standup'), '*1/2* Q1']);
    expect(sentTo(bot, 'U2')).toHaveLength(0);
  });

  test('does not DM the same person twice in a day', async () => {
    const bot = makeBot();
    await surveyTick(bot);
    await surveyTick(bot);
    expect(sentTo(bot, 'U1')).toHaveLength(2);
  });

  test('skips people on leave in the survey channel', async () => {
    const bot = makeBot();
    bot.leaveStore.data = { C1: { U1: [{ startDate: '2026-10-26', endDate: '2026-10-30' }] } };
    await surveyTick(bot);
    expect(sentTo(bot, 'U1')).toHaveLength(0);
  });
});

// ── Answering + posting ───────────────────────────────────────────────────────

describe('handleSurveyDm', () => {
  test('asks each question in turn, then posts in a daily thread', async () => {
    const bot = makeBot('thread');
    await surveyTick(bot);
    await reply(bot, 'U1', 'Shipped login');
    expect(sentTo(bot, 'U1').at(-1).text).toBe('*2/2* Q2');

    await reply(bot, 'U1', 'No blockers');
    const [parent, answer] = sentTo(bot, 'C1');
    expect(parent.blocks[1].elements[0].text).toBe('1/2 answered · Waiting on <@U2>');
    expect(answer.thread_ts).toBe(bot.surveyStateStore.getItem('threads', 'C1::Standup')['2026-10-26'].ts);
    expect(answer.blocks[1].text.text).toBe('*Q1*\nShipped login');
    expect(sentTo(bot, 'U1').at(-1).text).toContain('Thanks!');
  });

  test('posts one top-level message per person in individual mode', async () => {
    const bot = makeBot('individual');
    await surveyTick(bot);
    await reply(bot, 'U1', 'A1');
    await reply(bot, 'U1', 'A2');
    const posts = sentTo(bot, 'C1');
    expect(posts).toHaveLength(1);
    expect(posts[0].thread_ts).toBeUndefined();
  });

  test('replies with a hint when there is nothing to answer', async () => {
    const bot = makeBot();
    await reply(bot, 'U1', 'hello?');
    expect(sentTo(bot, 'U1')[0].text).toContain("don't have a survey");
  });

  test('ignores edits and bot messages', async () => {
    const bot = makeBot();
    await handleSurveyDm(bot, { message: { channel_type: 'im', user: 'U1', text: 'x', subtype: 'message_changed' } });
    await handleSurveyDm(bot, { message: { channel_type: 'im', user: 'U1', text: 'x', bot_id: 'B1' } });
    expect(bot.app.client.chat.postMessage).not.toHaveBeenCalled();
  });
});

// ── Form parsing ──────────────────────────────────────────────────────────────

describe('parseSurveyForm', () => {
  const values = (overrides = {}) => ({
    survey_name: { value: { value: ' Standup ' } },
    survey_members: { value: { selected_users: ['U1'] } },
    survey_questions: { value: { value: 'Q1\n\n  Q2 \n' } },
    survey_days: { value: { selected_options: [{ value: 'mon' }] } },
    survey_time: { value: { selected_time: '09:30' } },
    survey_post_mode: { value: { selected_option: { value: 'individual' } } },
    ...overrides,
  });

  test('builds a clean survey config', () => {
    expect(parseSurveyForm(values()).survey).toEqual({
      name: 'Standup', members: ['U1'], questions: ['Q1', 'Q2'], days: ['mon'], time: '09:30', postMode: 'individual',
    });
  });

  test('reports missing fields', () => {
    const { errors } = parseSurveyForm(values({ survey_members: { value: { selected_users: [] } }, survey_questions: { value: { value: ' ' } } }));
    expect(Object.keys(errors).sort()).toEqual(['survey_members', 'survey_questions']);
  });

  test('delete wins over validation', () => {
    const result = parseSurveyForm(values({ survey_name: { value: { value: '' } }, survey_delete: { value: { selected_options: [{ value: 'delete' }] } } }));
    expect(result).toEqual({ remove: true });
  });
});
