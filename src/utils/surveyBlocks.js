// ── Survey Blocks ─────────────────────────────────────────────────────────────
//
// Renders the text and Block Kit used by daily surveys: the DM prompts each
// person sees, and the answer posts in the shared channel. Pure functions –
// no Slack calls – so the wording and layout can be unit-tested.

const { isEmptyAnswer } = require('./emptyAnswers');

// ── Constants ─────────────────────────────────────────────────────────────────

// How completed answers land in the shared channel, chosen per survey
const POST_MODES = Object.freeze({
  THREAD: 'thread',          // one parent message per day, answers as replies
  INDIVIDUAL: 'individual',  // each person's answers as a top-level message
});

// Label for the free-text note added with "Say something else"
const EXTRA_QUESTION = 'Anything else?';

/**
 * The survey's questions and answers plus the "Anything else?" note, if
 * the person added one. Everything that renders answers goes through here.
 *
 * @example
 * withExtra({ questions: ['Q1'] }, ['A1'], 'Off Friday')
 * // → { questions: ['Q1', 'Anything else?'], answers: ['A1', 'Off Friday'] }
 */
function withExtra(survey, answers, extra) {
  if (!extra) return { questions: survey.questions, answers };
  return { questions: [...survey.questions, EXTRA_QUESTION], answers: [...survey.questions.map((_, i) => answers[i] || ''), extra] };
}

// Slack rejects section text over 3000 characters
const MAX_SECTION_CHARS = 2900;

function truncate(text, max = MAX_SECTION_CHARS) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ── Slack text escaping ───────────────────────────────────────────────────────
//
// Slack sends message text with &, < and > escaped. Answers are stored that
// way (ready to post), so the edit form unescapes them for display and
// re-escapes whatever the person types back.

// 'R&amp;D' → 'R&D'
function unescapeSlack(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// 'R&D <3' → 'R&amp;D &lt;3' – but keeps <@U123> / <#C123> / <http…> links intact
function escapeSlack(text) {
  return text
    .split(/(<[@#!][^>]+>|<https?:[^>]+>)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')))
    .join('');
}

// Slack rejects plain_text_input initial values over 3000 characters
const MAX_INPUT_CHARS = 3000;

// ── DM prompts ────────────────────────────────────────────────────────────────

/**
 * First DM of a survey, sent just before the first question.
 *
 * @example
 * buildIntroText('Daily standup', 'C123')
 * // → "Hi! It's time for *Daily standup* in <#C123>. ..."
 */
function buildIntroText(name, channel) {
  return `Hi! It's time for *${name}* in <#${channel}>. Reply to each question here and I'll post your answers when you're done.`;
}

/**
 * @example
 * buildQuestionText('What did you do yesterday?', 0, 3)
 * // → "*1/3* What did you do yesterday?"
 */
function buildQuestionText(question, index, total) {
  return `*${index + 1}/${total}* ${question}`;
}

/**
 * Reminder for someone who hasn't finished today's survey. If it's queued
 * behind another survey, says which one to finish first.
 *
 * @example
 * buildReminderText('Daily standup', 'C123')
 * // → ":wave: Reminder: you haven't finished *Daily standup* for <#C123> yet. …"
 */
function buildReminderText(name, channel, blockingName = null) {
  const base = `:wave: Reminder: you haven't finished *${name}* for <#${channel}> yet.`;
  return blockingName
    ? `${base} It'll start as soon as you finish *${blockingName}*.`
    : `${base} Just reply here to carry on.`;
}

function buildDoneText(name, channel) {
  return `Thanks! Your *${name}* answers are posted in <#${channel}>.`;
}

/**
 * The "done" DM: a summary of what was posted plus an Edit button. Dill
 * can't edit the person's own DM replies, so this summary is what gets
 * updated after an edit. The button value identifies the post:
 * '{"channel":"C1","name":"Daily standup","date":"2026-10-26"}'.
 *
 * @param {object}   survey  - { name, questions }
 * @param {string}   channel
 * @param {string}   date    - ISO date of the survey run
 * @param {string[]} answers
 * @param {object}   [options] - { edited: true, extra: 'Off Friday' }
 */
function buildDoneBlocks(survey, channel, date, answers, { edited = false, extra = '' } = {}) {
  const value = JSON.stringify({ channel, name: survey.name, date });
  const all = withExtra(survey, answers, extra);

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: buildDoneText(survey.name, channel) } },
    ...buildAnswerSections(all.questions, all.answers),
  ];
  if (edited) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '_(edited – the channel post is updated too)_' }] });
  }
  blocks.push({
    type: 'actions',
    elements: [
      { type: 'button', text: { type: 'plain_text', text: 'Edit answers' }, action_id: 'survey_edit_answers', value },
      { type: 'button', text: { type: 'plain_text', text: 'Say something else' }, action_id: 'survey_add_more', value },
    ],
  });
  return blocks;
}

