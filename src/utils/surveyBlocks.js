// ── Survey Blocks ─────────────────────────────────────────────────────────────
//
// Renders the text and Block Kit used by daily surveys: the DM prompts each
// person sees, and the answer posts in the shared channel. Pure functions –
// no Slack calls – so the wording and layout can be unit-tested.

// ── Constants ─────────────────────────────────────────────────────────────────

// How completed answers land in the shared channel, chosen per survey
const POST_MODES = Object.freeze({
  THREAD: 'thread',          // one parent message per day, answers as replies
  INDIVIDUAL: 'individual',  // each person's answers as a top-level message
});

// Slack rejects section text over 3000 characters
const MAX_SECTION_CHARS = 2900;

function truncate(text, max = MAX_SECTION_CHARS) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

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

function buildDoneText(name, channel) {
  return `Thanks! Your *${name}* answers are posted in <#${channel}>.`;
}

/**
 * The "done" DM: a summary of what was posted plus an Edit button. Dill
 * can't edit the person's own DM replies, so this summary is what gets
 * updated after an edit. The button value identifies the post:
 * '{"channel":"C1","name":"Daily standup"}'.
 *
 * @param {object}   survey  - { name, questions }
 * @param {string}   channel
 * @param {string[]} answers
 * @param {boolean}  [edited]
 */
function buildDoneBlocks(survey, channel, answers, edited = false) {
  const blocks = [{
    type: 'section',
    text: { type: 'mrkdwn', text: buildDoneText(survey.name, channel) },
    accessory: {
      type: 'button',
      text: { type: 'plain_text', text: 'Edit answers' },
      action_id: 'survey_edit_answers',
      value: JSON.stringify({ channel, name: survey.name }),
    },
  }, ...buildAnswerSections(survey.questions, answers)];

  if (edited) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '_(edited – the channel post is updated too)_' }] });
  }
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
function buildEditAnswersView(survey, channel, answers) {
  const blocks = survey.questions.map((question, i) => ({
    type: 'input',
    block_id: `answer_${i}`,
    label: { type: 'plain_text', text: truncate(question, 2000) },
    element: { type: 'plain_text_input', action_id: 'value', multiline: true, initial_value: answers[i] || '' },
  }));

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

/**
 * One person's completed answers.
 *
 * @param {object}   survey - { name, questions: ['Q1', 'Q2'] }
 * @param {string}   userId
 * @param {string[]} answers
 * @returns {object[]} Block Kit blocks
 *
 * @example
 * buildAnswerBlocks({ name: 'Standup', questions: ['Yesterday?'] }, 'U1', ['Shipped it'])
 * // → [ { section "<@U1> posted *Standup*" },
 * //     { section "*Yesterday?*\nShipped it" } ]
 */
function buildAnswerBlocks(survey, userId, answers) {
  const header = {
    type: 'section',
    text: { type: 'mrkdwn', text: `<@${userId}> posted *${survey.name}*` },
  };

  return [header, ...buildAnswerSections(survey.questions, answers)];
}

// One section per question, e.g. { section "*Yesterday?*\nShipped it" }
function buildAnswerSections(questions, answers) {
  return questions.map((question, i) => ({
    type: 'section',
    text: { type: 'mrkdwn', text: truncate(`*${question}*\n${answers[i] || '_No answer_'}`) },
  }));
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

module.exports = {
  POST_MODES,
  buildIntroText,
  buildQuestionText,
  buildDoneText,
  buildDoneBlocks,
  buildEditAnswersView,
  buildIdleText,
  buildAnswerBlocks,
  buildThreadParentBlocks,
};
