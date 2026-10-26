// ── Survey Reply Handler ──────────────────────────────────────────────────────
//
// Survey answers are posted by Dill on someone's behalf, so Slack doesn't
// treat that person as the author and won't notify them about replies.
// When someone else replies in the thread of a person's answer post, Dill
// summons them, Geekbot-style: "Summoning @Alex :wand:".
//
// Only for one-message-per-person posts: in thread mode every answer shares
// one daily thread, so a reply there can't be tied to one person.
//
// Answer posts are indexed in surveyStateStore:
//   answerPosts → channel → { '1730000000.000200': { userId: 'U1', date: '2026-10-26', summoned: false } }

const { DateTime } = require('luxon');
const { slackApiCall } = require('../utils/slackHelpers');

// ── Constants ─────────────────────────────────────────────────────────────────

const SUMMON_EMOJI = ':wand:';

// Replies to posts older than this don't summon anyone (keeps the index small)
const INDEX_RETENTION_DAYS = 14;

// ── Index ─────────────────────────────────────────────────────────────────────

/**
 * Remembers which person an answer post belongs to, pruning old entries.
 * Called by surveyPosting after posting in one-message-per-person mode.
 */
function indexAnswerPost(bot, channel, ts, userId, date) {
  const cutoff = DateTime.fromISO(date).minus({ days: INDEX_RETENTION_DAYS }).toISODate();
  const index = bot.surveyStateStore.getItem('answerPosts', channel) || {};
  const kept = Object.fromEntries(Object.entries(index).filter(([, entry]) => entry.date >= cutoff));

  kept[ts] = { userId, date, summoned: false };
  bot.surveyStateStore.setItem('answerPosts', channel, kept);
  bot.surveyStateStore.save();
}

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * A human's thread reply in a channel – not a top-level message, DM, edit,
 * join or bot post.
 */
function isThreadReply(message) {
  return (message.channel_type === 'channel' || message.channel_type === 'group')
    && !!message.thread_ts
    && message.thread_ts !== message.ts
    && (!message.subtype || message.subtype === 'file_share')
    && !message.bot_id
    && !!message.user;
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Bolt `message` listener for channel messages.
 *
 * @example
 * // Bob replies under Alex's answer post → Dill replies in the thread:
 * //   "Summoning <@U_ALEX> :wand:"
 */
async function handleSurveyReply(bot, { message }) {
  if (!isThreadReply(message)) return;

  const index = bot.surveyStateStore.getItem('answerPosts', message.channel) || {};
  const entry = index[message.thread_ts];
  if (!entry || entry.summoned) return;

  // The person replying in their own thread, or someone who already
  // @mentioned them, doesn't need Dill's help
  if (message.user === entry.userId) return;
  if ((message.text || '').includes(`<@${entry.userId}>`)) return;

  // Mark first so a burst of replies can't summon twice
  index[message.thread_ts] = { ...entry, summoned: true };
  bot.surveyStateStore.setItem('answerPosts', message.channel, index);
  bot.surveyStateStore.save();

  try {
    await slackApiCall(bot.app.client.chat.postMessage, {
      channel: message.channel,
      thread_ts: message.thread_ts,
      text: `Summoning <@${entry.userId}> ${SUMMON_EMOJI}`,
    });
    console.log(`[INFO] Summoned ${entry.userId} to a reply on their survey post in ${message.channel}`);
  } catch (error) {
    console.error(`[ERROR] Failed to summon ${entry.userId} in ${message.channel}:`, error);
  }
  await bot.createBackup();
}

module.exports = { SUMMON_EMOJI, indexAnswerPost, isThreadReply, handleSurveyReply };
