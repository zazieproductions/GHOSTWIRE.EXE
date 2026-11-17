import type {
  ActivityInferenceResult,
  DeviceMetadataSnapshot,
  DspFrame,
  ExperimentId,
  FrequencyScale,
  InputMode,
  MicConstraintPreferences,
  TransformConfig,
} from '../../types/acoustic';
import { ExperimentA } from '../experiments/ExperimentA';
import { ExperimentB } from '../experiments/ExperimentB';
import { ExperimentC } from '../experiments/ExperimentC';
import { ExperimentD } from '../experiments/ExperimentD';
import { ExperimentE } from '../experiments/ExperimentE';

interface ExposureLabViewProps {
  activeExperiment: ExperimentId;
  onSelectExperiment: (id: ExperimentId) => void;
  mode: InputMode;
  latestFrame: DspFrame | null;
  postFrame: DspFrame | null;
  recentFrames: DspFrame[];
  activity: ActivityInferenceResult | null;
  metadata: DeviceMetadataSnapshot;
  micConstraints: MicConstraintPreferences;
  transformConfig: TransformConfig;
  frequencyScale: FrequencyScale;
  onUpdateMicConstraints: (next: MicConstraintPreferences) => void;
  onInspectSupportedOnly: () => void;
  onEnumerateDevices: () => void;
  onEnableMicrophone: () => void;
  onStopCapture: () => void;
  onChangeTransform: (next: TransformConfig) => void;
}

const EXPERIMENT_TABS: Array<{ id: ExperimentId; title: string; subtitle: string }> = [
  { id: 'A', title: 'EXP A // ENV FINGERPRINT', subtitle: 'Spectral Profile Comparison' },
  { id: 'B', title: 'EXP B // ACTIVITY INFERENCE', subtitle: 'Transparent Heuristics' },
  { id: 'C', title: 'EXP C // METADATA LEAKAGE', subtitle: 'MediaDevices & Settings' },
  { id: 'D', title: 'EXP D // SIGNAL TRANSFORM', subtitle: 'Filters, Gate & Masking' },
  { id: 'E', title: 'EXP E // PRIVACY EXPOSURE', subtitle: 'Zero-Recording Inference' },
];

export function ExposureLabView(props: ExposureLabViewProps) {
  const { activeExperiment, onSelectExperiment } = props;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {EXPERIMENT_TABS.map((tab) => {
          const active = tab.id === activeExperiment;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectExperiment(tab.id)}
              className={`text-left px-3 py-2 rounded-sm border transition-colors cursor-pointer ${
                active
                  ? 'border-[#22c55e] bg-[#0e1f16] text-[#bbf7d0]'
                  : 'border-[#1b2821] bg-[#0b1013] text-[#86a390] hover:border-[#2e4738]'
              }`}
            >
              <div className="text-[11px] font-bold tracking-wider">{tab.title}</div>
              <div className="text-[10px] text-[#6e8a78]">{tab.subtitle}</div>
            </button>
          );
        })}
      </div>

      {activeExperiment === 'A' && (
        <ExperimentA mode={props.mode} latestFrame={props.latestFrame} />
      )}
      {activeExperiment === 'B' && (
        <ExperimentB mode={props.mode} activity={props.activity} />
      )}
      {activeExperiment === 'C' && (
        <ExperimentC
          mode={props.mode}
          metadata={props.metadata}
          micConstraints={props.micConstraints}
          onUpdateMicConstraints={props.onUpdateMicConstraints}
          onInspectSupportedOnly={props.onInspectSupportedOnly}
          onEnumerateDevices={props.onEnumerateDevices}
          onEnableMicrophone={props.onEnableMicrophone}
          onStopCapture={props.onStopCapture}
        />
      )}
      {activeExperiment === 'D' && (
        <ExperimentD
          mode={props.mode}
          preFrame={props.latestFrame}
          postFrame={props.postFrame}
          transformConfig={props.transformConfig}
          frequencyScale={props.frequencyScale}
          onChangeTransform={props.onChangeTransform}
        />
      )}
      {activeExperiment === 'E' && (
        <ExperimentE
          mode={props.mode}
          recentFrames={props.recentFrames}
          metadata={props.metadata}
          activity={props.activity}
        />
      )}
    </div>
  );
}
