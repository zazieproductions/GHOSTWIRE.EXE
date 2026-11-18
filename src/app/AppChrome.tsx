import { MAX_SESSION_SAMPLES } from './limits';

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  return message ? (
    <div
      role="alert"
      className="max-w-[1440px] w-full mx-auto mt-3 px-4"
    >
      <div className="border border-[#ef4444]/60 bg-[#210c0c] text-[#fecaca] px-3 py-2 rounded-sm text-xs flex items-center justify-between gap-3">
        <span>{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="px-2 py-0.5 border border-[#ef4444]/50 rounded-xs text-[11px] hover:bg-[#3b1515] cursor-pointer"
        >
          DISMISS
        </button>
      </div>
    </div>
  ) : null;
}

export function SessionSampleLimitNotice({ reached }: { reached: boolean }) {
  return (
    <div aria-live="polite" aria-atomic="true" className="max-w-[1440px] w-full mx-auto px-4">
      {reached && (
        <p className="mt-3 border border-[#f59e0b]/50 bg-[#181207] text-[#fcd34d] px-3 py-2 rounded-sm text-xs">
          Session sample limit reached. Only the first {MAX_SESSION_SAMPLES.toLocaleString()} points are kept.
        </p>
      )}
    </div>
  );
}

export function AppFooter() {
  return (
    <footer className="border-t border-[#15201a] bg-[#090d10] px-4 py-2 text-[10px] text-[#5e7a68]">
      <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
        <span>
          GHOSTWIRE.EXE // Defensive Acoustic Side-Channel Research Instrument (MIT License)
        </span>
        <span>
          100% Client-Side Processing • No Audio Recording • No Network Transmission • dBFS ≠ dB SPL
        </span>
      </div>
    </footer>
  );
}
