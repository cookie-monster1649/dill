// ── Survey Modal Builders ─────────────────────────────────────────────────────
//
// Builds the "Surveys" tab of the /dill modal and the create/edit survey
// form. Kept apart from modalBuilders.js (rotations) so each UI has its own
// reason to change.

const { POST_MODES } = require('../utils/surveyBlocks');

// ── Shared options ────────────────────────────────────────────────────────────

const DAY_OPTIONS = [
  ['Mon', 'mon'], ['Tue', 'tue'], ['Wed', 'wed'], ['Thu', 'thu'],
  ['Fri', 'fri'], ['Sat', 'sat'], ['Sun', 'sun'],
].map(([text, value]) => ({ text: { type: 'plain_text', text }, value }));

const POST_MODE_OPTIONS = [
  { text: { type: 'plain_text', text: 'One thread per day' }, value: POST_MODES.THREAD,
    description: { type: 'plain_text', text: 'A daily message, with everyone’s answers as replies' } },
  { text: { type: 'plain_text', text: 'One message per person' }, value: POST_MODES.INDIVIDUAL,
    description: { type: 'plain_text', text: 'Each person’s answers post as their own message' } },
];

const DEFAULT_QUESTIONS = [
  'What did you do since your last update?',
  'What are you working on today?',
  'Anything blocking you?',
];

// ── Tab navigation ────────────────────────────────────────────────────────────

/**
 * The tab row shared by every /dill view. Slack has no native tabs, so the
 * current tab is shown as the primary (highlighted) button.
 *
 * @param {string} channel
 * @param {'rotations'|'leave'|'surveys'} current
 */
function buildTabRow(channel, current) {
  const tab = (text, actionId, key) => ({
    type: 'button',
    text: { type: 'plain_text', text },
    action_id: actionId,
    value: channel,
    ...(current === key ? { style: 'primary' } : {}),
  });

  return {
    type: 'actions',
    elements: [
      tab('Rotations', 'open_rotations_tab', 'rotations'),
      tab('Leave Calendar', 'open_leave_tab', 'leave'),
      tab('Surveys', 'open_surveys_tab', 'surveys'),
    ],
  };
}

// ── Surveys tab ───────────────────────────────────────────────────────────────

// 'thread' → 'One thread per day'
function postModeLabel(mode) {
  return (POST_MODE_OPTIONS.find(o => o.value === mode) || POST_MODE_OPTIONS[0]).text.text;
}

/**
 * Lists this channel's surveys with a ⚙️ to edit each one.
 *
 * @example one survey renders as
 *   *Daily standup*                                     [⚙️]
 *   Mon, Tue, Wed at 09:30 (each person's time) · 3 questions · 4 people
 */
function buildSurveysView(bot, channel) {
  const surveys = bot.surveyStore.get(channel);
  const blocks = [buildTabRow(channel, 'surveys'), { type: 'divider' }];

  const names = Object.keys(surveys);
  if (names.length === 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: 'No surveys in this channel yet.\n\nA survey DMs each person a few questions at the same local time every day and posts their answers here.' } });
  }

  for (const name of names) {
    const s = surveys[name];
    const days = (s.days || []).map(d => d[0].toUpperCase() + d.slice(1)).join(', ');
    const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${name}*\n${days} at ${s.time} (each person's time) · ${count(s.questions.length, 'question')} · ${s.members.length === 1 ? '1 person' : `${s.members.length} people`} · ${postModeLabel(s.postMode)}` },
      accessory: { type: 'button', text: { type: 'plain_text', text: ':gear:', emoji: true }, action_id: 'edit_survey', value: name },
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Create a new survey*' },
    accessory: { type: 'button', text: { type: 'plain_text', text: 'New Survey' }, action_id: 'create_survey', style: 'primary', value: channel },
  });

  return {
    type: 'modal',
    callback_id: 'dill_select',
    private_metadata: channel,
    title: { type: 'plain_text', text: 'Dill Surveys' },
    close: { type: 'plain_text', text: 'Close' },
    blocks,
  };
}

// ── Create / edit form ────────────────────────────────────────────────────────

/**
 * The survey form, pushed on top of the Surveys tab. Questions are entered
 * one per line, which keeps the form a fixed size for any number of them.
 *
 * private_metadata carries the channel and the name being edited (null when
 * creating), e.g. '{"channel":"C1","originalName":"Daily standup"}'.
 *
 * @param {string} channel
 * @param {object} [existing] - Survey config when editing
 */
function buildSurveyFormView(channel, existing = null) {
  const s = existing || {};
  const initialDays = DAY_OPTIONS.filter(o => (s.days || ['mon', 'tue', 'wed', 'thu', 'fri']).includes(o.value));
  const initialMode = POST_MODE_OPTIONS.find(o => o.value === s.postMode) || POST_MODE_OPTIONS[0];

  const input = (blockId, label, element, extra = {}) =>
    ({ type: 'input', block_id: blockId, label: { type: 'plain_text', text: label }, element, ...extra });

  const blocks = [
    input('survey_name', 'Name', { type: 'plain_text_input', action_id: 'value', initial_value: s.name || 'Daily standup', max_length: 60 }),
    input('survey_members', 'Who gets it', {
      type: 'multi_users_select', action_id: 'value',
      ...(s.members?.length ? { initial_users: s.members } : {}),
    }),
    input('survey_questions', 'Questions (one per line)', {
      type: 'plain_text_input', action_id: 'value', multiline: true,
      initial_value: (s.questions || DEFAULT_QUESTIONS).join('\n'),
    }),
    input('survey_days', 'Days', { type: 'multi_static_select', action_id: 'value', options: DAY_OPTIONS, initial_options: initialDays }),
    input('survey_time', 'Time', { type: 'timepicker', action_id: 'value', initial_time: s.time || '09:30' },
      { hint: { type: 'plain_text', text: 'Sent at this time in each person’s own Slack timezone' } }),
    input('survey_post_mode', 'Post answers as', { type: 'radio_buttons', action_id: 'value', options: POST_MODE_OPTIONS, initial_option: initialMode }),
  ];

  if (existing) {
    blocks.push(input('survey_delete', 'Delete', {
      type: 'checkboxes', action_id: 'value',
      options: [{ text: { type: 'plain_text', text: 'Delete this survey' }, value: 'delete' }],
    }, { optional: true }));
  }

  return {
    type: 'modal',
    callback_id: 'dill_survey_form',
    private_metadata: JSON.stringify({ channel, originalName: existing ? s.name : null }),
    title: { type: 'plain_text', text: existing ? 'Edit survey' : 'New survey' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks,
  };
}

module.exports = { DAY_OPTIONS, POST_MODE_OPTIONS, DEFAULT_QUESTIONS, buildTabRow, buildSurveysView, buildSurveyFormView };
