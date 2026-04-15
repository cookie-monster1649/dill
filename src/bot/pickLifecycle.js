// ── Pick Lifecycle ────────────────────────────────────────────────────────────
//
// Manages the automated pick flow: posting a pick message to Slack, scheduling
// all rotations on startup, and running the per-rotation daily reset.
//
// These are intentionally separated from app.js because they represent a
// distinct domain concern (the rotation engine) rather than framework wiring.

const { DateTime } = require('luxon');
const { slackApiCall } = require('../utils/slackHelpers');
const { buildPickBlocks } = require('../utils/slackHelpers');
const { getIsoDateTz } = require('../utils/dateHelpers');
const { peekNextUser, handleUserSkip, resetDailySkips } = require('../utils/rotationHelpers');
const { normalizeRotationName } = require('../utils/rotationUtils');
const { isUserOnLeave } = require('./leaveHelpers');

// ── Pick Dispatch ─────────────────────────────────────────────────────────────

/**
 * Posts a pick message for the given rotation. Uses peekNextUser (non-
 * destructive) so the queue isn't advanced until the user accepts or skips.
 *
 * Guards against duplicate picks on the same day by checking today's analytics
 * events before posting.
 *
 * @param {object} bot      - The DillBot instance
 * @param {string} channel  - Slack channel ID
 * @param {string} name     - Rotation name (must match the config store key)
 * @param {Date}   [pickDateOverride] - Unused; kept for call-site compatibility
 */
async function startPick(bot, channel, name) {
  const cfg = bot.configStore.getItem(channel, name);
  if (!cfg) {
    console.error(`[ERROR] startPick called with no config – channel=${channel}, name=${name}`);
    return;
  }

  // ── Duplicate-pick guard ──
  // Check today's events (in the rotation's own timezone) before posting.
  // Without this guard, a skip followed by scheduleAll would re-fire the pick.
  const todayISO = getIsoDateTz(new Date(), cfg.tz);
  const todaysEvents = bot.analyticsService.analyticsStore.getItem('events', todayISO) || [];
  const alreadyAccepted = todaysEvents.some(
    e => e.type === 'pick_accepted'
      && e.data.channelId === channel
      && normalizeRotationName(e.data.name) === normalizeRotationName(name)
  );
  if (alreadyAccepted) {
    console.log(`[INFO] Skipping pick for '${name}' in ${channel} – already accepted today`);
    return;
  }

  // ── Leave-aware auto-skip ─────────────────────────────────────────────────
  // If the next user is on leave today (in the rotation's timezone), skip them
  // automatically and move to the next member. Guard against an infinite loop
  // by capping attempts at the number of rotation members.
  const pickDateIso = DateTime.now().setZone(cfg.tz).toISODate();
  const maxAutoSkips = (cfg.members || []).length;
  let autoSkipCount = 0;

  let turn = peekNextUser(bot.queueStore, channel, name, cfg);
  while (turn && autoSkipCount < maxAutoSkips) {
    if (!isUserOnLeave(bot.leaveStore, channel, turn.user, pickDateIso)) break;
    console.log(`[INFO] Auto-skipping <@${turn.user}> for '${name}' – on leave ${pickDateIso}`);
    handleUserSkip(bot.queueStore, channel, name, turn.user, cfg);
    turn = peekNextUser(bot.queueStore, channel, name, cfg);
    autoSkipCount++;
  }

  if (!turn) {
    // All members are on leave – post a notice rather than picking nobody silently
    console.warn(`[WARN] All members on leave for '${name}' in ${channel} on ${pickDateIso}`);
    try {
      await slackApiCall(bot.app.client.chat.postMessage, {
        channel,
        text: `:palm_tree: Everyone in the *${name}* rotation is on leave today – no pick this round.`,
      });
    } catch (error) {
      console.error(`[ERROR] Failed to post all-on-leave notice for '${name}':`, error);
    }
    return;
  }

  // ── Post the pick message ──
  const pickDate = DateTime.now().setZone(cfg.tz).toJSDate();
  const blocks = buildPickBlocks(name, turn.user, cfg.tz, pickDate);

  // Join the channel first; this fails silently for DMs (expected)
  try {
    await bot.app.client.conversations.join({ channel });
  } catch (e) {
    console.warn(`[WARN] Could not join channel ${channel}: ${e.data?.error || e.message}`);
  }

  try {
    await slackApiCall(bot.app.client.chat.postMessage, {
      channel,
      text: `A new rotation pick for ${name}`,
      blocks,
    });
  } catch (error) {
    console.error(`[ERROR] Failed to post pick message for '${name}' in ${channel}:`, error);
  }

  await bot.createBackup();
}

// ── Scheduler Initialisation ──────────────────────────────────────────────────

/**
 * Stops all existing cron jobs then re-creates one per rotation from the
 * current configStore. Called on startup and after any config change.
 *
 * @param {object} bot - The DillBot instance
 */
function scheduleAll(bot) {
  console.log('[INFO] Initialising rotation schedules...');
  bot.schedulerService.stopAllJobs();

  const allChannels = bot.configStore.data || {};
  for (const channel of Object.keys(allChannels)) {
    const channelRotations = allChannels[channel] || {};
    for (const name of Object.keys(channelRotations)) {
      const cfg = bot.configStore.getItem(channel, name);
      if (cfg?.days) {
        bot.schedulerService.scheduleJob(
          channel,
          name,
          cfg,
          (ch, n) => startPick(bot, ch, n),
          (ch, n, config) => performRotationDailyReset(bot, ch, n, config)
        );
      }
    }
  }

  console.log(`[INFO] Schedule initialisation complete – ${bot.schedulerService.getActiveJobCount()} jobs active`);
}

// ── Daily Reset ───────────────────────────────────────────────────────────────

/**
 * Clears all skip flags and re-sorts the queue by lastAcceptedDate for a
 * single rotation. Called by the per-rotation 00:01 cron job.
 *
 * @param {object} bot    - The DillBot instance
 * @param {string} channel
 * @param {string} name
 * @param {object} config - The rotation config (used by resetDailySkips)
 */
async function performRotationDailyReset(bot, channel, name, config) {
  console.log(`[INFO] Daily reset for '${name}' in ${channel} (tz: ${config.tz})`);
  try {
    resetDailySkips(bot.queueStore, channel, name, config);
    console.log(`[INFO] Daily reset complete for '${name}'`);
  } catch (error) {
    console.error(`[ERROR] Daily reset failed for '${name}' in ${channel}:`, error);
  }
}

module.exports = { startPick, scheduleAll, performRotationDailyReset };
