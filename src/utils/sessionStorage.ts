import type { MeasurementSession } from '../types/acoustic';

export const STORAGE_KEY_SESSIONS = 'ghostwire.exe:sessions:v1';
export const STORAGE_KEY_CONSENT = 'ghostwire.exe:sessions:consent:v1';
const STORAGE_SCHEMA_VERSION = 1;

export interface LoadResult {
  sessions: MeasurementSession[];
  error: string | null;
}

export interface WriteResult {
  ok: boolean;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Shallow structural validation of a stored session. Stored data is untrusted
 * input: it may come from a different build, a manual edit or a corrupt write.
 */
export function isMeasurementSession(value: unknown): value is MeasurementSession {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.name !== 'string') return false;
  if (typeof value.startedAtIso !== 'string') return false;
  if (value.sourceMode !== 'idle' && value.sourceMode !== 'microphone' && value.sourceMode !== 'synthetic') {
    return false;
  }
  if (typeof value.durationSec !== 'number' || !Number.isFinite(value.durationSec)) return false;
  if (!Array.isArray(value.samples)) return false;
  if (!isRecord(value.summary)) return false;
  if (typeof value.summary.sampleCount !== 'number') return false;
  if (value.fingerprint !== null && !isRecord(value.fingerprint)) return false;
  return true;
}

/**
 * True only when the user has explicitly opted into local persistence.
 * The marker is what distinguishes "consent" from "no data yet", so a reload
 * with default settings never deletes a previous opt-in.
 */
export function hasPersistenceConsent(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_CONSENT) === String(STORAGE_SCHEMA_VERSION);
  } catch {
    return false;
  }
}

export function grantPersistenceConsent(): WriteResult {
  try {
    localStorage.setItem(STORAGE_KEY_CONSENT, String(STORAGE_SCHEMA_VERSION));
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'Local storage is unavailable in this browser context.' };
  }
}

export function revokePersistenceConsent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_CONSENT);
  } catch {
    // ignore
  }
}

export function loadPersistedSessions(): LoadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
  } catch {
    return {
      sessions: [],
      error: 'Stored sessions could not be read: local storage is unavailable.',
    };
  }

  if (!raw) return { sessions: [], error: null };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        sessions: [],
        error:
          'Stored sessions were not recognised and were left untouched. Clearing session data removes them.',
      };
    }
    const valid = parsed.filter(isMeasurementSession);
    if (valid.length !== parsed.length) {
      return {
        sessions: valid,
        error: `Skipped ${parsed.length - valid.length} malformed stored session(s).`,
      };
    }
    return { sessions: valid, error: null };
  } catch {
    return {
      sessions: [],
      error:
        'Stored sessions could not be parsed and were left untouched. Clearing session data removes them.',
    };
  }
}

export function savePersistedSessions(sessions: MeasurementSession[]): WriteResult {
  try {
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
    return { ok: true, error: null };
  } catch (err) {
    const reason =
      err instanceof DOMException && err.name === 'QuotaExceededError'
        ? 'the browser storage quota is full'
        : 'local storage rejected the write';
    return { ok: false, error: `Session was not saved locally: ${reason}.` };
  }
}

export function clearPersistedSessions(): WriteResult {
  try {
    localStorage.removeItem(STORAGE_KEY_SESSIONS);
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'Stored sessions could not be removed from local storage.' };
  }
}
