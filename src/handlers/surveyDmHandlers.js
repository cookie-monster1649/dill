// ── Survey DM Handler ─────────────────────────────────────────────────────────
//
// Turns each DM a person sends Dill into the answer to their current survey
// question, Geekbot-style. When the last question is answered the survey is
// posted to its channel and the next queued survey (if any) starts.

const { slackApiCall } = require('../utils/slackHelpers');
const { recordAnswer, removeSurvey } = require('../utils/surveyConversation');
const { buildDoneText, buildIdleText } = require('../utils/surveyBlocks');
const {
  getPersonState,
  setPersonState,
  getSurvey,
  askFirstQuestion,
  askCurrentQuestion,
} = require('../bot/surveyLifecycle');
const { postCompletedSurvey } = require('../bot/surveyPosting');

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * Only plain messages a person typed in their DM with Dill count as
 * answers – not edits, deletions, joins or Dill's own messages.
 */
function isAnswerMessage(message) {
  return message.channel_type === 'im'
    && !message.subtype
    && !message.bot_id
    && typeof message.text === 'string'
    && message.text.trim().length > 0;
}

// ── Reply helper ──────────────────────────────────────────────────────────────

function dm(bot, userId, text) {
  return slackApiCall(bot.app.client.chat.postMessage, { channel: userId, text });
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Bolt `message` event listener.
 *
 * @param {object} bot
 * @param {object} payload - Bolt payload containing `message`
 */
async function handleSurveyDm(bot, { message }) {
  if (!isAnswerMessage(message)) return;
  const userId = message.user;
  const state = getPersonState(bot, userId);

  if (!state?.active) {
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
  const { state: nextState, completed, started } = recordAnswer(state, survey.questions, message.text);
  setPersonState(bot, userId, nextState);

  if (!completed) {
    await askCurrentQuestion(bot, userId, survey);
    return;
  }

  try {
    await postCompletedSurvey(bot, survey, completed, userId);
    await dm(bot, userId, buildDoneText(completed.name, completed.channel));
  } catch (error) {
    console.error(`[ERROR] Failed to post survey '${completed.name}' for ${userId}:`, error);
    await dm(bot, userId, `:x: Sorry, I couldn't post your *${completed.name}* answers to <#${completed.channel}>. Please let an admin know.`);
  }
  await bot.createBackup();

  if (started) await askFirstQuestion(bot, userId, started);
}

module.exports = { handleSurveyDm, isAnswerMessage };
