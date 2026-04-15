// ── Rotation Data Management ──────────────────────────────────────────────────
//
// Handles the data-lifecycle operations for rotations: deletion and rename.
// These touch multiple stores (config, queue, analytics) and must stay in sync,
// which is why they live together rather than scattered across app.js.

const { normalizeRotationName } = require('../utils/rotationUtils');

// ── Deletion ──────────────────────────────────────────────────────────────────

/**
 * Removes all data for a rotation: config, queue, scheduled jobs, analytics,
 * and state entries. The order matters – stop the scheduler before deleting
 * config so any in-flight cron callbacks don't re-create queue entries.
 *
 * @param {object} bot     - The DillBot instance
 * @param {string} channel - Slack channel ID
 * @param {string} name    - Rotation name
 */
function cleanupRotationData(bot, channel, name) {
  console.log(`[INFO] Cleaning up all data for rotation "${name}" in channel ${channel}`);

  // Stop the job first so a cron tick can't race against the store deletion
  bot.schedulerService.stopJob(channel, name);

  bot.configStore.deleteItem(channel, name);
  bot.queueStore.deleteItem(channel, name);
  bot.configStore.save();
  bot.queueStore.save();

  cleanupRotationAnalytics(bot, channel, name);

  console.log(`[INFO] Cleanup complete for rotation "${name}" in channel ${channel}`);
}

/**
 * Removes all analytics events that reference the given rotation.
 * No-ops if there are no matching events.
 *
 * @param {object} bot
 * @param {string} channel
 * @param {string} name
 */
function cleanupRotationAnalytics(bot, channel, name) {
  const events = bot.analyticsService.analyticsStore.get('events') || {};
  let changed = false;

  for (const date of Object.keys(events)) {
    const daily = events[date];
    if (!Array.isArray(daily)) continue;

    const filtered = daily.filter(
      e => !(e.data?.channelId === channel
          && normalizeRotationName(e.data?.name) === normalizeRotationName(name))
    );

    if (filtered.length !== daily.length) {
      // Remove the date key entirely if no events remain for that day
      if (filtered.length === 0) {
        bot.analyticsService.analyticsStore.deleteItem('events', date);
      } else {
        bot.analyticsService.analyticsStore.setItem('events', date, filtered);
      }
      changed = true;
    }
  }

  if (changed) {
    bot.analyticsService.analyticsStore.save();
    console.log(`[INFO] Cleaned up analytics for rotation "${name}" in channel ${channel}`);
  }
}

// ── Rename ────────────────────────────────────────────────────────────────────

/**
 * Renames a rotation across all stores, preserving all historical data.
 * The scheduler is restarted by the caller (scheduleAll) after this returns.
 *
 * @param {object} bot
 * @param {string} channel
 * @param {string} oldName
 * @param {string} newName
 */
function renameRotationData(bot, channel, oldName, newName) {
  console.log(`[INFO] Renaming rotation "${oldName}" → "${newName}" in channel ${channel}`);

  // Stop old job before touching config so the cron callback can't fire
  // against a half-renamed state
  bot.schedulerService.stopJob(channel, oldName);

  const oldConfig = bot.configStore.getItem(channel, oldName);
  const oldQueue  = bot.queueStore.getItem(channel, oldName);

  if (oldConfig) {
    bot.configStore.setItem(channel, newName, oldConfig);
    bot.configStore.deleteItem(channel, oldName);
  }

  if (oldQueue) {
    bot.queueStore.setItem(channel, newName, oldQueue);
    bot.queueStore.deleteItem(channel, oldName);
  }

  bot.configStore.save();
  bot.queueStore.save();

  renameRotationAnalytics(bot, channel, oldName, newName);

  console.log(`[INFO] Rename complete: "${oldName}" → "${newName}" in channel ${channel}`);
}

/**
 * Updates all analytics events to reference the new rotation name.
 *
 * @param {object} bot
 * @param {string} channel
 * @param {string} oldName
 * @param {string} newName
 */
function renameRotationAnalytics(bot, channel, oldName, newName) {
  const events = bot.analyticsService.analyticsStore.get('events') || {};
  let changed = false;

  for (const date of Object.keys(events)) {
    const daily = events[date];
    if (!Array.isArray(daily)) continue;

    const updated = daily.map(e => {
      if (e.data?.channelId === channel
          && normalizeRotationName(e.data?.name) === normalizeRotationName(oldName)) {
        return { ...e, data: { ...e.data, name: newName } };
      }
      return e;
    });

    if (JSON.stringify(updated) !== JSON.stringify(daily)) {
      bot.analyticsService.analyticsStore.setItem('events', date, updated);
      changed = true;
    }
  }

  if (changed) {
    bot.analyticsService.analyticsStore.save();
    console.log(`[INFO] Updated analytics for rotation rename "${oldName}" → "${newName}"`);
  }
}

module.exports = { cleanupRotationData, renameRotationData };
