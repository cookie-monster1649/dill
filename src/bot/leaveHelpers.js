// ── Leave Helpers ─────────────────────────────────────────────────────────────
//
// Pure data functions for managing member leave blocks. No Slack API calls here.
// The leaveStore is keyed: channelId → userId → [LeaveBlock]
//
// Example store shape:
//   {
//     "C123": {
//       "U456": [
//         { "id": "abc123", "startDate": "2026-04-14", "endDate": "2026-04-18" },
//         { "id": "def456", "startDate": "2026-05-01", "endDate": "2026-05-05" }
//       ]
//     }
//   }

const { DateTime } = require('luxon');

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Returns all leave blocks for a specific user in a channel.
 *
 * @param {object} leaveStore - NestedStore instance
 * @param {string} channel    - Slack channel ID
 * @param {string} userId     - Slack user ID
 * @returns {Array<{id: string, startDate: string, endDate: string}>}
 */
function getLeaveBlocks(leaveStore, channel, userId) {
  const channelData = leaveStore.data[channel] || {};
  return channelData[userId] || [];
}

/**
 * Returns all leave blocks across all users in a channel, sorted by startDate
 * ascending. Used to build the Leave tab display.
 *
 * Example output:
 *   [
 *     { userId: 'U456', id: 'abc123', startDate: '2026-04-14', endDate: '2026-04-18' },
 *     { userId: 'U789', id: 'zzz999', startDate: '2026-05-01', endDate: '2026-05-03' },
 *   ]
 *
 * @param {object} leaveStore
 * @param {string} channel
 * @returns {Array<{userId: string, id: string, startDate: string, endDate: string}>}
 */
function getAllChannelLeave(leaveStore, channel) {
  const channelData = leaveStore.data[channel] || {};
  const all = [];
  for (const [userId, blocks] of Object.entries(channelData)) {
    for (const block of blocks) {
      all.push({ userId, ...block });
    }
  }
  return all.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

// ── Check ─────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given user is on leave for the given ISO date string.
 * ISO string comparison works correctly for YYYY-MM-DD format.
 *
 * @param {object} leaveStore
 * @param {string} channel
 * @param {string} userId
 * @param {string} isoDate   – e.g. '2026-04-15'
 * @returns {boolean}
 */
function isUserOnLeave(leaveStore, channel, userId, isoDate) {
  const blocks = getLeaveBlocks(leaveStore, channel, userId);
  return blocks.some(b => b.startDate <= isoDate && isoDate <= b.endDate);
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Adds a leave block for a user and persists the store.
 *
 * @param {object} leaveStore
 * @param {string} channel
 * @param {string} userId
 * @param {string} startDate  – YYYY-MM-DD
 * @param {string} endDate    – YYYY-MM-DD
 */
function addLeaveBlock(leaveStore, channel, userId, startDate, endDate) {
  if (!leaveStore.data[channel]) leaveStore.data[channel] = {};
  if (!leaveStore.data[channel][userId]) leaveStore.data[channel][userId] = [];

  const id = Math.random().toString(36).slice(2, 8);
  leaveStore.data[channel][userId].push({ id, startDate, endDate });
  leaveStore.save();
}

/**
 * Removes a leave block by id for the given user and persists the store.
 *
 * @param {object} leaveStore
 * @param {string} channel
 * @param {string} userId
 * @param {string} id
 */
function removeLeaveBlock(leaveStore, channel, userId, id) {
  const blocks = getLeaveBlocks(leaveStore, channel, userId);
  const updated = blocks.filter(b => b.id !== id);

  if (!leaveStore.data[channel]) return;
  leaveStore.data[channel][userId] = updated;

  // Clean up empty arrays to keep the store tidy
  if (updated.length === 0) {
    delete leaveStore.data[channel][userId];
  }
  if (Object.keys(leaveStore.data[channel]).length === 0) {
    delete leaveStore.data[channel];
  }

  leaveStore.save();
}

// ── Maintenance ───────────────────────────────────────────────────────────────

/**
 * Removes leave blocks whose endDate is strictly before today.
 * Called whenever the Leave modal is opened to keep the list relevant.
 *
 * @param {object} leaveStore
 * @param {string} channel
 */
function pruneExpiredLeave(leaveStore, channel) {
  const today = DateTime.now().toISODate();
  const channelData = leaveStore.data[channel];
  if (!channelData) return;

  let changed = false;
  for (const userId of Object.keys(channelData)) {
    const before = channelData[userId].length;
    channelData[userId] = channelData[userId].filter(b => b.endDate >= today);
    if (channelData[userId].length !== before) changed = true;
    if (channelData[userId].length === 0) delete channelData[userId];
  }
  if (Object.keys(channelData).length === 0) {
    delete leaveStore.data[channel];
  }

  if (changed) leaveStore.save();
}

module.exports = {
  getLeaveBlocks,
  getAllChannelLeave,
  isUserOnLeave,
  addLeaveBlock,
  removeLeaveBlock,
  pruneExpiredLeave,
};
