import { useAppControls } from './useAppControls';
import { useAudioEngine } from './useAudioEngine';
import { useGhostwireState } from './useGhostwireState';
import { useSessionPersistence } from './useSessionPersistence';

export function useGhostwireController() {
  const state = useGhostwireState();
  useAudioEngine(state);
  useSessionPersistence(state);
  const controls = useAppControls(state);
  return { state, controls };
}
