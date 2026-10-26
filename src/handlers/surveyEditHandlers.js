// ── Survey Edit Handlers ──────────────────────────────────────────────────────
//
// Lets a person fix their posted survey answers. The "Edit answers" button
// on the done DM opens a prefilled form; saving edits the channel post in
// place rather than posting again.
//
//   openEditAnswers      – opens the form (action: survey_edit_answers)
//   handleEditSubmit     – updates the post (view: survey_edit_answers_submit)
//   openAnythingElse     – "Say something else" form (action: survey_add_more)
//   handleAnythingElse   – appends the note to the post (view: survey_add_more_submit)

const { slackApiCall } = require('../utils/slackHelpers');
const { buildEditAnswersView, buildAnythingElseView, escapeSlack } = require('../utils/surveyBlocks');
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

// The "Anything else?" field from either form, escaped like message text
function readExtra(values, blockId) {
  return escapeSlack((values[blockId]?.value?.value || '').trim());
}

/**
 * Finds the survey and latest post a DM button refers to, or DMs the person
 * why it can't be changed and returns null.
 */
async function loadEditablePost(bot, userId, { channel, name, date }) {
  const survey = getSurvey(bot, channel, name);
  const post = getLatestPost(bot, channel, name, userId);
  if (!survey || !post) {
    await dmError(bot, userId, `I can't find your *${name}* answers any more – the survey may have been renamed or deleted.`);
    return null;
  }
  // Only the latest post is editable; an older DM's button must not
  // overwrite today's answers ('date' is missing on pre-audit buttons)
  if (date && date !== post.date) {
    await dmError(bot, userId, `You can only change your latest *${name}* answers.`);
    return null;
  }
  return { survey, post };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function openEditAnswers(bot, { ack, action, body, client }) {
  await ack();
  const userId = body.user.id;
  const ref = JSON.parse(action.value);
  const found = await loadEditablePost(bot, userId, ref);
  if (!found) return;

  try {
    const view = buildEditAnswersView(found.survey, ref.channel, found.post.answers, found.post.extra);
    await client.views.open({ trigger_id: body.trigger_id, view });
  } catch (error) {
    console.error(`[ERROR] Could not open edit form for ${userId} in '${ref.name}':`, error.data || error);
    await dmError(bot, userId, `I couldn't open the edit form for *${ref.name}*. Please try again.`);
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
    const answers = readAnswers(view.state.values, survey.questions.length);
    await updatePostedAnswers(bot, survey, channel, userId, { answers, extra: readExtra(view.state.values, 'answer_extra') });
    console.log(`[INFO] Updated survey answers for ${userId} in '${name}'`);
    await bot.createBackup();
  } catch (error) {
    console.error(`[ERROR] Failed to update survey answers for ${userId} in '${name}':`, error);
    await dmError(bot, userId, `I couldn't update your *${name}* answers in <#${channel}>. Please try again.`);
  }
}

// ── Say something else ────────────────────────────────────────────────────────

async function openAnythingElse(bot, { ack, action, body, client }) {
  await ack();
  const userId = body.user.id;
  const ref = JSON.parse(action.value);
  const found = await loadEditablePost(bot, userId, ref);
  if (!found) return;

  try {
    await client.views.open({ trigger_id: body.trigger_id, view: buildAnythingElseView(found.survey, ref.channel, found.post.date) });
  } catch (error) {
    console.error(`[ERROR] Could not open "Say something else" for ${userId} in '${ref.name}':`, error.data || error);
    await dmError(bot, userId, `I couldn't open that form for *${ref.name}*. Please try again.`);
  }
}

/**
 * Appends the note to the person's post. Saying something else twice adds
 * to the note rather than replacing it.
 *
 * @example
 * // post.extra 'Off Friday' + new 'Back Monday' → 'Off Friday\nBack Monday'
 */
async function handleAnythingElse(bot, { ack, body, view }) {
  await ack();
  const userId = body.user.id;
  const ref = JSON.parse(view.private_metadata);
  const addition = readExtra(view.state.values, 'extra');
  if (!addition) return;

  const found = await loadEditablePost(bot, userId, ref);
  if (!found) return;

  try {
    await updatePostedAnswers(bot, found.survey, ref.channel, userId, post => ({
      extra: post.extra ? `${post.extra}\n${addition}` : addition,
    }));
    console.log(`[INFO] Added "anything else" to ${userId}'s '${ref.name}' answers`);
    await bot.createBackup();
  } catch (error) {
    console.error(`[ERROR] Failed to add to ${userId}'s '${ref.name}' answers:`, error);
    await dmError(bot, userId, `I couldn't add that to your *${ref.name}* post in <#${ref.channel}>. Please try again.`);
  }
}

module.exports = { openEditAnswers, handleEditSubmit, openAnythingElse, handleAnythingElse, readAnswers };
