import { lazy, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountFlow } from './account/AccountFlow';
import { guidePage } from './guide/GuidePage';
import { legalPage } from './common/LegalPage';
import { applyStoredScheme } from './common/reading';
import { ScreenLoad } from './common/ScreenLoad';
import { watchProblems } from '../runtime/diagnostics';
import { markSelfHost } from '../runtime/installation';
import { pulsePage } from './pulse/PulsePage';
import { sharePage } from './share/SharePage';
import { markScrollbars } from './ui';
import './ui/foundation/global.css';

const StartPage = lazy(() => import('./start/StartPage').then(({ StartPage }) => ({ default: StartPage })));
const Workspace = lazy(() => import('./shell/Workspace').then(({ Workspace }) => ({ default: Workspace })));

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

markSelfHost(document.documentElement.hasAttribute('data-self-host'));
watchProblems();
applyStoredScheme();
markScrollbars();

createRoot(root).render(
  <StrictMode>
    {legalPage(location.pathname) ?? guidePage(location.pathname) ?? pulsePage(location.pathname) ?? sharePage(location.pathname, location.hash) ?? <AccountFlow first={(doors) => <ScreenLoad><StartPage {...doors} /></ScreenLoad>}>{(unlocked) => <ScreenLoad><Workspace {...unlocked} /></ScreenLoad>}</AccountFlow>}
  </StrictMode>,
);

// Fonts may replace the system faces after paint, but a slow stylesheet must never hold the first screen.
requestAnimationFrame(() => requestAnimationFrame(() => {
  void import('./ui/foundation/fonts.css').catch(() => {});
}));
