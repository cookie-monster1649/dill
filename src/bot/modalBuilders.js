// ── Modal Builders ────────────────────────────────────────────────────────────
//
// Builds and opens the Slack modals that make up Dill's UI. Separated from
// app.js because modal-construction logic is verbose and has its own reason
// to change (UI tweaks) that's distinct from routing or lifecycle concerns.

const { buildNewRotationView } = require('../utils/slackHelpers');
const { compareByLastAccepted, getRotationSchedule } = require('../utils/rotationHelpers');
const { isUserOnLeave } = require('./leaveHelpers');
const { DateTime } = require('luxon');

// ── Main Overview Modal ───────────────────────────────────────────────────────

/**
 * Opens the main "Dill Rotations" overview modal for a channel.
 * Uses a 2-second timeout guard because Slack expires trigger IDs quickly;
 * if block construction takes too long we'd get an opaque API error.
 *
 * @param {object} bot
 * @param {object} client    - Slack WebClient
 * @param {string} triggerId
 * @param {string} channel
 */
async function openSelectModal(bot, client, triggerId, channel) {
  try {
    const blocks = await Promise.race([
      buildRotationsViewBlocks(bot, channel),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 2000)),
    ]);

    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'dill_select',
        private_metadata: channel,
        title: { type: 'plain_text', text: 'Dill Rotations' },
        close: { type: 'plain_text', text: 'Close' },
        blocks,
      },
    });
  } catch (error) {
    if (error.message === 'TIMEOUT') {
      console.warn('[WARN] Building rotation blocks timed out.');
    } else if (error.data?.error === 'expired_trigger_id') {
      console.warn('[WARN] Trigger ID expired while opening overview modal.');
    } else {
      throw error;
    }
  }
}

/**
 * Opens the create/edit rotation form modal, pre-populated for edits.
 *
 * @param {object} bot
 * @param {object} client
 * @param {string} triggerId
 * @param {string} channel
 * @param {string} [preName=''] - Existing rotation name when editing
 */
async function openNewRotationModal(bot, client, triggerId, channel, preName = '') {
  const existingConfig = preName ? bot.configStore.getItem(channel, preName) : null;
  const view = buildNewRotationView(channel, preName, existingConfig, bot.timezoneOptions);
  await client.views.open({ trigger_id: triggerId, view });
}

/**
 * Builds the rotation form view object (without opening it).
 * Called by ActionHandlers when pushing the form onto an existing modal stack.
 *
 * @param {object} bot
 * @param {string} channel
 * @param {string} [preName='']
 * @returns {object} Slack view payload
 */
function buildNewRotationViewForBot(bot, channel, preName = '') {
  const existingConfig = preName ? bot.configStore.getItem(channel, preName) : null;
  return buildNewRotationView(channel, preName, existingConfig, bot.timezoneOptions);
}

// ── Rotation Overview Blocks ──────────────────────────────────────────────────

/**
 * Builds the full block array for the overview modal, iterating over all
 * rotations in the channel and rendering each member's queue position and
 * last-accepted date.
 *
 * Example shape of one rotation's queue (schedule):
 *   [
 *     { user: 'U123', isSkipped: false, lastAcceptedDate: '2024-11-01' },
 *     { user: 'U456', isSkipped: true,  lastAcceptedDate: null },
 *   ]
 *
 * @param {object} bot
 * @param {string} channel
 * @returns {Promise<object[]>} Slack blocks array
 */
