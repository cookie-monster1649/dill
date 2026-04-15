// ── Leave Modal Builders ──────────────────────────────────────────────────────
//
// Builds the two Slack modals that make up the leave UI:
//
//   buildLeaveView(leaveStore, channel)
//     The main Leave Calendar modal (callback_id: 'dill_leave').
//     Shows all upcoming leave chronologically with a "Remove" button per entry
//     and a footer "Log Leave" button to open the add-leave form.
//
//   buildLeaveFormView(channel)
//     The add-leave form (callback_id: 'dill_leave_add').
//     Collects the user(s), start date, and end date.

const { getAllChannelLeave } = require('./leaveHelpers');
const { DateTime } = require('luxon');

// ── Leave Calendar Modal ──────────────────────────────────────────────────────

/**
 * Builds the full block array for the Leave Calendar modal.
 *
 * Example leave entry block:
 *   • <@U456>  Apr 14 – Apr 18 2026        [Remove]
 *
 * @param {object} leaveStore
 * @param {string} channel
 * @returns {object[]} Slack blocks array
 */
function buildLeaveViewBlocks(leaveStore, channel) {
  const allLeave = getAllChannelLeave(leaveStore, channel);
  const blocks = [];

  // ── Tab navigation ────────────────────────────────────────────────────────
  // "Leave Calendar" is primary (highlighted) because we're on the Leave view.
  blocks.push({
    type: 'actions',
    elements: [
      { type: 'button', text: { type: 'plain_text', text: 'Rotations' }, action_id: 'open_rotations_tab', value: channel },
      { type: 'button', text: { type: 'plain_text', text: 'Leave Calendar' }, action_id: 'open_leave_tab', style: 'primary', value: channel },
    ],
  });
  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '_Members on leave are automatically skipped during picks._' }],
  });

  if (allLeave.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No leave planned in this channel._' },
    });
  } else {
    for (const entry of allLeave) {
      const start = formatLeaveDate(entry.startDate);
      const end   = formatLeaveDate(entry.endDate);
      const dateRange = start === end ? start : `${start} – ${end}`;

      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `<@${entry.userId}>  ${dateRange}` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Remove', emoji: false },
          style: 'danger',
          action_id: 'leave_remove',
          value: JSON.stringify({ channel, userId: entry.userId, id: entry.id }),
        },
      });
    }
  }

  blocks.push({ type: 'divider' });

  // Log Leave button – opens the add-leave form as a new modal
  blocks.push({
    type: 'actions',
    elements: [{
      type: 'button',
      text: { type: 'plain_text', text: 'Log Leave', emoji: false },
      action_id: 'leave_add_open',
      style: 'primary',
      value: channel,
    }],
  });

  return blocks;
}

/**
 * Returns the full Slack view payload for the Leave Calendar modal.
 *
 * @param {object} leaveStore
 * @param {string} channel
 * @returns {object} Slack view payload
 */
function buildLeaveView(leaveStore, channel) {
  return {
    type: 'modal',
    callback_id: 'dill_leave',
    private_metadata: channel,
    title: { type: 'plain_text', text: 'Leave Calendar' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: buildLeaveViewBlocks(leaveStore, channel),
  };
}

// ── Add-Leave Form Modal ──────────────────────────────────────────────────────

/**
 * Builds the add-leave form view, pushed onto the modal stack when the user
 * clicks "Log Leave". On submit, the dill_leave_add view handler persists the
 * blocks and updates the parent Leave Calendar modal.
 *
 * @param {string} channel
 * @returns {object} Slack view payload
 */
function buildLeaveFormView(channel) {
  return {
    type: 'modal',
    callback_id: 'dill_leave_add',
    private_metadata: channel,
    title: { type: 'plain_text', text: 'Log Leave' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'leave_users',
        label: { type: 'plain_text', text: 'Who is on leave?' },
        element: {
          type: 'multi_users_select',
          action_id: 'users_input',
          placeholder: { type: 'plain_text', text: 'Select team members' },
        },
      },
      {
        type: 'input',
        block_id: 'leave_start',
        label: { type: 'plain_text', text: 'Start date' },
        element: {
          type: 'datepicker',
          action_id: 'start_input',
        },
      },
      {
        type: 'input',
        block_id: 'leave_end',
        label: { type: 'plain_text', text: 'End date' },
        element: {
          type: 'datepicker',
          action_id: 'end_input',
        },
      },
    ],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats a YYYY-MM-DD string as a human-readable label, e.g. "Apr 14 2026".
 *
 * @param {string} isoDate
 * @returns {string}
 */
function formatLeaveDate(isoDate) {
  return DateTime.fromISO(isoDate).toFormat('LLL dd yyyy');
}

module.exports = { buildLeaveView, buildLeaveViewBlocks, buildLeaveFormView };
