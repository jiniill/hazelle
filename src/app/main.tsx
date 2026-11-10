import { lazy, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountFlow, returning } from './account/AccountFlow';
import { guidePage } from './guide/GuidePage';
import { legalPage } from './common/LegalPage';
import { applyStoredScheme } from './common/reading';
import { ScreenLoad, screenChunk } from './common/ScreenLoad';
import { watchProblems } from '../runtime/diagnostics/diagnostics';
import { markSelfHost } from '../runtime/installation';
import { START_AGAIN } from '../contracts/start';
import { pulsePage } from './pulse/route';
import { sharePage } from './share/route';
import { markScrollbars } from './ui';
import './ui/foundation/global.css';

const StartPage = lazy(() => import('./start/StartPage').then(({ StartPage }) => ({ default: StartPage })));
const { Screen: Workspace, start: startWorkspace } = screenChunk(() => import('./shell/Workspace'), (module) => module.Workspace);

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

markSelfHost(document.documentElement.hasAttribute('data-self-host'));
watchProblems();
applyStoredScheme();
markScrollbars();

const page = legalPage(location.pathname) ?? guidePage(location.pathname) ?? pulsePage(location.pathname) ?? sharePage(location.pathname, location.hash) ?? (location.pathname === START_AGAIN.path ? <ScreenLoad><StartPage doors={null} /></ScreenLoad> : null);
if (!page && returning()) void startWorkspace();

createRoot(root).render(
  <StrictMode>
    {page ?? <AccountFlow first={(doors) => <ScreenLoad><StartPage doors={doors} /></ScreenLoad>}>{(unlocked) => <ScreenLoad><Workspace {...unlocked} /></ScreenLoad>}</AccountFlow>}
  </StrictMode>,
);

// Fonts may replace the system faces after paint, but a slow stylesheet must never hold the first screen.
requestAnimationFrame(() => requestAnimationFrame(() => {
  void import('./ui/foundation/fonts.css').catch(() => {});
}));