async function buildRotationsViewBlocks(bot, channel) {
  const channelConfig = bot.configStore.get(channel);
  const rotationNames = Object.keys(channelConfig);
  const blocks = [];

  // ── Tab navigation ────────────────────────────────────────────────────────
  // Slack has no native tabs; simulated with a two-button row at the top.
  // "Rotations" is primary (highlighted) because we're on the Rotations view.
  blocks.push({
    type: 'actions',
    elements: [
      { type: 'button', text: { type: 'plain_text', text: 'Rotations' }, action_id: 'open_rotations_tab', style: 'primary', value: channel },
      { type: 'button', text: { type: 'plain_text', text: 'Leave Calendar' }, action_id: 'open_leave_tab', value: channel },
    ],
  });
  blocks.push({ type: 'divider' });

  const validRotations = rotationNames.filter(r => {
    const cfg = channelConfig[r];
    return typeof cfg === 'object' && cfg !== null && Array.isArray(cfg.days);
  });

  if (validRotations.length > 0) {
    blocks.push({ type: 'header', text: { type: 'plain_text', text: 'Existing rotations' } });
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '_Queue order may change with skips and daily resets._' }] });

    for (const name of validRotations) {
      const cfg = channelConfig[name];
      const members = cfg.members || [];

      // Settings gear button in the section header
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${name}*` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: '⚙', emoji: true },
          action_id: 'rotation_settings',
          value: name,
        },
      });

      if (members.length > 0) {
        try {
          blocks.push(...buildQueueBlocks(bot, channel, name, cfg, members));
        } catch (error) {
          console.error(`[ERROR] Loading queue for "${name}":`, error);
          blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_Could not load queue._' } });
        }
      } else {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_This rotation has no members._' } });
      }

      blocks.push({
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Edit' }, action_id: 'edit_rotation', value: name },
          { type: 'button', text: { type: 'plain_text', text: 'Delete' }, action_id: 'delete_rotation_start', value: name, style: 'danger' },
        ],
      });
      blocks.push({ type: 'divider' });
    }
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: "Welcome to Dill Rotations! 🥒\n\nThis bot helps you manage on-call shifts and other scheduled hand-offs. There are no rotations set up in this channel yet." },
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Create a new rotation*' },
    accessory: { type: 'button', text: { type: 'plain_text', text: 'New Rotation' }, action_id: 'create_new', style: 'primary' },
  });

  return blocks;
}

/**
 * Returns the full Slack view payload for the Rotations overview modal.
 * Used by the open_rotations_tab action to switch back from the Leave view
 * via views.update without reopening a new modal.
 *
 * @param {object} bot
 * @param {string} channel
 * @returns {Promise<object>} Slack view payload
 */
async function buildRotationsView(bot, channel) {
  const blocks = await buildRotationsViewBlocks(bot, channel);
  return {
    type: 'modal',
    callback_id: 'dill_select',
    private_metadata: channel,
    title: { type: 'plain_text', text: 'Dill Rotations' },
    close: { type: 'plain_text', text: 'Close' },
    blocks,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds the member-list blocks for one rotation in the overview modal.
 * Sorts the queue by lastAcceptedDate (oldest first) before rendering.
 *
 * Each row shows the user mention, skip status, and last-accepted date:
 *   • @Alice • Last accepted: 2024-11-01
 *   • @Bob _(skipped)_ • Never accepted
 *
 * @param {object} bot
 * @param {string} channel
 * @param {string} name
 * @param {object} cfg
 * @param {string[]} members
 * @returns {object[]} Slack blocks
 */
function buildQueueBlocks(bot, channel, name, cfg, members) {
  let schedule = getRotationSchedule(bot.queueStore, channel, name, members);

  // Sort by lastAcceptedDate so the display matches the actual pick order.
  // Null (never accepted) always sorts first.
  schedule = [...schedule].sort(compareByLastAccepted);

  if (schedule.length === 0) {
    return [{ type: 'section', text: { type: 'mrkdwn', text: '_No members in queue._' } }];
  }

  // Check leave status once per render using today's date in the rotation's timezone
  const todayIso = DateTime.now().setZone(cfg.tz || 'UTC').toISODate();

  return schedule.map((entry, i) => {
    let userText = `<@${entry.user}>`;
    if (isUserOnLeave(bot.leaveStore, channel, entry.user, todayIso)) {
      userText += ' _(on leave)_';
    } else if (entry.isSkipped) {
      userText += ' _(skipped)_';
    }

    const dateText = entry.lastAcceptedDate
      ? ` • Last accepted: ${entry.lastAcceptedDate}`
      : ' • Never accepted';

    return {
      type: 'section',
      text: { type: 'mrkdwn', text: `• ${userText}${dateText}` },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Skip', emoji: true },
        action_id: 'future_skip',
        value: JSON.stringify({ channel, name, user: entry.user, index: i }),
      },
    };
  });
}

module.exports = { openSelectModal, openNewRotationModal, buildNewRotationViewForBot, buildRotationsViewBlocks, buildRotationsView };
