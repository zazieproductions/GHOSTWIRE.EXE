import { useEffect } from 'react';
import {
  clearPersistedSessions,
  grantPersistenceConsent,
  hasPersistenceConsent,
  loadPersistedSessions,
  revokePersistenceConsent,
  savePersistedSessions,
} from '../utils/sessionStorage';
import type { GhostwireState } from './useGhostwireState';

/**
 * Restore opted-in sessions from localStorage, if any. Never overwrites
 * sessions that are already loaded, and never enables writes over data that
 * could not be read — a corrupt or future-version payload is reported and
 * left untouched.
 */
function restoreSavedSessions(state: GhostwireState): void {
  const { sessions, error } = loadPersistedSessions();
  if (error) {
    state.setErrorBanner(error);
    return;
  }
  if (sessions.length > 0) {
    state.setSavedSessions((prev) => (prev.length === 0 ? sessions : prev));
  }
}

/**
 * Opt in to persistence: write the consent marker first, then restore.
 * Returns false when consent could not be recorded so callers can surface it.
 */
export function enablePersistence(state: GhostwireState): boolean {
  const consent = grantPersistenceConsent();
  if (!consent.ok) {
    state.setErrorBanner(consent.error);
    return false;
  }
  restoreSavedSessions(state);
  return true;
}

/** Intentional opt-out: the only non-explicit-clear path that deletes data. */
export function disablePersistence(state: GhostwireState): void {
  revokePersistenceConsent();
  const cleared = clearPersistedSessions();
  if (!cleared.ok) state.setErrorBanner(cleared.error);
}

/** "Clear All Session Data": wipes in-memory drafts and all stored data. */
export function clearStoredSessions(state: GhostwireState): void {
  revokePersistenceConsent();
  const cleared = clearPersistedSessions();
  if (!cleared.ok) state.setErrorBanner(cleared.error);
}

export function useSessionPersistence(state: GhostwireState): void {
  // Restore a previous explicit opt-in on mount. A stored consent marker — not
  // the default settings value — decides whether saved sessions are restored,
  // so a reload can never delete data the user chose to keep.
  useEffect(() => {
    if (!hasPersistenceConsent()) return;
    const { sessions, error } = loadPersistedSessions();
    if (error) {
      // Never auto-enable writes over data that could not be read: that would
      // replace a future-version or corrupt payload with an empty list.
      state.setErrorBanner(error);
      return;
    }
    state.setSettings((prev) => ({ ...prev, persistSessionsLocally: true }));
    if (sessions.length > 0) {
      state.setSavedSessions((prev) => (prev.length === 0 ? sessions : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistEnabled = state.settings.persistSessionsLocally;
  const savedSessions = state.savedSessions;
  const setErrorBanner = state.setErrorBanner;

  // Write only while persistence is explicitly enabled. Deleting stored data is
  // reserved for an intentional opt-out or "Clear All Session Data".
  useEffect(() => {
    if (!persistEnabled) return;
    const result = savePersistedSessions(savedSessions);
    if (!result.ok) setErrorBanner(result.error);
  }, [persistEnabled, savedSessions, setErrorBanner]);
}
