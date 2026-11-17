import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEY_CONSENT,
  STORAGE_KEY_SESSIONS,
  clearPersistedSessions,
  grantPersistenceConsent,
  hasPersistenceConsent,
  loadPersistedSessions,
  revokePersistenceConsent,
  savePersistedSessions,
} from '../sessionStorage';
import { buildMeasurementSession } from '../exportSession';

function sampleSession() {
  return buildMeasurementSession({
    id: 'sess-unit',
    name: 'Unit Session',
    startedAtIso: '2026-11-17T00:00:00.000Z',
    endedAtIso: null,
    durationSec: 1,
    sourceMode: 'synthetic',
    sampleRate: 48000,
    fftSize: 2048,
    samples: [],
  });
}

describe('Session persistence lifecycle (audit F3)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips sessions and treats a missing consent marker as opt-out', () => {
    expect(hasPersistenceConsent()).toBe(false);
    savePersistedSessions([sampleSession()]);

    const loaded = loadPersistedSessions();
    expect(loaded.error).toBeNull();
    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.sessions[0].id).toBe('sess-unit');

    expect(grantPersistenceConsent().ok).toBe(true);
    expect(hasPersistenceConsent()).toBe(true);
    revokePersistenceConsent();
    expect(hasPersistenceConsent()).toBe(false);
  });

  it('reports a quota failure instead of silently dropping the write', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

    const result = savePersistedSessions([sampleSession()]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/quota is full/i);

    spy.mockRestore();
  });

  it('leaves unparseable data in place and reports it', () => {
    localStorage.setItem(STORAGE_KEY_SESSIONS, '{broken');
    const loaded = loadPersistedSessions();
    expect(loaded.sessions).toEqual([]);
    expect(loaded.error).toMatch(/could not be parsed/i);
    expect(localStorage.getItem(STORAGE_KEY_SESSIONS)).toBe('{broken');
  });

  it('drops malformed entries but keeps valid ones', () => {
    const valid = sampleSession();
    localStorage.setItem(
      STORAGE_KEY_SESSIONS,
      JSON.stringify([valid, { id: 'bad', name: 5 }])
    );
    const loaded = loadPersistedSessions();
    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.sessions[0].id).toBe('sess-unit');
    expect(loaded.error).toMatch(/skipped 1 malformed/i);
  });

  it('clears storage and consent only when explicitly asked', () => {
    localStorage.setItem(STORAGE_KEY_SESSIONS, '[]');
    localStorage.setItem(STORAGE_KEY_CONSENT, '1');

    expect(clearPersistedSessions().ok).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY_SESSIONS)).toBeNull();

    revokePersistenceConsent();
    expect(localStorage.getItem(STORAGE_KEY_CONSENT)).toBeNull();
  });
});
