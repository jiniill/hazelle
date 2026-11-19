import { LogIn } from 'lucide-react';
import { useEffect, useState } from 'react';
import { grantPage, grantReturn, settleGrant, type Granting } from '../../runtime/account/grant';
import { describeFailure, describeGrantFailure } from './failure';
import { Button, Callout, Stack } from '../ui';

// The provider's sign-in in place of a pasted key: the page leaves for the provider's and comes back to this same
// address, where whichever screen stands there takes the key (onKey). onStart: just before the page leaves.
export function KeyGrant({ type, label, onStart, onKey }: { type: Granting; label: string; onStart?: () => void; onKey: (secret: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const back = grantReturn();
    if (!back || (back.type !== null && back.type !== type.id)) return;
    let shown = true;
    setBusy(true);
    void back.key.then((key) => {
      if (!shown) return;
      settleGrant();
      setBusy(false);
      if (key.ok) onKey(key.secret);
      else setFailure(describeGrantFailure(key.failure, type.grant.site));
    });
    return () => {
      shown = false;
    };
  }, []);

  async function start() {
    setFailure(null);
    const page = await grantPage(type, location.origin + location.pathname);
    if (!page) return setFailure(describeFailure({ ok: false, error: 'browser-storage' }));
    onStart?.();
    location.assign(page);
  }

  return (
    <Stack>
      <div>
        <Button icon={LogIn} busy={busy} onClick={() => void start()}>
          {label}
        </Button>
      </div>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Stack>
  );
}
