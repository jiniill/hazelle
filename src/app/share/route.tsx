import { lazy } from 'react';
import { readShareLink } from '../../runtime/export/share-link';
import { ScreenLoad } from '../common/ScreenLoad';
import { pendingFor } from '../common/sharePending';

const SharePage = lazy(() => import('./SharePage').then(({ SharePage }) => ({ default: SharePage })));

// main.tsx asks before the account flow, as for /terms: the page reads the same signed in or out, and opens without an
// account. A link whose 헤이젤로 가져오기 is waiting goes to the account flow instead (common/sharePending).
export function sharePage(path: string, hash: string) {
  const link = readShareLink(path, hash);
  if (!link || pendingFor(link.id) !== null) return null;
  return <ScreenLoad><SharePage id={link.id} shareKey={link.key} /></ScreenLoad>;
}