/**
 * Modal for editing posted answers – one multiline input per question,
 * prefilled. private_metadata repeats the button value so the submit
 * handler knows which post to update.
 *
 * @param {object}   survey  - { name, questions }
 * @param {string}   channel
 * @param {string[]} answers - Currently posted answers
 */
function buildEditAnswersView(survey, channel, answers, extra = '') {
  const blocks = survey.questions.map((question, i) => ({
    type: 'input',
    block_id: `answer_${i}`,
    label: { type: 'plain_text', text: truncate(question, 2000) },
    element: {
      type: 'plain_text_input',
      action_id: 'value',
      multiline: true,
      max_length: MAX_INPUT_CHARS,
      initial_value: unescapeSlack(answers[i] || '').slice(0, MAX_INPUT_CHARS),
    },
  }));

  // Optional, so clearing it removes the note from the post
  blocks.push({
    type: 'input',
    block_id: 'answer_extra',
    optional: true,
    label: { type: 'plain_text', text: EXTRA_QUESTION },
    element: {
      type: 'plain_text_input', action_id: 'value', multiline: true, max_length: MAX_INPUT_CHARS,
      ...(extra ? { initial_value: unescapeSlack(extra).slice(0, MAX_INPUT_CHARS) } : {}),
    },
  });

  return {
    type: 'modal',
    callback_id: 'survey_edit_answers_submit',
    private_metadata: JSON.stringify({ channel, name: survey.name }),
    title: { type: 'plain_text', text: 'Edit answers' },
    submit: { type: 'plain_text', text: 'Update' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks,
  };
}

// Reply when someone DMs Dill without an active survey
function buildIdleText() {
  return "You don't have a survey to answer right now. I'll message you when the next one is due.";
}

// ── Channel posts ─────────────────────────────────────────────────────────────

// Left-bar colours for each question's attachment, cycled in order – soft
// tones like Geekbot's so a long post stays easy to scan
const QUESTION_COLOURS = ['#9FD3D0', '#8FA0C4', '#E8B38A', '#B9A3D6', '#A8C99B', '#E0A3B5'];

/**
 * One person's completed answers, laid out like Geekbot: a plain intro line,
 * then each question and answer in its own attachment with a coloured left
 * bar. Spread the result into chat.postMessage / chat.update.
 *
 * @param {object}   survey     - { name, questions: ['Q1', 'Q2'] }
 * @param {object}   author     - { userId: 'U1', name: 'Alex Smith' } (name may be missing)
 * @param {string[]} answers
 * @param {string}   [extra]    - "Anything else?" note, shown last if present
 * @returns {{ text: string, blocks: object[], attachments: object[] }}
 *
 * @example
 * buildAnswerMessage({ name: 'Standup', questions: ['Yesterday?'] }, { userId: 'U1', name: 'Alex' }, ['Shipped it'])
 * // → { text: 'Alex posted an update for Standup',
 * //     blocks: [ section "Alex posted an update for *Standup*" ],
 * //     attachments: [ { color: '#9FD3D0', blocks: [ section "*Yesterday?*\nShipped it" ] } ] }
 */
function buildAnswerMessage(survey, author, answers, extra = '') {
  // Falls back to a mention if Slack didn't give us a name
  const who = author.name || `<@${author.userId}>`;
  const intro = `${who} posted an update for *${survey.name}*`;

  // "No" / "nope" / "n/a" answers are left out of the channel post
  const all = withExtra(survey, answers, extra);
  const sections = buildAnswerSections(all.questions, all.answers, { hideEmpty: true });
  const body = sections.length > 0
    ? sections
    : [{ type: 'section', text: { type: 'mrkdwn', text: '_Nothing to report._' } }];

  return {
    text: `${who} posted an update for ${survey.name}`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: intro } }],
    attachments: body.map((section, i) => ({
      color: QUESTION_COLOURS[i % QUESTION_COLOURS.length],
      blocks: [section],
    })),
  };
}

