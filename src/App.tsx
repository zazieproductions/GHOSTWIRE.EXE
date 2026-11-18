import { AppFooter, ErrorBanner, SessionSampleLimitNotice } from './app/AppChrome';
import { AppHeader } from './app/AppHeader';
import { AppWorkspace } from './app/AppWorkspace';
import { useGhostwireController } from './app/useGhostwireController';

export default function App() {
  const { state, controls } = useGhostwireController();

  return (
    <div className="min-h-screen flex flex-col bg-[#07090b] text-[#c9d6cd]">
      <AppHeader state={state} controls={controls} />
      <ErrorBanner message={state.errorBanner} onDismiss={controls.dismissError} />
      <SessionSampleLimitNotice reached={state.sessionSampleLimitReached} />
      <AppWorkspace state={state} controls={controls} />
      <AppFooter />
    </div>
  );
}
