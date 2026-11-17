import { EXPERIMENT_PROTOCOLS } from '../../data/protocols';
import type {
  DeviceMetadataSnapshot,
  InputMode,
  MicConstraintPreferences,
} from '../../types/acoustic';
import { ProtocolCard } from '../common/ProtocolCard';

interface ExperimentCProps {
  mode: InputMode;
  metadata: DeviceMetadataSnapshot;
  micConstraints: MicConstraintPreferences;
  onUpdateMicConstraints: (next: MicConstraintPreferences) => void;
  onInspectSupportedOnly: () => void;
  onEnumerateDevices: () => void;
  onEnableMicrophone: () => void;
  onStopCapture: () => void;
}

type ConstraintKey = keyof MicConstraintPreferences;

interface ComparisonRow {
  param: string;
  req: string;
  act: string;
}

const CONSTRAINT_LABELS: Array<{ key: ConstraintKey; label: string }> = [
  { key: 'echoCancellation', label: 'Echo Cancellation' },
  { key: 'noiseSuppression', label: 'Noise Suppression' },
  { key: 'autoGainControl', label: 'Automatic Gain Control (AGC)' },
];

function formatRequestedConstraint(
  key: ConstraintKey,
  requested: MediaTrackConstraints | null,
  fallback: MicConstraintPreferences
): string {
  return String(requested ? requested[key] : fallback[key]);
}

function formatActualConstraint(
  key: ConstraintKey,
  actual: MediaTrackSettings | null
): string {
  return actual
    ? String(actual[key] ?? 'unsupported/hidden')
    : '— (no active track)';
}

function formatOptionalNumber(
  value: number | string | undefined,
  suffix = ''
): string {
  return value ? `${value}${suffix}` : '—';
}

function buildComparisonRows(
  metadata: DeviceMetadataSnapshot,
  micConstraints: MicConstraintPreferences
): ComparisonRow[] {
  const actual = metadata.actualSettings;
  const requested = metadata.requestedConstraints;
  return [
    {
      param: 'echoCancellation',
      req: formatRequestedConstraint('echoCancellation', requested, micConstraints),
      act: formatActualConstraint('echoCancellation', actual),
    },
    {
      param: 'noiseSuppression',
      req: formatRequestedConstraint('noiseSuppression', requested, micConstraints),
      act: formatActualConstraint('noiseSuppression', actual),
    },
    {
      param: 'autoGainControl',
      req: formatRequestedConstraint('autoGainControl', requested, micConstraints),
      act: formatActualConstraint('autoGainControl', actual),
    },
    {
      param: 'sampleRate',
      req: 'browser/OS default',
      act: formatOptionalNumber(actual?.sampleRate, ' Hz'),
    },
    {
      param: 'channelCount',
      req: 'browser/OS default',
      act: formatOptionalNumber(actual?.channelCount),
    },
    {
      param: 'deviceId (track)',
      req: 'default',
      act: formatOptionalNumber(actual?.deviceId),
    },
  ];
}

function buildLiveObservations(metadata: DeviceMetadataSnapshot): string[] {
  const actual = metadata.actualSettings;
  const activeTrack = actual
    ? `Active track settings: ${actual.sampleRate ?? '?'} Hz, ${actual.channelCount ?? '?'} ch, EC=${String(actual.echoCancellation)}, NS=${String(actual.noiseSuppression)}, AGC=${String(actual.autoGainControl)}`
    : 'No active microphone track open.';
  return [
    `Permission state: ${metadata.permissionState.toUpperCase()}`,
    `Enumeration triggered by user: ${metadata.enumerationTriggered ? 'YES' : 'NO (suppressed until click)'}`,
    `Visible audio devices: ${metadata.devices.length} (${metadata.devices.filter((d) => !d.labelRedacted).length} with unredacted labels)`,
    activeTrack,
  ];
}

