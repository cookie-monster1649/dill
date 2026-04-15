// ── Admin Commands ────────────────────────────────────────────────────────────
//
// Handlers for the /dill slash command sub-commands that are available to
// ordinary users: help, status, reset, and pick.
//
// Each function receives the bot instance plus the standard Slack Bolt payload
// so business logic stays here and app.js stays thin.

const { DateTime } = require('luxon');
const { getIsoDateTz } = require('../utils/dateHelpers');
const { generateShuffledRotation } = require('../utils/rotationHelpers');
const { normalizeRotationName } = require('../utils/rotationUtils');
const { startPick } = require('../bot/pickLifecycle');

// ── Help ──────────────────────────────────────────────────────────────────────

/**
 * Sends the help text for all available /dill commands.
 * Appends a list of rotations active in the current channel, if any exist.
 *
 * @param {object} bot
 * @param {object} client
 * @param {object} body
 * @param {string} channel
 */
async function handleHelpCommand(bot, client, body, channel) {
  const rotationNames = Object.keys(bot.configStore.get(channel) || {});

  let text =
    '*Dill Bot Help*\n' +
    '• `/dill`: Opens the main interactive modal to view and manage all rotations.\n' +
    '• `/dill help`: Displays this help message.\n' +
    '• `/dill pick [rotation-name]`: Manually triggers a pick from the specified rotation.\n' +
    '• `/dill reset [rotation-name]`: Resets and randomises a rotation\'s queue.\n' +
    '• `/dill status`: Shows bot status and statistics.\n' +
    '• `/dill restore-backup`: Restores all Dill data from the most recent Slack backup.\n' +
    '• `/dill delete-backup`: Deletes all Dill backup messages from the backup channel.\n' +
    '• `/dill kill-kill-kill`: *Danger zone!* Wipes all Dill data and backups.';

  if (rotationNames.length > 0) {
    text += '\n\n*Available rotations in this channel:*\n' +
      rotationNames.map(n => `• \`${n}\``).join('\n');
  }

  await client.chat.postEphemeral({ channel, user: body.user_id, text });
}

// ── Status ────────────────────────────────────────────────────────────────────

/**
 * Posts a summary of bot uptime, memory, and active schedule counts.
 *
 * @param {object} bot
 * @param {object} client
 * @param {object} body
 * @param {string} channel
 */
async function handleStatusCommand(bot, client, body, channel) {
  const totalRotations = Object.keys(bot.configStore.get(channel) || {}).length;
  const totalJobs = bot.schedulerService.getActiveJobCount();
  const uptimeMin = Math.floor(process.uptime() / 60);
  const memoryMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

  await client.chat.postEphemeral({
    channel,
    user: body.user_id,
    text:
      `*Dill Bot Status*\n` +
      `• Active rotations: ${totalRotations}\n` +
      `• Scheduled jobs: ${totalJobs}\n` +
      `• Uptime: ${uptimeMin} minutes\n` +
      `• Memory usage: ${memoryMb}MB`,
  });
}

// ── Reset ─────────────────────────────────────────────────────────────────────

/**
 * Re-shuffles the queue for a named rotation.
 * Uses case/emoji-insensitive matching so users don't need to type names exactly.
 *
 * @param {object} bot
 * @param {object} client
 * @param {object} body
 * @param {string} channel
 * @param {string[]} args - Remaining words after "reset"
 */
async function handleResetCommand(bot, client, body, channel, args) {
  const rotationName = args.join(' ');
  if (!rotationName) {
    return client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: 'Please specify which rotation to reset. Usage: `/dill reset [rotation name]`',
    });
  }

  const allRotations = bot.configStore.get(channel) || {};
  const matchKey = Object.keys(allRotations).find(
    k => normalizeRotationName(k) === normalizeRotationName(rotationName)
  );
  const cfg = matchKey ? bot.configStore.getItem(channel, matchKey) : null;

  if (!cfg) {
    return client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: `Could not find a rotation named *${rotationName}*.`,
    });
  }

  if ((cfg.members || []).length < 2) {
    return client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: `The *${rotationName}* rotation has too few members to reset.`,
    });
  }

  const newQueue = generateShuffledRotation(cfg.members);
  bot.queueStore.setItem(channel, matchKey, newQueue);
  bot.queueStore.save();
  await bot.createBackup();

  const newOrder = newQueue.map((t, i) => `${i + 1}. <@${t.user}>`).join('\n');
  return client.chat.postEphemeral({
    channel,
    user: body.user_id,
    text: `✅ The queue for *${matchKey}* has been reset and randomised.\n\nNew order:\n${newOrder}`,
  });
}

// ── Manual Pick ───────────────────────────────────────────────────────────────

/**
 * Manually triggers a pick for a named rotation outside its schedule.
 * Guards against a second pick on the same day if one was already accepted.
 * Posts a warning (but still picks) if today is not a scheduled day.
 *
 * @param {object} bot
 * @param {object} client
 * @param {object} body
 * @param {string} channel
 * @param {string[]} args - Remaining words after "pick"
 */
async function handlePickCommand(bot, client, body, channel, args) {
  const rotationName = args.join(' ');
  if (!rotationName) {
    return client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: 'Please specify which rotation to pick from. Usage: `/dill pick [rotation name]`',
    });
  }

  const allRotations = bot.configStore.get(channel) || {};
  const matchKey = Object.keys(allRotations).find(
    k => normalizeRotationName(k) === normalizeRotationName(rotationName)
  );
  const cfg = matchKey ? bot.configStore.getItem(channel, matchKey) : null;

  if (!cfg) {
    return client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: `Could not find a rotation named *${rotationName}*.`,
    });
  }

  // ── Duplicate-pick guard ──
  // startPick also checks this, but we check here first to give the user a
  // visible error rather than a silent no-op.
  const todayISO = getIsoDateTz(new Date(), cfg.tz);
  const todaysEvents = bot.analyticsService.analyticsStore.getItem('events', todayISO) || [];
  const alreadyAccepted = todaysEvents.some(
    e => e.type === 'pick_accepted'
      && e.data.channelId === channel
      && normalizeRotationName(e.data.name) === normalizeRotationName(rotationName)
  );
  if (alreadyAccepted) {
    return client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: `:warning: A pick for *${rotationName}* was already accepted today.`,
    });
  }

  // ── Non-scheduled day warning ──
  const weekdayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const todayDay = weekdayMap[DateTime.now().setZone(cfg.tz).weekday % 7];
  if (!cfg.days.includes(todayDay)) {
    await client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: `:warning: You are manually triggering a pick on a non-scheduled day (*${todayDay}*). The queue will advance anyway.`,
    });
  } else {
    await client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: `Manually starting rotation *${matchKey}*...`,
    });
  }

  await startPick(bot, channel, matchKey);
}

module.exports = { handleHelpCommand, handleStatusCommand, handleResetCommand, handlePickCommand };
