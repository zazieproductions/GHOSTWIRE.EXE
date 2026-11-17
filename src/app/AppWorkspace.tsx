import type { ComponentType } from 'react';
import type { NavTab } from '../types/acoustic';
import { ExposureLabView } from '../components/views/ExposureLabView';
import { LiveMonitorView } from '../components/views/LiveMonitorView';
import { ResearchNotesView } from '../components/views/ResearchNotesView';
import { SessionAnalysisView } from '../components/views/SessionAnalysisView';
import { SettingsView } from '../components/views/SettingsView';
import { SyntheticSignalsView } from '../components/views/SyntheticSignalsView';
import type { AppControls } from './types';
import type { GhostwireState } from './useGhostwireState';

interface WorkspaceProps {
  state: GhostwireState;
  controls: AppControls;
}

function LiveWorkspace({ state, controls }: WorkspaceProps) {
  return (
    <LiveMonitorView
      mode={state.mode}
      frame={state.latestFrame}
      postFrame={state.transformConfig.enabled ? state.postFrame : null}
      activity={state.activity}
      frequencyScale={state.settings.frequencyScale}
      onFrequencyScaleChange={controls.setFrequencyScale}
      onEnableMicrophone={controls.enableMicrophone}
      onStopCapture={controls.stopCapture}
      onStartSyntheticDefault={controls.startSyntheticDefault}
    />
  );
}

function LabWorkspace({ state, controls }: WorkspaceProps) {
  return (
    <ExposureLabView
      activeExperiment={state.activeExperiment}
      onSelectExperiment={state.setActiveExperiment}
      mode={state.mode}
      latestFrame={state.latestFrame}
      postFrame={state.postFrame}
      recentFrames={state.recentFramesRef.current}
      activity={state.activity}
      metadata={state.metadata}
      micConstraints={state.settings.micConstraints}
      transformConfig={state.transformConfig}
      frequencyScale={state.settings.frequencyScale}
      onUpdateMicConstraints={controls.updateMicConstraints}
      onInspectSupportedOnly={controls.inspectSupportedOnly}
      onEnumerateDevices={controls.enumerateDevices}
      onEnableMicrophone={controls.enableMicrophone}
      onStopCapture={controls.stopCapture}
      onChangeTransform={controls.changeTransform}
    />
  );
}

function SyntheticWorkspace({ state, controls }: WorkspaceProps) {
  return (
    <SyntheticSignalsView
      mode={state.mode}
      config={state.syntheticConfig}
      frame={state.latestFrame}
      frequencyScale={state.settings.frequencyScale}
      onChangeConfig={controls.changeSyntheticConfig}
      onStartSynthetic={controls.startSynthetic}
      onStopCapture={controls.stopCapture}
    />
  );
}

function SessionsWorkspace({ state, controls }: WorkspaceProps) {
  return (
    <SessionAnalysisView
      mode={state.mode}
      recordingState={state.recordingState}
      activeSessionName={state.activeSessionName}
      activeSessionDurationSec={state.activeSessionDurationSec}
      activeSamples={state.activeSamples}
      savedSessions={state.savedSessions}
      persistLocally={state.settings.persistSessionsLocally}
      onChangeSessionName={state.setActiveSessionName}
      onStartSession={controls.startSession}
      onPauseToggle={controls.pauseToggle}
      onStopSession={controls.stopSession}
      onClearAllSessions={controls.clearAllSessionData}
    />
  );
}

function NotesWorkspace() {
  return <ResearchNotesView />;
}

function SettingsWorkspace({ state, controls }: WorkspaceProps) {
  return (
    <SettingsView
      settings={state.settings}
      onUpdateSettings={controls.updateSettings}
      onClearAllSessionData={controls.clearAllSessionData}
    />
  );
}

const WORKSPACE_VIEWS: Record<NavTab, ComponentType<WorkspaceProps>> = {
  live: LiveWorkspace,
  lab: LabWorkspace,
  synthetic: SyntheticWorkspace,
  sessions: SessionsWorkspace,
  notes: NotesWorkspace,
  settings: SettingsWorkspace,
};

export function AppWorkspace({ state, controls }: WorkspaceProps) {
  const ActiveView = WORKSPACE_VIEWS[state.activeTab];
  return (
    <main className="flex-1 max-w-[1440px] w-full mx-auto p-4">
      <ActiveView state={state} controls={controls} />
    </main>
  );
}
