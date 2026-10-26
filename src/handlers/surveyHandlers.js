// ── Survey Handlers ───────────────────────────────────────────────────────────
//
// Action and view-submission handlers for the Surveys tab of /dill.
//
//   openSurveysTab      – swaps the modal to the Surveys tab (action: open_surveys_tab)
//   openSurveyForm      – pushes the create/edit form (actions: create_survey, edit_survey)
//   handleSurveySubmit  – validates and saves, then refreshes the tab (view: dill_survey_form)

const { buildSurveysView, buildSurveyFormView } = require('../bot/surveyModalBuilders');
const { surveyKey } = require('../bot/surveyLifecycle');
const { POST_MODES } = require('../utils/surveyBlocks');

// Per-survey runtime state that follows a rename and goes on delete
const SURVEY_STATE_BUCKETS = ['sent', 'threads', 'posts'];

// ── Form parsing ──────────────────────────────────────────────────────────────

/**
 * Turns the submitted form values into a survey config, or field errors.
 * Pure, so validation can be unit-tested.
 *
 * @param {object} values - view.state.values
 * @returns {{ survey?: object, errors?: object, remove?: boolean }}
 *
 * @example
 * parseSurveyForm(values)
 * // → { survey: { name: 'Daily standup', members: ['U1'], questions: ['Q1'],
 * //               days: ['mon'], time: '09:30', postMode: 'thread' } }
 */
function parseSurveyForm(values) {
  const v = (block) => values[block]?.value;

  const remove = (v('survey_delete')?.selected_options || []).some(o => o.value === 'delete');
  const name = (v('survey_name')?.value || '').trim();
  const members = v('survey_members')?.selected_users || [];
  const questions = (v('survey_questions')?.value || '')
    .split('\n')
    .map(q => q.trim())
    .filter(Boolean);
  const days = (v('survey_days')?.selected_options || []).map(o => o.value);
  const time = v('survey_time')?.selected_time;
  const postMode = v('survey_post_mode')?.selected_option?.value || POST_MODES.THREAD;

  if (remove) return { remove: true };

  // ── Validation ──
  const errors = {};
  if (!name) errors.survey_name = 'Give the survey a name.';
  if (name.includes('::')) errors.survey_name = 'Names can’t contain "::".';
  if (members.length === 0) errors.survey_members = 'Pick at least one person.';
  if (questions.length === 0) errors.survey_questions = 'Add at least one question.';
  if (days.length === 0) errors.survey_days = 'Pick at least one day.';
  if (!time) errors.survey_time = 'Pick a time.';
  if (Object.keys(errors).length > 0) return { errors };

  return { survey: { name, members, questions, days, time, postMode } };
}

// ── Data changes ──────────────────────────────────────────────────────────────

/**
 * Removes a survey's config and its send/thread/post history. People mid-way
 * through it are moved on the next time they reply (see surveyDmHandlers).
 */
function deleteSurveyData(bot, channel, name) {
  bot.surveyStore.deleteItem(channel, name);
  for (const bucket of SURVEY_STATE_BUCKETS) {
    bot.surveyStateStore.deleteItem(bucket, surveyKey(channel, name));
  }
}

/**
 * Moves send/thread/post history to a new name so a rename doesn't re-send
 * today's survey to everyone.
 */
function renameSurveyData(bot, channel, oldName, newName) {
  for (const bucket of SURVEY_STATE_BUCKETS) {
    const data = bot.surveyStateStore.getItem(bucket, surveyKey(channel, oldName));
    if (data) bot.surveyStateStore.setItem(bucket, surveyKey(channel, newName), data);
    bot.surveyStateStore.deleteItem(bucket, surveyKey(channel, oldName));
  }
  bot.surveyStore.deleteItem(channel, oldName);
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function openSurveysTab(bot, { ack, body, client }) {
  await ack();
  const channel = body.view?.private_metadata;
  try {
    await client.views.update({ view_id: body.view.id, hash: body.view.hash, view: buildSurveysView(bot, channel) });
  } catch (e) {
    console.error('[ERROR] Failed to switch to Surveys tab:', e);
  }
}

async function openSurveyForm(bot, { ack, action, body, client }) {
  await ack();
  const channel = body.view?.private_metadata;
  const existing = action.action_id === 'edit_survey' ? bot.surveyStore.getItem(channel, action.value) : null;
  await client.views.push({ trigger_id: body.trigger_id, view: buildSurveyFormView(channel, existing) });
}

async function handleSurveySubmit(bot, { ack, view, client }) {
  const { channel, originalName } = JSON.parse(view.private_metadata);
  const { survey, errors, remove } = parseSurveyForm(view.state.values);

  if (errors) return ack({ response_action: 'errors', errors });

  // A new name must not overwrite a different existing survey
  if (survey && survey.name !== originalName && bot.surveyStore.getItem(channel, survey.name)) {
    return ack({ response_action: 'errors', errors: { survey_name: 'A survey with this name already exists here.' } });
  }
  await ack();

  // ── Save ──
  if (remove && originalName) {
    deleteSurveyData(bot, channel, originalName);
    console.log(`[INFO] Deleted survey '${originalName}' in ${channel}`);
  } else if (survey) {
    if (originalName && originalName !== survey.name) renameSurveyData(bot, channel, originalName, survey.name);
    bot.surveyStore.setItem(channel, survey.name, survey);
    console.log(`[INFO] Saved survey '${survey.name}' in ${channel}`);
  }
  bot.surveyStore.save();
  bot.surveyStateStore.save();
  await bot.createBackup();

  // ── Refresh the Surveys tab underneath the form ──
  try {
    await client.views.update({ view_id: view.previous_view_id, view: buildSurveysView(bot, channel) });
  } catch (e) {
    console.error('[ERROR] Failed to refresh Surveys tab:', e);
  }
}

module.exports = { parseSurveyForm, openSurveysTab, openSurveyForm, handleSurveySubmit };
