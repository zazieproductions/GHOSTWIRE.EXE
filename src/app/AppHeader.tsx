import type { InputMode, NavTab } from '../types/acoustic';
import type { AppControls } from './types';
import type { GhostwireState } from './useGhostwireState';
import { NAV_TABS } from './useGhostwireState';

interface ModeStatus {
  label: string;
  className: string;
  dotClassName: string;
}

const MODE_STATUSES: Record<InputMode, ModeStatus> = {
  microphone: {
    label: 'MIC ACTIVE',
    className:
      'flex items-center gap-2 px-3 py-1.5 rounded-sm bg-[#2a0c0c] border border-[#ef4444] text-[#fecaca] text-xs font-bold tracking-wider',
    dotClassName: 'w-2 h-2 rounded-full bg-[#ef4444] animate-pulse',
  },
  synthetic: {
    label: 'SYNTHETIC SIGNAL ACTIVE',
    className:
      'flex items-center gap-2 px-3 py-1.5 rounded-sm bg-[#0b2316] border border-[#22c55e] text-[#86efac] text-xs font-bold tracking-wider',
    dotClassName: 'w-2 h-2 rounded-full bg-[#4ade80]',
  },
  idle: {
    label: 'IDLE // NO CAPTURE',
    className:
      'flex items-center gap-2 px-3 py-1.5 rounded-sm bg-[#0e1418] border border-[#24322a] text-[#7a9384] text-xs font-semibold tracking-wider',
    dotClassName: 'w-2 h-2 rounded-full bg-[#4b5e52]',
  },
};

function CaptureStatus({ mode }: { mode: InputMode }) {
  const status = MODE_STATUSES[mode];
  return (
    <div role="status" className={status.className}>
      <span className={status.dotClassName} />
      {status.label}
    </div>
  );
}

function MicrophoneButton({
  mode,
  controls,
}: {
  mode: InputMode;
  controls: AppControls;
}) {
  return mode === 'microphone' ? (
    <button
      type="button"
      onClick={controls.stopCapture}
      className="px-3 py-1.5 text-xs font-bold rounded-sm bg-[#991b1b] hover:bg-[#b91c1c] text-white border border-[#f87171] cursor-pointer"
    >
      STOP MICROPHONE
    </button>
  ) : (
    <button
      type="button"
      onClick={controls.enableMicrophone}
      className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#14532d] hover:bg-[#166534] text-[#bbf7d0] border border-[#22c55e]/60 cursor-pointer"
    >
      ENABLE MICROPHONE
    </button>
  );
}

function SyntheticStopButton({
  mode,
  controls,
}: {
  mode: InputMode;
  controls: AppControls;
}) {
  return (
    <>
      {mode === 'synthetic' && (
        <button
          type="button"
          onClick={controls.stopCapture}
          className="px-2.5 py-1.5 text-xs font-semibold rounded-sm bg-[#78350f] hover:bg-[#92400e] text-[#fde68a] border border-[#f59e0b]/60 cursor-pointer"
        >
          STOP SYNTHETIC
        </button>
      )}
    </>
  );
}

function PrimaryNavigation({
  activeTab,
  onSelect,
}: {
  activeTab: NavTab;
  onSelect: (tab: NavTab) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {NAV_TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={`px-3 py-1.5 text-[11px] font-bold tracking-wider rounded-xs border transition-colors cursor-pointer ${
              active
                ? 'border-[#22c55e] bg-[#11271a] text-[#86efac]'
                : 'border-[#18241d] bg-[#0b1013] text-[#7a9384] hover:text-[#c8d6cc] hover:border-[#293d31]'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function AppHeader({
  state,
  controls,
}: {
  state: GhostwireState;
  controls: AppControls;
}) {
  return (
    <header className="border-b border-[#1b2821] bg-[#0a0f12] px-4 py-2.5">
      <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-7 bg-[#22c55e] rounded-xs" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-widest text-[#86efac] phosphor-glow">
                GHOSTWIRE.EXE
              </h1>
              <span className="text-[10px] px-1.5 py-0.5 border border-[#1f3428] bg-[#0d1912] text-[#6ee7b7] rounded-xs">
                CLIENT-SIDE DSP LAB
              </span>
            </div>
            <p className="text-[11px] text-[#7a9384]">
              Your microphone reveals more than your words.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <CaptureStatus mode={state.mode} />
          <MicrophoneButton mode={state.mode} controls={controls} />
          <SyntheticStopButton mode={state.mode} controls={controls} />
        </div>
      </div>

      <nav
        aria-label="Primary research navigation"
        className="max-w-[1440px] mx-auto mt-2.5 pt-2 border-t border-[#15201a] flex flex-wrap items-center justify-between gap-2"
      >
        <PrimaryNavigation
          activeTab={state.activeTab}
          onSelect={state.setActiveTab}
        />
        <div className="text-[10px] text-[#5e7a68]">
          Browser &amp; OS mic indicators remain authoritative | Zero telemetry / Zero uploads
        </div>
      </nav>
    </header>
  );
}
