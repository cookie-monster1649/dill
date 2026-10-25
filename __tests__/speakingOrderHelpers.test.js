// Tests for the speaking-order logic: shuffling, leave filtering,
// ❌ opt-outs (including undo) and the pick window.

const {
  buildSpeakingOrder,
  visibleOrder,
  applyOptOut,
  isWithinPickWindow,
  buildSpeakingOrderBlocks,
  hasSpeakingOrder,
} = require('../src/utils/speakingOrderHelpers');

// ── Speaking order ────────────────────────────────────────────────────────────

describe('buildSpeakingOrder', () => {
  test('includes every available member exactly once', () => {
    const order = buildSpeakingOrder(['U1', 'U2', 'U3', 'U4'], () => false);
    expect([...order].sort()).toEqual(['U1', 'U2', 'U3', 'U4']);
  });

  test('leaves out people on leave', () => {
    const order = buildSpeakingOrder(['U1', 'U2', 'U3'], u => u === 'U2');
    expect(order).not.toContain('U2');
    expect(order).toHaveLength(2);
  });

  test('shuffles using the injected random source', () => {
    // random() → 0 always swaps with index 0, rotating the array
    const order = buildSpeakingOrder(['U1', 'U2', 'U3'], () => false, () => 0);
    expect(order).toEqual(['U2', 'U3', 'U1']);
  });
});

// ── Opt-outs ──────────────────────────────────────────────────────────────────

describe('applyOptOut', () => {
  const list = { ts: '1.1', order: ['U1', 'U2', 'U3'], removed: [] };

  test('removes a person and closes up the numbering', () => {
    const next = applyOptOut(list, 'U2', true);
    expect(visibleOrder(next)).toEqual(['U1', 'U3']);
  });

  test('undo restores the person to their original position', () => {
    const removed = applyOptOut(list, 'U2', true);
    const restored = applyOptOut(removed, 'U2', false);
    expect(visibleOrder(restored)).toEqual(['U1', 'U2', 'U3']);
  });

  test('ignores people who are not on the list', () => {
    expect(applyOptOut(list, 'U9', true)).toBeNull();
  });

  test('returns null when nothing changes', () => {
    expect(applyOptOut(list, 'U1', false)).toBeNull();
  });
});

// ── Pick window ─────────────────────────────────────────────────────────────

describe('isWithinPickWindow', () => {
  test('true the day after the pick', () => {
    expect(isWithinPickWindow('2026-10-27', '2026-10-28')).toBe(true);
  });

  test('false on the off-week', () => {
    expect(isWithinPickWindow('2026-10-27', '2026-11-04')).toBe(false);
  });

  test('false when there has never been a pick', () => {
    expect(isWithinPickWindow(undefined, '2026-10-28')).toBe(false);
  });
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('buildSpeakingOrderBlocks', () => {
  test('renders a numbered list without removed people', () => {
    const blocks = buildSpeakingOrderBlocks('Retro', { order: ['U1', 'U2', 'U3'], removed: ['U1'] });
    expect(blocks[0].text.text).toBe('*Retro* speaking order\n1. <@U2>\n2. <@U3>');
  });
});

describe('hasSpeakingOrder', () => {
  test('only true when explicitly enabled', () => {
    expect(hasSpeakingOrder({ speakingOrder: true })).toBe(true);
    expect(hasSpeakingOrder({})).toBe(false);
    expect(hasSpeakingOrder(null)).toBe(false);
  });
});
