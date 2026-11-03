import { lazy } from 'react';
import { HOSTED } from '../../contracts/installation';
import { selfHost } from '../../runtime/installation';
import { ScreenLoad } from '../common/ScreenLoad';
import { PULSE } from '../common/words';

const PulsePage = lazy(() => import('./PulsePage').then(({ PulsePage }) => ({ default: PulsePage })));

// main.tsx asks before the account flow, as for /terms: the page reads the same signed in or out.
export function pulsePage(path: string) {
  if (path !== PULSE.path) return null;
  // A self-host's 헤이젤 나우 is hazelle.app's.
  if (selfHost()) {
    location.replace(HOSTED + PULSE.path);
    return <></>;
  }
  return <ScreenLoad><PulsePage /></ScreenLoad>;
}
