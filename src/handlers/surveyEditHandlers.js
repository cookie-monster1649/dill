// ── Survey Edit Handlers ──────────────────────────────────────────────────────
//
// Lets a person fix their posted survey answers. The "Edit answers" button
// on the done DM opens a prefilled form; saving edits the channel post in
// place rather than posting again.
//
//   openEditAnswers    – opens the form (action: survey_edit_answers)
//   handleEditSubmit   – updates the post (view: survey_edit_answers_submit)

const { slackApiCall } = require('../utils/slackHelpers');
const { buildEditAnswersView, escapeSlack } = require('../utils/surveyBlocks');
const { getSurvey } = require('../bot/surveyLifecycle');
const { getLatestPost, updatePostedAnswers } = require('../bot/surveyPosting');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Tells the person why editing isn't possible, in their DM with Dill
function dmError(bot, userId, text) {
  return slackApiCall(bot.app.client.chat.postMessage, { channel: userId, text: `:x: ${text}` });
}

/**
 * Reads the answers out of the submitted form, in question order.
 *
 * @example
 * readAnswers({ answer_0: { value: { value: ' R&D done ' } } }, 1) // → ['R&amp;D done']
 */
function readAnswers(values, questionCount) {
  // Escaped like Slack message text, so edited answers post the same way
  return Array.from({ length: questionCount }, (_, i) => escapeSlack((values[`answer_${i}`]?.value?.value || '').trim()));
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function openEditAnswers(bot, { ack, action, body, client }) {
  await ack();
  const userId = body.user.id;
  const { channel, name, date } = JSON.parse(action.value);

  const survey = getSurvey(bot, channel, name);
  const post = getLatestPost(bot, channel, name, userId);
  if (!survey || !post) {
    await dmError(bot, userId, `I can't find your *${name}* answers any more – the survey may have been renamed or deleted.`);
    return;
  }
  // Only the latest post is editable; an older DM's button must not
  // overwrite today's answers ('date' is missing on pre-audit buttons)
  if (date && date !== post.date) {
    await dmError(bot, userId, `You can only edit your latest *${name}* answers.`);
    return;
  }

  try {
    await client.views.open({ trigger_id: body.trigger_id, view: buildEditAnswersView(survey, channel, post.answers) });
  } catch (error) {
    console.error(`[ERROR] Could not open edit form for ${userId} in '${name}':`, error.data || error);
    await dmError(bot, userId, `I couldn't open the edit form for *${name}*. Please try again.`);
  }
}

async function handleEditSubmit(bot, { ack, body, view }) {
  await ack();
  const userId = body.user.id;
  const { channel, name } = JSON.parse(view.private_metadata);

  const survey = getSurvey(bot, channel, name);
  if (!survey) {
    await dmError(bot, userId, `I couldn't update your *${name}* answers – the survey has been deleted.`);
    return;
  }

  try {
    await updatePostedAnswers(bot, survey, channel, userId, readAnswers(view.state.values, survey.questions.length));
    console.log(`[INFO] Updated survey answers for ${userId} in '${name}'`);
    await bot.createBackup();
  } catch (error) {
    console.error(`[ERROR] Failed to update survey answers for ${userId} in '${name}':`, error);
    await dmError(bot, userId, `I couldn't update your *${name}* answers in <#${channel}>. Please try again.`);
  }
}

module.exports = { openEditAnswers, handleEditSubmit, readAnswers };
