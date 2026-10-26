// End-to-end tests for daily surveys with a fake Slack client: the minute
// tick sends DMs at each person's local time, DM replies are recorded as
// answers, and finished surveys post to the channel in either mode.

const { surveyTick } = require('../src/bot/surveyLifecycle');
const { handleSurveyDm } = require('../src/handlers/surveyDmHandlers');
const { parseSurveyForm } = require('../src/handlers/surveyHandlers');
const { openEditAnswers, handleEditSubmit } = require('../src/handlers/surveyEditHandlers');

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
    users: { info: jest.fn(async ({ user }) => ({ user: { tz: TZ[user], real_name: `Name ${user}`, profile: { image_72: `https://img/${user}.png` } } })) },
    views: { open: jest.fn(async () => ({})) },
    reactions: { add: jest.fn(async () => ({})) },
    chat: {
      postMessage: jest.fn(async ({ channel }) => ({ ts: `${++ts}.000`, channel })),
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

  test('hearts a thank-you when idle instead of replying', async () => {
    const bot = makeBot();
    await handleSurveyDm(bot, { message: { channel_type: 'im', channel: 'D1', ts: '9.000', user: 'U1', text: 'good bot!' } });
    expect(bot.app.client.reactions.add).toHaveBeenCalledWith({ channel: 'D1', timestamp: '9.000', name: 'heart' });
    expect(bot.app.client.chat.postMessage).not.toHaveBeenCalled();
  });

  test('treats "thanks" as an answer mid-survey', async () => {
    const bot = makeBot();
    await surveyTick(bot);
    await reply(bot, 'U1', 'thanks');
    expect(bot.app.client.reactions.add).not.toHaveBeenCalled();
    expect(bot.surveyStateStore.getItem('people', 'U1').active.answers).toEqual(['thanks']);
  });

  test('ignores edits and bot messages', async () => {
    const bot = makeBot();
    await handleSurveyDm(bot, { message: { channel_type: 'im', user: 'U1', text: 'x', subtype: 'message_changed' } });
    await handleSurveyDm(bot, { message: { channel_type: 'im', user: 'U1', text: 'x', bot_id: 'B1' } });
    expect(bot.app.client.chat.postMessage).not.toHaveBeenCalled();
  });
});

// ── Author + editing ──────────────────────────────────────────────────────────

describe('posting as the person and editing', () => {
  async function finishSurvey(bot) {
    await surveyTick(bot);
    await reply(bot, 'U1', 'A1');
    await reply(bot, 'U1', 'A2');
  }

  test('answers post with the person’s name and avatar', async () => {
    const bot = makeBot('individual');
    await finishSurvey(bot);
    const [post] = sentTo(bot, 'C1');
    expect(post.username).toBe('Name U1');
    expect(post.icon_url).toBe('https://img/U1.png');
  });

  test('the done DM offers an Edit answers button', async () => {
    const bot = makeBot();
    await finishSurvey(bot);
    const done = sentTo(bot, 'U1').at(-1);
    expect(done.blocks[0].accessory.action_id).toBe('survey_edit_answers');
  });

  test('Edit answers opens a prefilled form and saving updates the post in place', async () => {
    const bot = makeBot('individual');
    await finishSurvey(bot);
    const postTs = bot.surveyStateStore.getItem('posts', 'C1::Standup').U1.ts;

    const value = JSON.stringify({ channel: 'C1', name: 'Standup' });
    await openEditAnswers(bot, { ack: async () => {}, action: { value }, body: { user: { id: 'U1' }, trigger_id: 'T' }, client: bot.app.client });
    const form = bot.app.client.views.open.mock.calls[0][0].view;
    expect(form.blocks[0].element.initial_value).toBe('A1');

    const values = { answer_0: { value: { value: 'A1 fixed' } }, answer_1: { value: { value: 'A2' } } };
    await handleEditSubmit(bot, { ack: async () => {}, body: { user: { id: 'U1' } }, view: { private_metadata: value, state: { values } } });

    const update = bot.app.client.chat.update.mock.calls.map(([a]) => a).find(a => a.channel === 'C1');
    expect(update.ts).toBe(postTs);
    expect(update.blocks[1].text.text).toBe('*Q1*\nA1 fixed');
    expect(sentTo(bot, 'C1')).toHaveLength(1); // no new post

    // The DM summary is refreshed too, since Dill can't edit the person's own replies
    const dmUpdate = bot.app.client.chat.update.mock.calls.map(([a]) => a).find(a => a.channel === 'U1');
    expect(dmUpdate.blocks[1].text.text).toBe('*Q1*\nA1 fixed');
    expect(dmUpdate.blocks.at(-1).elements[0].text).toContain('edited');
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
