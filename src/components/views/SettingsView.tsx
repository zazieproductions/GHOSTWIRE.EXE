import type { AppSettings, FftSize, FrequencyScale } from '../../types/acoustic';

interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  onClearAllSessionData: () => void;
}

export function SettingsView({
  settings,
  onUpdateSettings,
  onClearAllSessionData,
}: SettingsViewProps) {
  const update = (patch: Partial<AppSettings>) => {
    onUpdateSettings({ ...settings, ...patch });
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="panel-border rounded-sm p-3">
        <div className="text-xs font-semibold text-[#86efac] tracking-wider">
          INSTRUMENTATION &amp; PRIVACY SETTINGS
        </div>
        <div className="text-[11px] text-[#7a9384] mt-0.5">
          Configure FFT resolution, spectral smoothing, detection thresholds, and local persistence policy.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* DSP Engine Settings */}
        <div className="panel-border rounded-sm p-3.5 space-y-3">
          <div className="font-semibold text-[#4ade80] tracking-wider">
            DSP ENGINE PARAMETERS
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-[#7a9384]">
              FFT Window Size (samples)
            </span>
            <select
              value={settings.fftSize}
              onChange={(e) =>
                update({ fftSize: Number(e.target.value) as FftSize })
              }
              className="w-full bg-[#06090b] border border-[#1f2e25] px-2.5 py-1.5 rounded-xs text-xs text-[#e2efe6]"
            >
              {[1024, 2048, 4096, 8192].map((sz) => (
                <option key={sz} value={sz}>
                  {sz} samples (Δf ≈ {(48000 / sz).toFixed(1)} Hz @ 48 kHz)
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-[#7a9384]">Spectral EMA Smoothing</span>
              <span className="tabular-nums">
                {settings.smoothingTimeConstant.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={0.85}
              step={0.05}
              value={settings.smoothingTimeConstant}
              onChange={(e) =>
                update({ smoothingTimeConstant: Number(e.target.value) })
              }
              className="w-full"
            />
          </label>

          <label className="block space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-[#7a9384]">Activity Threshold (dBFS)</span>
              <span className="tabular-nums">
                {settings.activityThresholdDbfs} dBFS
              </span>
            </div>
            <input
              type="range"
              min={-80}
              max={-15}
              step={1}
              value={settings.activityThresholdDbfs}
              onChange={(e) =>
                update({ activityThresholdDbfs: Number(e.target.value) })
              }
              className="w-full"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] text-[#7a9384]">
              Default Spectrum Frequency Scale
            </span>
            <select
              value={settings.frequencyScale}
              onChange={(e) =>
                update({ frequencyScale: e.target.value as FrequencyScale })
              }
              className="w-full bg-[#06090b] border border-[#1f2e25] px-2.5 py-1.5 rounded-xs text-xs text-[#e2efe6]"
            >
              <option value="log">Logarithmic (20 Hz – Nyquist)</option>
              <option value="linear">Linear (0 Hz – Nyquist)</option>
            </select>
          </label>
        </div>

        {/* Privacy & Persistence */}
        <div className="panel-border rounded-sm p-3.5 space-y-3">
          <div className="font-semibold text-[#fbbf24] tracking-wider">
            DATA RETENTION &amp; MICROPHONE CONSTRAINTS
          </div>

          <label className="flex items-start gap-2.5 p-2.5 border border-[#1f2e25] bg-[#080c0f] rounded-xs cursor-pointer">
            <input
              type="checkbox"
              checked={settings.persistSessionsLocally}
              onChange={(e) =>
                update({ persistSessionsLocally: e.target.checked })
              }
              className="mt-0.5"
            />
            <div>
              <div className="font-semibold text-[#e2efe6]">
                Opt-in: Persist numerical sessions in browser localStorage
              </div>
              <div className="text-[11px] text-[#7a9384]">
                OFF by default. Checking this stores numerical feature sessions only (never raw audio) and keeps them across reloads. Unchecking is an explicit opt-out and deletes the stored sessions.
              </div>
            </div>
          </label>

          <div className="space-y-1.5 pt-1">
            <div className="text-[11px] font-semibold text-[#86efac]">
              Requested Microphone Processing Constraints
            </div>
            {(
              [
                ['echoCancellation', 'Request echoCancellation'],
                ['noiseSuppression', 'Request noiseSuppression'],
                ['autoGainControl', 'Request autoGainControl'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer text-[11px]">
                <input
                  type="checkbox"
                  checked={settings.micConstraints[key]}
                  onChange={(e) =>
                    update({
                      micConstraints: {
                        ...settings.micConstraints,
                        [key]: e.target.checked,
                      },
                    })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
            <div className="text-[10px] text-[#6e8a78]">
              Disabling browser noiseSuppression and autoGainControl gives cleaner raw acoustics for research, though browsers/hardware may still apply processing.
            </div>
          </div>

          <div className="pt-2 border-t border-[#18231d]">
            <button
              type="button"
              onClick={onClearAllSessionData}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#3b1212] hover:bg-[#571818] text-[#fecaca] border border-[#ef4444]/50 cursor-pointer"
            >
              CLEAR ALL SESSION DATA &amp; STORAGE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
