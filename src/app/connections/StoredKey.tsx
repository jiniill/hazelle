import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { ACTS } from '../common/acts';
import { useCopy } from '../common/useCopy';
import { Button, TextField } from '../ui';

// Covered until asked, so a shared screen or a picture of it shows at most the last few characters.
export function StoredKey({ label, secret, lines }: { label: string; secret: string; lines?: number }) {
  const copy = useCopy();
  const [shown, setShown] = useState(false);
  return (
    <TextField
      label={label}
      kind="key"
      readOnly
      lines={shown ? lines : undefined}
      value={shown ? secret : covered(secret)}
      onChange={() => {}}
      action={
        <>
          <Button variant="secondary" size="sm" icon={shown ? EyeOff : Eye} onClick={() => setShown(!shown)}>
            {shown ? '가리기' : '보기'}
          </Button>
          <Button variant="secondary" size="sm" icon={ACTS.copy.icon} onClick={() => copy(secret)}>
            {ACTS.copy.label}
          </Button>
        </>
      }
    />
  );
}

// The last four tell two keys apart; a short key or a file's lines (a service account) give away too much of themselves.
export const covered = (secret: string) => '•'.repeat(12) + (secret.length > 16 && !secret.includes('\n') ? secret.slice(-4) : '');
