// Tests for PersistentStorageService utility methods that don't touch Slack.
// No async Slack calls here – these validate the dump/restore/hash logic only.

const PersistentStorageService = require('../src/services/persistentStorageService');
const { getNextOccurrences } = require('../src/utils/dateHelpers');

// ── Shared fixture ────────────────────────────────────────────────────────────

function mockStores() {
  return {
    configStore: {
      data: {
        C1234567890: {
          retro: { schedule: '0 10 * * 1', timezone: 'Australia/Sydney' },
          sweep: { schedule: '0 11 * * 1,2,3,4,5', timezone: 'Australia/Sydney' },
        },
        C0987654321: {
          next: { schedule: '0 2 * * 1,2,3,4,5', timezone: 'America/New_York' },
        },
      },
    },
    queueStore: {
      data: {
        C1234567890: {
          retro: [{ user: 'U1', isSkipped: false, lastAcceptedDate: null }],
          sweep: [{ user: 'U2', isSkipped: false, lastAcceptedDate: null }],
        },
      },
    },
    stateStore: { data: {} },
    analyticsService: {
      analyticsStore: {
        data: {
          events: {
            '2024-01-15': [{ type: 'pick', user: 'U1', rotation: 'retro' }],
            '2024-01-16': [{ type: 'pick', user: 'U2', rotation: 'sweep' }],
          },
        },
      },
    },
    leaveStore: { data: {} },
  };
}

// ── Backup utilities ──────────────────────────────────────────────────────────

describe('PersistentStorageService – dump and restore utilities', () => {
  let service;

  beforeEach(() => {
    // Passing null as the Slack client is fine – these tests never call Slack
    service = new PersistentStorageService(null, 'C1234567890', mockStores(), {});
  });

  test('createDatabaseDump includes all stores', () => {
    const dump = service.createDatabaseDump();
    expect(dump.data.configs).toBeDefined();
    expect(dump.data.rotations).toBeDefined();
    expect(dump.data.activestate).toBeDefined();
    expect(dump.data.analytics).toBeDefined();
    expect(dump.data.leave).toBeDefined();
  });

  test('createCompactBackup stays within Slack block limit', () => {
    const dump = service.createDatabaseDump();
    const compact = service.createCompactBackup(dump);
    expect(typeof compact).toBe('string');
    expect(compact.length).toBeLessThanOrEqual(3000);
  });

  test('createDataHash returns a stable hex string for the same input', () => {
    const dump = service.createDatabaseDump();
    const hash1 = service.createDataHash(dump.data);
    const hash2 = service.createDataHash(dump.data);
    expect(typeof hash1).toBe('string');
    expect(hash1.length).toBeGreaterThan(0);
    expect(hash1).toBe(hash2);
  });

  test('extractBackupInfo returns null for a message without backup blocks', () => {
    expect(service.extractBackupInfo({ blocks: [] })).toBeNull();
    expect(service.extractBackupInfo({ blocks: [{ type: 'divider' }] })).toBeNull();
  });
});

// ── getNextOccurrences ────────────────────────────────────────────────────────

describe('getNextOccurrences', () => {
  test('returns the correct next N pick dates from a mid-week anchor', () => {
    const cfg = {
      days: ['mon', 'wed', 'fri'],
      time: '09:00',
      tz: 'Etc/GMT',
      startDate: '2025-07-21T00:00:00.000Z',
    };
    // Anchor is a Tuesday – first pick should be Wednesday
    const anchor = new Date('2025-07-22T00:00:00.000Z');
    const picks = getNextOccurrences(cfg, 3, anchor);

    expect(picks).toHaveLength(3);
    expect(picks[0].toISOString().startsWith('2025-07-23')).toBe(true); // Wed
    expect(picks[1].toISOString().startsWith('2025-07-25')).toBe(true); // Fri
    expect(picks[2].toISOString().startsWith('2025-07-28')).toBe(true); // Mon
  });

  test('returns empty array for an invalid config', () => {
    expect(getNextOccurrences({}, 3, new Date())).toEqual([]);
    expect(getNextOccurrences({ days: [], time: '09:00', tz: 'UTC' }, 3, new Date())).toEqual([]);
  });
});
