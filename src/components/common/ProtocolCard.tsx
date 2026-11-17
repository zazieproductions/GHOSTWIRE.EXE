import { useState } from 'react';
import type { ScientificProtocol } from '../../types/acoustic';

interface ProtocolCardProps {
  protocol: ScientificProtocol;
  liveObservations?: string[];
  defaultOpen?: boolean;
}

export function ProtocolCard({
  protocol,
  liveObservations = [],
  defaultOpen = false,
}: ProtocolCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="panel-border rounded-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full panel-header px-3 py-2 flex items-center justify-between text-left hover:bg-[#121a1f] transition-colors"
      >
        <span className="text-xs font-semibold tracking-wider text-[#86efac]">
          SCIENTIFIC PROTOCOL // {protocol.title.toUpperCase()}
        </span>
        <span className="text-[11px] text-[#7a9384]">
          {open ? '[COLLAPSE]' : '[EXPAND METHODOLOGY & LIMITATIONS]'}
        </span>
      </button>

      {open && (
        <div className="p-3.5 grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
          <div>
            <div className="text-[#4ade80] font-semibold mb-1 uppercase tracking-wider text-[11px]">
              Research Question
            </div>
            <p className="text-[#c5d4ca]">{protocol.researchQuestion}</p>
          </div>
          <div>
            <div className="text-[#4ade80] font-semibold mb-1 uppercase tracking-wider text-[11px]">
              Hypothesis
            </div>
            <p className="text-[#c5d4ca]">{protocol.hypothesis}</p>
          </div>

          <div>
            <div className="text-[#4ade80] font-semibold mb-1 uppercase tracking-wider text-[11px]">
              Procedure
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[#b8c9be]">
              {protocol.procedure.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>

          <div>
            <div className="text-[#4ade80] font-semibold mb-1 uppercase tracking-wider text-[11px]">
              Measured Variables
            </div>
            <ul className="list-disc list-inside space-y-1 text-[#b8c9be]">
              {protocol.measuredVariables.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          </div>

          {liveObservations.length > 0 && (
            <div className="md:col-span-2 bg-[#0d1512] border border-[#1f3b2b] p-2.5 rounded-sm">
              <div className="text-[#86efac] font-semibold mb-1 uppercase tracking-wider text-[11px]">
                Current Observed Measurements
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[#d1e7d8]">
                {liveObservations.map((obs, i) => (
                  <li key={i}>{obs}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-[#fbbf24] font-semibold mb-1 uppercase tracking-wider text-[11px]">
              Limitations
            </div>
            <ul className="list-disc list-inside space-y-1 text-[#e6d5a8]">
              {protocol.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[#fbbf24] font-semibold mb-1 uppercase tracking-wider text-[11px]">
              Confounding Factors &amp; Reproducibility
            </div>
            <ul className="list-disc list-inside space-y-1 text-[#b8c9be] mb-2">
              {protocol.confoundingFactors.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
            <div className="text-[11px] text-[#86a390] border-t border-[#1b2821] pt-1.5">
              <span className="text-[#4ade80] font-semibold">Reproducibility: </span>
              {protocol.reproducibilityNotes}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
