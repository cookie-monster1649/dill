// ── Survey DM Handler ─────────────────────────────────────────────────────────
//
// Turns each DM a person sends Dill into the answer to their current survey
// question, Geekbot-style. When the last question is answered the survey is
// posted to its channel and the next queued survey (if any) starts.

const { slackApiCall } = require('../utils/slackHelpers');
const { recordAnswer, editAnswer, removeSurvey } = require('../utils/surveyConversation');
const { buildDoneText, buildDoneBlocks, buildIdleText } = require('../utils/surveyBlocks');
const {
  getPersonState,
  setPersonState,
  getSurvey,
  askFirstQuestion,
  askCurrentQuestion,
} = require('../bot/surveyLifecycle');
const { postCompletedSurvey, recordDoneMessage, findPostByAnswerTs, updatePostedAnswers } = require('../bot/surveyPosting');
const { BANTER, REACTIONS, RUDE_REPLY, classifyBanter } = require('../utils/banter');

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * Only plain messages a person typed in their DM with Dill count as
 * answers – not edits, deletions, joins or Dill's own messages.
 */
function isAnswerMessage(message) {
  return message.channel_type === 'im'
    // file_share = a reply with a screenshot/attachment; its text still counts
    && (!message.subtype || message.subtype === 'file_share')
    && !message.bot_id
    && typeof message.text === 'string'
    && message.text.trim().length > 0;
}

function isAttachmentOnly(message) {
  return message.channel_type === 'im' && message.subtype === 'file_share'
    && !message.bot_id && !(message.text || '').trim();
}

// Slack sends an edited DM as subtype 'message_changed', with the new
// version under message.message
function isAnswerEdit(message) {
  return message.channel_type === 'im'
    && message.subtype === 'message_changed'
    && !message.message?.bot_id
    && typeof message.message?.text === 'string'
    && message.message.text.trim().length > 0;
}

// ── Reply helper ──────────────────────────────────────────────────────────────

function dm(bot, userId, text) {
  return slackApiCall(bot.app.client.chat.postMessage, { channel: userId, text });
}

/**
 * Responds to banter aimed at Dill: ❤️ for praise, 😢 for "bad bot", and a
 * suspicious question for anything really rude. A failed reaction is only
 * logged – a missing emoji isn't worth an error DM.
 */
async function respondToBanter(bot, message, kind) {
  if (kind === BANTER.RUDE) return dm(bot, message.user, RUDE_REPLY);

  try {
    await bot.app.client.reactions.add({ channel: message.channel, timestamp: message.ts, name: REACTIONS[kind] });
  } catch (error) {
    console.warn(`[WARN] Could not react to banter from ${message.user}: ${error.data?.error || error.message}`);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Bolt `message` event listener.
 *
 * @param {object} bot
 * @param {object} payload - Bolt payload containing `message`
 */
async function handleSurveyDm(bot, { message }) {
  if (isAnswerEdit(message)) return handleAnswerEdit(bot, message);

  // An image with no text can't be posted as an answer – say so rather
  // than silently waiting
  if (isAttachmentOnly(message) && getPersonState(bot, message.user)?.active) {
    await dm(bot, message.user, "I can only post text answers. Please type your answer – you can include a link to the file.");
    return;
  }
  if (!isAnswerMessage(message)) return;
  const userId = message.user;
  const state = getPersonState(bot, userId);

  if (!state?.active) {
    // "thanks" / "bad bot" / swearing gets a reaction rather than the
    // "no survey" reply. Only when idle – mid-survey every message is an answer.
    const banter = classifyBanter(message.text);
    if (banter) return respondToBanter(bot, message, banter);
    await dm(bot, userId, buildIdleText());
    return;
  }

  // ── Survey deleted mid-conversation ──
  // Drop it and move on to whatever is queued next
  const survey = getSurvey(bot, state.active.channel, state.active.name);
  if (!survey) {
    const { state: nextState, started } = removeSurvey(state, state.active);
    setPersonState(bot, userId, nextState);
    if (started) return askFirstQuestion(bot, userId, started);
    return dm(bot, userId, buildIdleText());
  }

  // ── Record the answer ──
  // State is saved before any Slack call so a quick second reply sees it
  const { state: nextState, completed, started } = recordAnswer(state, survey.questions, message.text, message.ts);
  setPersonState(bot, userId, nextState);

  if (!completed) {
    await askCurrentQuestion(bot, userId, survey);
    // Partial answers are backed up too, so a restart mid-survey resumes
    // where the person left off instead of losing their answers
    await bot.createBackup();
    return;
  }

  try {
    await postCompletedSurvey(bot, survey, completed, userId);
    const done = await slackApiCall(bot.app.client.chat.postMessage, {
      channel: userId,
      text: buildDoneText(completed.name, completed.channel),
      blocks: buildDoneBlocks(survey, completed.channel, completed.date, completed.answers),
    });
    // Remembered so an edit can refresh this summary
    recordDoneMessage(bot, completed.channel, completed.name, userId, done.channel, done.ts);
  } catch (error) {
    console.error(`[ERROR] Failed to post survey '${completed.name}' for ${userId}:`, error);
    await dm(bot, userId, `:x: Sorry, I couldn't post your *${completed.name}* answers to <#${completed.channel}>. Please let an admin know.`);
  }
  await bot.createBackup();

  if (started) await askFirstQuestion(bot, userId, started);
}

// ── Edits ─────────────────────────────────────────────────────────────────────

/**
 * A person edited one of their DM replies. If it answers the survey they're
 * still doing, the new text replaces that answer before it's posted. If it
 * answers one they've finished, the channel post is updated instead.
 */
async function handleAnswerEdit(bot, message) {
  const { user: userId, ts, text } = message.message;

  // ── In progress ──
  const state = getPersonState(bot, userId);
  const { state: nextState, changed } = editAnswer(state, ts, text);
  if (changed) {
    setPersonState(bot, userId, nextState);
    console.log(`[INFO] ${userId} edited an in-progress survey answer`);
    await bot.createBackup();
    return;
  }

  // ── Already posted ──
  const posted = findPostByAnswerTs(bot, userId, ts);
  if (!posted) return;
  const survey = getSurvey(bot, posted.channel, posted.name);
  if (!survey) return;

  const answers = [...posted.post.answers];
  answers[posted.index] = text.trim();
  try {
    await updatePostedAnswers(bot, survey, posted.channel, userId, { answers });
    console.log(`[INFO] Updated survey answers for ${userId} in '${posted.name}' from a DM edit`);
    await bot.createBackup();
  } catch (error) {
    console.error(`[ERROR] Failed to apply DM edit for ${userId} in '${posted.name}':`, error);
  }
}

module.exports = { handleSurveyDm, isAnswerMessage };
