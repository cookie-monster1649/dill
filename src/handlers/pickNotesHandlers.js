// ── Pick Notes Handlers ───────────────────────────────────────────────────────
//
// Handlers for previewing a rotation's pick message from the edit modal.
//
//   handlePickNotesPreview – pushes a preview of the pick message, built from
//                            the form's unsaved values (action: pick_notes_preview)
//   handlePreviewButton    – acks the inert Accept/Skip buttons shown in the
//                            preview (actions: pick_preview_*)

const { buildPickBlocks } = require('../utils/slackHelpers');
const { readPickNotes } = require('../utils/pickNotesModalBlocks');

// ── Preview view ──────────────────────────────────────────────────────────────

/**
 * Builds the preview modal from the edit form's current state values.
 * The pick buttons are renamed so clicking them can't accept or skip a
 * real pick.
 *
 * @param {object} values   - body.view.state.values from the edit modal
 * @param {string} viewerId - Fallback "picked" user when no members are set
 * @returns {object} Slack modal view
 *
 * @example
 * // blocks → [context, section "*Retro*: It's your turn, @Alex!", rich_text, actions]
 */
function buildPickPreviewView(values, viewerId) {
  const name = values.name_block?.name_input?.value?.trim() || 'Rotation';
  const pickedUser = values.member_block?.members_select?.selected_users?.[0] || viewerId;
  const tz = values.schedule_tz?.tz_select?.selected_option?.value || 'UTC';
  const notes = readPickNotes(values);

  const pickBlocks = buildPickBlocks(name, pickedUser, tz, new Date(), notes).map(block => {
    if (block.type !== 'actions') return block;
    const { block_id: _ignored, ...rest } = block;
    return {
      ...rest,
      elements: block.elements.map(el => ({ ...el, action_id: `pick_preview_${el.action_id}` })),
    };
  });

  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Pick preview' },
    close: { type: 'plain_text', text: 'Back' },
    blocks: [
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: "_This is how the pick message will look. Click *Back* to keep editing – nothing is saved until you click *Save*._" }],
      },
      { type: 'divider' },
      ...pickBlocks,
    ],
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handlePickNotesPreview({ ack, body, client }) {
  await ack();
  try {
    const view = buildPickPreviewView(body.view.state.values, body.user.id);
    await client.views.push({ trigger_id: body.trigger_id, view });
  } catch (error) {
    console.error('[ERROR] Failed to open pick preview:', error.data?.error || error.message);
  }
}

// The preview's Accept/Skip buttons are for show only
async function handlePreviewButton({ ack }) {
  await ack();
}

module.exports = { buildPickPreviewView, handlePickNotesPreview, handlePreviewButton };
