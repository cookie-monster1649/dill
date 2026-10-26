// ── Survey Lifecycle ──────────────────────────────────────────────────────────
//
// Sends daily surveys to each member at the configured time in *their own*
// timezone. A single cron ticks every minute and asks, for every member of
// every survey, "is this person due right now?" (see utils/surveySchedule).
//
// Survey configs live in surveyStore under channel → survey name:
//   { name: 'Daily standup', members: ['U1', 'U2'],
//     questions: ['What did you do yesterday?', 'Any blockers?'],
//     days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '09:30',
//     postMode: 'thread' }
//
// Runtime state lives in surveyStateStore:
//   people  → userId → { active, queue }           (see utils/surveyConversation)
//   sent    → "C1::Daily standup" → { U1: '2026-10-26' }
//   threads → "C1::Daily standup" → { '2026-10-26': { ts, completed: ['U1'] } }

const { CronJob } = require('cron');
const { slackApiCall } = require('../utils/slackHelpers');
const { isSurveyDue, nowInZone } = require('../utils/surveySchedule');
const { enqueueSurvey, currentQuestion } = require('../utils/surveyConversation');
const { buildIntroText, buildQuestionText } = require('../utils/surveyBlocks');
const { isUserOnLeave } = require('./leaveHelpers');

// ── Constants ─────────────────────────────────────────────────────────────────

// Slack timezones rarely change; re-check a few times a day at most
const TZ_CACHE_MS = 6 * 60 * 60 * 1000;

// ── State access ──────────────────────────────────────────────────────────────

function surveyKey(channel, name) {
  return `${channel}::${name}`;
}

function getPersonState(bot, userId) {
  return bot.surveyStateStore.getItem('people', userId);
}

function setPersonState(bot, userId, state) {
  bot.surveyStateStore.setItem('people', userId, state);
  bot.surveyStateStore.save();
}

function getSurvey(bot, channel, name) {
  return bot.surveyStore.getItem(channel, name);
}

// ── Timezones ─────────────────────────────────────────────────────────────────

const tzCache = new Map(); // userId → { tz: 'Australia/Sydney', fetchedAt: 1730000000000 }

/**
 * Looks up a person's Slack timezone, cached. Returns undefined on failure,
 * which nowInZone treats as UTC.
 */
async function getUserTz(bot, userId) {
  const cached = tzCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < TZ_CACHE_MS) return cached.tz;

  try {
    const result = await bot.app.client.users.info({ user: userId });
    const tz = result.user?.tz;
    tzCache.set(userId, { tz, fetchedAt: Date.now() });
    return tz;
  } catch (error) {
    console.warn(`[WARN] Could not fetch timezone for ${userId}: ${error.data?.error || error.message}`);
    return cached?.tz;
  }
}

// ── Asking questions ──────────────────────────────────────────────────────────

/**
 * DMs the intro and first question for a survey that has just become active.
 */
async function askFirstQuestion(bot, userId, run) {
  const survey = getSurvey(bot, run.channel, run.name);
  if (!survey) return;

  await slackApiCall(bot.app.client.chat.postMessage, { channel: userId, text: buildIntroText(run.name, run.channel) });
  await askCurrentQuestion(bot, userId, survey);
}

/**
 * DMs whichever question the person is currently on.
 */
async function askCurrentQuestion(bot, userId, survey) {
  const question = currentQuestion(getPersonState(bot, userId), survey.questions);
  if (!question) return;

  await slackApiCall(bot.app.client.chat.postMessage, {
    channel: userId,
    text: buildQuestionText(question.text, question.index, survey.questions.length),
  });
}

// ── Sending ───────────────────────────────────────────────────────────────────

/**
 * Sends one survey to one person: records it as sent for their local date,
 * then starts the conversation (or queues it behind another survey).
 */
async function sendSurveyTo(bot, channel, name, userId, isoDate) {
  const sent = bot.surveyStateStore.getItem('sent', surveyKey(channel, name)) || {};
  // Record before any Slack call so a failure can't cause repeat DMs each minute
  bot.surveyStateStore.setItem('sent', surveyKey(channel, name), { ...sent, [userId]: isoDate });

  const run = { channel, name, date: isoDate };
  const { state, startNow } = enqueueSurvey(getPersonState(bot, userId), run);
  setPersonState(bot, userId, state);
  console.log(`[INFO] Survey '${name}' sent to ${userId} for ${isoDate}${startNow ? '' : ' (queued)'}`);

  if (startNow) await askFirstQuestion(bot, userId, run);
}

/**
 * One minute's work: find every person who is due and send to them.
 * Errors for one person never stop the rest.
 */
async function surveyTick(bot) {
  const allChannels = bot.surveyStore.data || {};

  for (const [channel, surveys] of Object.entries(allChannels)) {
    for (const [name, survey] of Object.entries(surveys || {})) {
      if (!survey?.questions?.length || !survey?.members?.length) continue;
      const sent = bot.surveyStateStore.getItem('sent', surveyKey(channel, name)) || {};

      for (const userId of survey.members) {
        try {
          const now = nowInZone(await getUserTz(bot, userId));
          if (!isSurveyDue(survey, now, sent[userId])) continue;
          if (isUserOnLeave(bot.leaveStore, channel, userId, now.toISODate())) continue;
          await sendSurveyTo(bot, channel, name, userId, now.toISODate());
        } catch (error) {
          console.error(`[ERROR] Survey '${name}' failed for ${userId}:`, error);
        }
      }
    }
  }
}

/**
 * Starts the every-minute survey cron. Kept outside SchedulerService because
 * scheduleAll() stops every job there whenever a rotation is saved.
 */
function startSurveyScheduler(bot) {
  let running = false;
  const job = new CronJob('* * * * *', async () => {
    // A slow tick (many users.info calls) must not overlap the next one
    if (running) return;
    running = true;
    try {
      await surveyTick(bot);
    } finally {
      running = false;
    }
  }, null, true, 'UTC');

  console.log('[INFO] Survey scheduler started (every minute)');
  return job;
}

module.exports = {
  surveyKey,
  getPersonState,
  setPersonState,
  getSurvey,
  askFirstQuestion,
  askCurrentQuestion,
  sendSurveyTo,
  surveyTick,
  startSurveyScheduler,
};
