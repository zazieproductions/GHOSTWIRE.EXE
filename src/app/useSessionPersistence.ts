import { useEffect } from 'react';
import type { MeasurementSession } from '../types/acoustic';
import {
  STORAGE_KEY_SESSIONS,
  type GhostwireState,
} from './useGhostwireState';

export function restoreSavedSessions(state: GhostwireState): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
    if (!raw) return;
    const parsed = JSON.parse(raw) as MeasurementSession[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      state.setSavedSessions((prev) => (prev.length === 0 ? parsed : prev));
    }
  } catch {
    // ignore malformed storage
  }
}

export function clearStoredSessions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_SESSIONS);
  } catch {
    // ignore
  }
}

function persistSavedSessions(
  persistLocally: boolean,
  savedSessions: MeasurementSession[]
): void {
  if (persistLocally) {
    try {
      localStorage.setItem(
        STORAGE_KEY_SESSIONS,
        JSON.stringify(savedSessions)
      );
    } catch {
      // ignore storage quota errors
    }
  } else {
    try {
      localStorage.removeItem(STORAGE_KEY_SESSIONS);
    } catch {
      // ignore
    }
  }
}

export function useSessionPersistence(state: GhostwireState): void {
  useEffect(() => {
    persistSavedSessions(
      state.settings.persistSessionsLocally,
      state.savedSessions
    );
  }, [state.settings.persistSessionsLocally, state.savedSessions]);
}