function MicrophoneActionButton({
  mode,
  onEnableMicrophone,
  onStopCapture,
}: Pick<
  ExperimentCProps,
  'mode' | 'onEnableMicrophone' | 'onStopCapture'
>) {
  return mode !== 'microphone' ? (
    <button
      type="button"
      onClick={onEnableMicrophone}
      className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#14532d] hover:bg-[#166534] text-[#bbf7d0] border border-[#22c55e]/50 cursor-pointer"
    >
      ENABLE MICROPHONE
    </button>
  ) : (
    <button
      type="button"
      onClick={onStopCapture}
      className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#7f1d1d] hover:bg-[#991b1b] text-[#fecaca] border border-[#ef4444]/60 cursor-pointer"
    >
      STOP MICROPHONE
    </button>
  );
}

function ExperimentCHeader({
  mode,
  onInspectSupportedOnly,
  onEnumerateDevices,
  onEnableMicrophone,
  onStopCapture,
}: Pick<
  ExperimentCProps,
  | 'mode'
  | 'onInspectSupportedOnly'
  | 'onEnumerateDevices'
  | 'onEnableMicrophone'
  | 'onStopCapture'
>) {
  return (
    <div className="panel-border rounded-sm p-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-xs font-semibold text-[#86efac] tracking-wider">
          EXPERIMENT C // MICROPHONE METADATA &amp; CAPABILITY LEAKAGE
        </div>
        <div className="text-[11px] text-[#7a9384]">
          Inspect what MediaDevices APIs expose before and after permission. No automatic device enumeration occurs on load.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onInspectSupportedOnly}
          className="px-2.5 py-1.5 text-xs rounded-sm bg-[#10181d] hover:bg-[#17232b] text-[#c5d4ca] border border-[#24322a] cursor-pointer"
        >
          INSPECT SUPPORTED CONSTRAINTS
        </button>
        <button
          type="button"
          onClick={onEnumerateDevices}
          className="px-2.5 py-1.5 text-xs rounded-sm bg-[#2b200b] hover:bg-[#3f2e10] text-[#fcd34d] border border-[#f59e0b]/50 cursor-pointer"
        >
          ENUMERATE DEVICES
        </button>
        <MicrophoneActionButton
          mode={mode}
          onEnableMicrophone={onEnableMicrophone}
          onStopCapture={onStopCapture}
        />
      </div>
    </div>
  );
}

