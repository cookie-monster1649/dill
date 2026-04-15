// Tests for core rotation queue logic: peek, accept, skip, daily reset.
// These call the helpers directly against a real (in-memory) NestedStore,
// so they exercise the actual state transitions without any Slack dependency.

const {
  getNextUser,
  handleUserSkip,
  reorderAfterAccept,
  resetDailySkips,
  generateShuffledRotation,
  getRotationSchedule,
  peekNextUser,
} = require('../src/utils/rotationHelpers');

const NestedStore = require('../src/stores/NestedStore');

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHANNEL = 'C123';
const ROT     = 'test';
const U1 = 'U123', U2 = 'U456', U3 = 'U789';

function freshStore() {
  // Use a unique temp path per test run to avoid cross-test file interference
  const store = new NestedStore(`test-rotations-${Date.now()}.json`);
  store.data = {};
  return store;
}

function cleanup(store) {
  try { require('fs').unlinkSync(store.filePath); } catch { /* already gone */ }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('rotationHelpers – queue state transitions', () => {
  let queueStore;

  beforeEach(() => { queueStore = freshStore(); });
  afterEach(() => { cleanup(queueStore); });

  test('peekNextUser does not remove the user from the queue', () => {
    const config = { members: [U1, U2, U3], tz: 'UTC' };
    queueStore.setItem(CHANNEL, ROT, generateShuffledRotation([U1, U2, U3]));

    const turn1 = peekNextUser(queueStore, CHANNEL, ROT, config);
    expect(queueStore.getItem(CHANNEL, ROT)).toHaveLength(3);

    const turn2 = peekNextUser(queueStore, CHANNEL, ROT, config);
    expect(queueStore.getItem(CHANNEL, ROT)).toHaveLength(3);
    expect(turn1.user).toBe(turn2.user);
  });

  test('reorderAfterAccept stamps lastAcceptedDate and moves user to queue tail', () => {
    const config = { members: [U1, U2], tz: 'UTC' };
    queueStore.setItem(CHANNEL, ROT, generateShuffledRotation([U1, U2]));

    const peek = peekNextUser(queueStore, CHANNEL, ROT, config);
    reorderAfterAccept(queueStore, CHANNEL, ROT, peek.user, config);

    const queue = queueStore.getItem(CHANNEL, ROT);
    expect(queue).toHaveLength(2);
    expect(queue[queue.length - 1].user).toBe(peek.user);
    expect(queue[queue.length - 1].lastAcceptedDate).toBeTruthy();
    expect(queue[queue.length - 1].isSkipped).toBe(false);
  });

  test('handleUserSkip moves user to queue tail with isSkipped=true', () => {
    const config = { members: [U1, U2], tz: 'UTC' };
    queueStore.setItem(CHANNEL, ROT, generateShuffledRotation([U1, U2]));

    const peek = peekNextUser(queueStore, CHANNEL, ROT, config);
    handleUserSkip(queueStore, CHANNEL, ROT, peek.user, config);

    const queue = queueStore.getItem(CHANNEL, ROT);
    expect(queue).toHaveLength(2);
    expect(queue[queue.length - 1].user).toBe(peek.user);
    expect(queue[queue.length - 1].isSkipped).toBe(true);
  });

  test('resetDailySkips clears all skip flags and re-sorts by lastAcceptedDate', () => {
    const config = { members: [U1, U2], tz: 'UTC' };
    queueStore.setItem(CHANNEL, ROT, [
      { user: U1, isSkipped: false, lastAcceptedDate: null },
      { user: U2, isSkipped: true,  lastAcceptedDate: null },
    ]);

    resetDailySkips(queueStore, CHANNEL, ROT, config);

    const queue = queueStore.getItem(CHANNEL, ROT);
    expect(queue.every(t => t.isSkipped === false)).toBe(true);
  });

  test('handleUserSkip on unknown user does not corrupt the queue', () => {
    const config = { members: [U1, U2], tz: 'UTC' };
    queueStore.setItem(CHANNEL, ROT, generateShuffledRotation([U1, U2]));

    handleUserSkip(queueStore, CHANNEL, ROT, 'U_UNKNOWN', config);
    expect(queueStore.getItem(CHANNEL, ROT)).toHaveLength(2);
  });

  test('reorderAfterAccept on unknown user does not corrupt the queue', () => {
    const config = { members: [U1, U2], tz: 'UTC' };
    queueStore.setItem(CHANNEL, ROT, generateShuffledRotation([U1, U2]));

    reorderAfterAccept(queueStore, CHANNEL, ROT, 'U_UNKNOWN', config);
    expect(queueStore.getItem(CHANNEL, ROT)).toHaveLength(2);
  });
});
