import type {
  AppSettings,
  FrequencyScale,
  MicConstraintPreferences,
  SyntheticSignalConfig,
  TransformConfig,
} from '../types/acoustic';

export interface AppControls {
  updateSettings: (next: AppSettings) => void;
  setFrequencyScale: (scale: FrequencyScale) => void;
  updateMicConstraints: (next: MicConstraintPreferences) => void;
  enableMicrophone: () => void;
  stopCapture: () => void;
  startSynthetic: (cfg?: SyntheticSignalConfig) => void;
  startSyntheticDefault: () => void;
  changeSyntheticConfig: (
    next: SyntheticSignalConfig,
    restartIfRunning?: boolean
  ) => void;
  changeTransform: (next: TransformConfig) => void;
  inspectSupportedOnly: () => void;
  enumerateDevices: () => void;
  startSession: () => void;
  pauseToggle: () => void;
  stopSession: () => void;
  clearAllSessionData: () => void;
  dismissError: () => void;
}
