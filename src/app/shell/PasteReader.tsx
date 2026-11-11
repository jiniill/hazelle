import { useEffect, useRef, useState } from 'react';
import { detect } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { importable } from '../../engine/import/extensions';
import { readLink } from '../../runtime/import/link';
import { useImport } from '../common/importing';
import { PastedKeyDialog } from '../connections/PastedKeyDialog';
import { typing } from '../shortcuts';
import { pasteFiles } from '../ui';
import { navigate } from './router';

type Key = { type: ConnectionType; secret: string };
type Pasted = ({ kind: 'key' } & Key) | { kind: 'link'; text: string };

// Only what is known for sure: detect reads any other word as an unknown key, and readLink any address as a direct link.
export function readPaste(text: string): Pasted | null {
  const known = detect(text);
  if (known?.kind === 'key') return known;
  const link = readLink(text);
  return link && link.kind !== 'direct' ? { kind: 'link', text: text.trim() } : null;
}

// What is pasted outside every field, anywhere in the app: bot files and links go to the import, a key to 새 연결.
export function PasteReader() {
  const importer = useImport();
  const latest = useRef(importer);
  latest.current = importer;
  const [key, setKey] = useState<Key | null>(null);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || typing(event)) return;
      const { drop, pickLink } = latest.current;
      const files = (picked: File[]) => {
        const read = picked.filter((file) => importable(file.name));
        if (read.length) drop(read);
      };
      if (pasteFiles(event, files)) return;
      const pasted = readPaste(event.clipboardData?.getData('text/plain') ?? '');
      if (pasted?.kind === 'link') pickLink(pasted.text);
      if (pasted?.kind === 'key') {
        navigate({ kind: 'add-connection' });
        setKey(pasted);
      }
    };
    addEventListener('paste', paste);
    return () => removeEventListener('paste', paste);
  }, []);

  return key && <PastedKeyDialog type={key.type} secret={key.secret} onClose={() => setKey(null)} />;
}