function ConstraintToggles({
  micConstraints,
  onUpdateMicConstraints,
}: Pick<ExperimentCProps, 'micConstraints' | 'onUpdateMicConstraints'>) {
  return (
    <div className="panel-border rounded-sm p-3 space-y-2">
      <div className="text-xs font-semibold text-[#86efac] tracking-wider">
        REQUESTED AUDIO CONSTRAINTS (PASSED TO getUserMedia)
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        {CONSTRAINT_LABELS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={micConstraints[key]}
              onChange={(e) =>
                onUpdateMicConstraints({
                  ...micConstraints,
                  [key]: e.target.checked,
                })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div className="text-[11px] text-[#6e8a78]">
        Note: Changing constraints takes effect on the next Enable Microphone request; browsers and OS drivers may override requested flags.
      </div>
    </div>
  );
}

function ConstraintTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <div className="panel-border rounded-sm overflow-hidden">
      <div className="panel-header px-3 py-1.5 text-[11px] font-semibold text-[#86efac]">
        REQUESTED CONSTRAINTS VS ACTUAL TRACK SETTINGS
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[#18231d] text-[#6e8a78] text-[11px]">
            <th className="text-left px-3 py-1.5">Parameter</th>
            <th className="text-left px-3 py-1.5">Requested</th>
            <th className="text-left px-3 py-1.5">Actual (getSettings)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.param} className="border-b border-[#121c16] text-[11px]">
              <td className="px-3 py-1.5 text-[#86efac]">{row.param}</td>
              <td className="px-3 py-1.5 text-[#a5baad]">{row.req}</td>
              <td className="px-3 py-1.5 text-[#e2efe6] break-all">{row.act}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeviceList({ metadata }: { metadata: DeviceMetadataSnapshot }) {
  return (
    <div className="panel-border rounded-sm overflow-hidden">
      <div className="panel-header px-3 py-1.5 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-[#86efac]">
          ENUMERATED AUDIO DEVICES
        </span>
        <span className="text-[#6e8a78]">
          {metadata.enumerationTriggered ? 'Enumerated' : 'Not yet enumerated'}
        </span>
      </div>
      <div className="p-3 text-[11px] space-y-2 max-h-64 overflow-y-auto">
        {!metadata.enumerationTriggered ? (
          <div className="text-[#6e8a78]">
            Click &ldquo;Enumerate Devices&rdquo; to query <code>navigator.mediaDevices.enumerateDevices()</code>. Prior to microphone permission, modern browsers redact device labels and rotate or suppress IDs.
          </div>
        ) : metadata.devices.length === 0 ? (
          <div className="text-[#fbbf24]">No audioinput/audiooutput devices returned by browser.</div>
        ) : (
          metadata.devices.map((d, idx) => (
            <div
              key={`${d.kind}-${idx}`}
              className="border border-[#18241d] bg-[#080c0f] p-2 rounded-xs space-y-0.5"
            >
              <div className="flex justify-between">
                <span className="text-[#4ade80] font-semibold">{d.kind}</span>
                <span
                  className={
                    d.labelRedacted ? 'text-[#fbbf24]' : 'text-[#86efac]'
                  }
                >
                  {d.labelRedacted ? 'LABEL REDACTED' : 'LABEL EXPOSED'}
                </span>
              </div>
              <div className="text-[#e2efe6]">Label: {d.label}</div>
              <div className="text-[#6e8a78] break-all">deviceId: {d.deviceId}</div>
              <div className="text-[#6e8a78] break-all">groupId: {d.groupId}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CapabilitiesPanel({ metadata }: { metadata: DeviceMetadataSnapshot }) {
  return (
    <>
      <div className="panel-border rounded-sm p-3 text-[11px] space-y-1.5">
        <div className="text-xs font-semibold text-[#86efac]">
          BROWSER SUPPORTED CONSTRAINTS ({metadata.supportedConstraints.length})
        </div>
        {metadata.supportedConstraints.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {metadata.supportedConstraints.map((c) => (
              <span
                key={c}
                className="px-1.5 py-0.5 bg-[#0f171c] border border-[#1f2e25] text-[#b4c8bb] rounded-xs"
              >
                {c}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[#6e8a78]">
            Click &ldquo;Inspect Supported Constraints&rdquo; or enable the microphone to query <code>getSupportedConstraints()</code>.
          </div>
        )}
      </div>

      <div className="panel-border rounded-sm p-3 text-[11px] space-y-1.5">
        <div className="text-xs font-semibold text-[#86efac]">
          PRIVACY &amp; PERMISSION BOUNDARIES
        </div>
        <p className="text-[#b8c9be]">
          Granting microphone permission to an origin does more than stream audio: it unlocks hardware-identifying device labels (e.g., USB interface, AirPods, virtual loopback devices), per-origin <code>deviceId</code> tokens, and DSP pipeline settings. Operating-system privacy controls (macOS TCC / Windows Privacy) and browser address-bar mic indicators remain authoritative over any web page UI.
        </p>
        {metadata.capabilities && (
          <pre className="mt-2 p-2 bg-[#06090b] border border-[#18241d] text-[10px] text-[#86a390] overflow-x-auto">
            {JSON.stringify(metadata.capabilities, null, 2)}
          </pre>
        )}
      </div>
    </>
  );
}

export function ExperimentC({
  mode,
  metadata,
  micConstraints,
  onUpdateMicConstraints,
  onInspectSupportedOnly,
  onEnumerateDevices,
  onEnableMicrophone,
  onStopCapture,
}: ExperimentCProps) {
  const liveObs = buildLiveObservations(metadata);
  const comparisonRows = buildComparisonRows(metadata, micConstraints);

  return (
    <div className="space-y-4">
      <ExperimentCHeader
        mode={mode}
        onInspectSupportedOnly={onInspectSupportedOnly}
        onEnumerateDevices={onEnumerateDevices}
        onEnableMicrophone={onEnableMicrophone}
        onStopCapture={onStopCapture}
      />
      <ConstraintToggles
        micConstraints={micConstraints}
        onUpdateMicConstraints={onUpdateMicConstraints}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ConstraintTable rows={comparisonRows} />
        <DeviceList metadata={metadata} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <CapabilitiesPanel metadata={metadata} />
      </div>

      <ProtocolCard
        protocol={EXPERIMENT_PROTOCOLS.C}
        liveObservations={liveObs}
      />
    </div>
  );
}