/**
 * One section per question, e.g. { section "*Yesterday?*\nShipped it" }.
 *
 * hideEmpty → drop non-answers (channel post)
 * otherwise → keep them, marked as not posted (the person's DM summary)
 */
function buildAnswerSections(questions, answers, { hideEmpty = false } = {}) {
  return questions.flatMap((question, i) => {
    const answer = answers[i] || '';
    const empty = isEmptyAnswer(answer);
    if (empty && hideEmpty) return [];

    const shown = answer || '_No answer_';
    const note = empty ? '  _(not posted)_' : '';
    return [{ type: 'section', text: { type: 'mrkdwn', text: truncate(`*${question}*\n${shown}${note}`) } }];
  });
}

/**
 * The daily parent message used in thread mode. It lists who has answered
 * so far and is edited in place each time someone finishes.
 *
 * @param {string}   name
 * @param {string}   dateLabel - e.g. 'Mon 26 Oct'
 * @param {string[]} members   - Everyone the survey was sent to
 * @param {string[]} completed - Members who have answered
 *
 * @example
 * buildThreadParentBlocks('Standup', 'Mon 26 Oct', ['U1', 'U2'], ['U1'])
 * // → section "*Standup* – Mon 26 Oct", context "1/2 answered · Waiting on <@U2>"
 */
function buildThreadParentBlocks(name, dateLabel, members, completed) {
  const waiting = members.filter(m => !completed.includes(m));
  const progress = `${completed.length}/${members.length} answered`;
  const status = waiting.length > 0
    ? `${progress} · Waiting on ${waiting.map(u => `<@${u}>`).join(', ')}`
    : `${progress} · Everyone's in :tada:`;

  return [
    { type: 'section', text: { type: 'mrkdwn', text: `*${name}* – ${dateLabel}\nAnswers are in the thread.` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: status }] },
  ];
}

/**
 * The "Say something else" form: one free-text field whose text is added
 * to the end of the person's post.
 */
function buildAnythingElseView(survey, channel, date) {
  return {
    type: 'modal',
    callback_id: 'survey_add_more_submit',
    private_metadata: JSON.stringify({ channel, name: survey.name, date }),
    title: { type: 'plain_text', text: 'Say something else' },
    submit: { type: 'plain_text', text: 'Add to post' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [{
      type: 'input',
      block_id: 'extra',
      label: { type: 'plain_text', text: EXTRA_QUESTION },
      element: { type: 'plain_text_input', action_id: 'value', multiline: true, max_length: MAX_INPUT_CHARS, focus_on_load: true },
    }],
  };
}

module.exports = {
  POST_MODES,
  escapeSlack,
  unescapeSlack,
  buildIntroText,
  buildQuestionText,
  buildDoneText,
  buildReminderText,
  buildDoneBlocks,
  buildEditAnswersView,
  buildAnythingElseView,
  EXTRA_QUESTION,
  buildIdleText,
  buildAnswerMessage,
  buildThreadParentBlocks,
};
