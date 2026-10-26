// Tests for pick notes: legacy string conversion, empty detection, and the
// blocks added to pick messages and the edit modal.

const { toRichText, isEmptyRichText, buildPickNotesMessageBlocks } = require('../src/utils/pickNotes');
const { buildPickNotesInputBlocks, readPickNotes } = require('../src/utils/pickNotesModalBlocks');
const { buildPickPreviewView } = require('../src/handlers/pickNotesHandlers');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sectionElements(richText) {
  return richText.elements[0].elements;
}

const RICH = {
  type: 'rich_text',
  block_id: 'abc',
  elements: [{ type: 'rich_text_section', elements: [
    { type: 'text', text: 'Review the ' },
    { type: 'link', url: 'https://trello.com/b/x', text: 'retro board' },
  ] }],
};

// ── Legacy conversion ─────────────────────────────────────────────────────────

describe('toRichText', () => {
  test('keeps rich text as-is', () => {
    expect(toRichText(RICH)).toBe(RICH);
  });

  test('turns Slack <url|label> links into link elements', () => {
    expect(sectionElements(toRichText('See <https://x.io|board> now'))).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'link', url: 'https://x.io', text: 'board' },
      { type: 'text', text: ' now' },
    ]);
  });

  test('turns bare URLs into link elements', () => {
    expect(sectionElements(toRichText('https://x.io'))).toEqual([{ type: 'link', url: 'https://x.io' }]);
  });

  test('keeps line breaks', () => {
    expect(sectionElements(toRichText('one\ntwo'))).toEqual([
      { type: 'text', text: 'one' }, { type: 'text', text: '\n' }, { type: 'text', text: 'two' },
    ]);
  });

  test('empty strings become null', () => {
    expect(toRichText('   ')).toBeNull();
    expect(toRichText(null)).toBeNull();
  });
});

// ── Emptiness ─────────────────────────────────────────────────────────────────

describe('isEmptyRichText', () => {
  test('a cleared editor counts as empty', () => {
    const cleared = { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [] }] };
    expect(isEmptyRichText(cleared)).toBe(true);
  });

  test('a link on its own counts as content', () => {
    const linkOnly = { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'link', url: 'https://x.io' }] }] };
    expect(isEmptyRichText(linkOnly)).toBe(false);
  });
});

// ── Message and modal blocks ──────────────────────────────────────────────────

describe('buildPickNotesMessageBlocks', () => {
  test('posts the rich text without the submitted block_id', () => {
    const [block] = buildPickNotesMessageBlocks(RICH);
    expect(block.block_id).toBeUndefined();
    expect(block.elements).toBe(RICH.elements);
  });

  test('adds nothing when there are no notes', () => {
    expect(buildPickNotesMessageBlocks(null)).toEqual([]);
  });
});

describe('buildPickNotesInputBlocks', () => {
  test('editor is followed by the preview button', () => {
    const blocks = buildPickNotesInputBlocks({ pickNotes: RICH });
    expect(blocks.map(b => b.type)).toEqual(['input', 'actions']);
    expect(blocks[1].elements[0].action_id).toBe('pick_notes_preview');
  });
});

describe('buildPickPreviewView', () => {
  const values = {
    name_block: { name_input: { value: 'Retro' } },
    member_block: { members_select: { selected_users: ['U1', 'U2'] } },
    schedule_tz: { tz_select: { selected_option: { value: 'Australia/Sydney' } } },
    pick_notes: { pick_notes_input: { rich_text_value: RICH } },
  };

  test('renders the unsaved notes as the pick message', () => {
    const { blocks } = buildPickPreviewView(values, 'UVIEWER');
    expect(blocks.find(b => b.type === 'section').text.text).toMatch(/^\*Retro\*: It's your turn, <@U1>!/);
    expect(blocks.find(b => b.type === 'rich_text').elements).toBe(RICH.elements);
  });

  test('pick buttons are inert copies', () => {
    const actions = buildPickPreviewView(values, 'UVIEWER').blocks.find(b => b.type === 'actions');
    expect(actions.elements.map(e => e.action_id)).toEqual(['pick_preview_accept', 'pick_preview_skip']);
    expect(actions.block_id).toBeUndefined();
  });

  test('falls back to the viewer when no members are chosen', () => {
    const { blocks } = buildPickPreviewView({}, 'UVIEWER');
    expect(blocks.find(b => b.type === 'section').text.text).toMatch(/<@UVIEWER>/);
  });
});

describe('readPickNotes', () => {
  test('reads rich text and drops empty editors', () => {
    const values = rt => ({ pick_notes: { pick_notes_input: { rich_text_value: rt } } });
    expect(readPickNotes(values(RICH))).toBe(RICH);
    expect(readPickNotes(values({ type: 'rich_text', elements: [] }))).toBeNull();
  });
});
