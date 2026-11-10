import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AccountFacts } from '../../runtime/account/account';
import { randomBytes } from '../../vault/aead';
import { Workspace } from './Workspace';

it('shows the initial pull count before the session opens instead of a blank screen', () => {
  const html = renderToStaticMarkup(<Workspace accountId="account" vaultKey={randomBytes(32)} username="jin" admin={false} localProviders={[]} guest={null} facts={new AccountFacts({ suspended: false, state: 'active', storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null }, unreadNotices: 0, unreadBoard: 0 })} onLock={() => {}} onLogout={async () => null} />);
  expect(html).toContain('불러오는 중');
});
