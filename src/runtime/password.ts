import type { Stretch } from '../vault/keys';
import { moduleWorker } from './worker';
import workerUrl from './password-worker?worker&url';

export type StretchDown = { stretch: { password: string; salt: Uint8Array<ArrayBuffer> } };
export type StretchUp = { stretched: Uint8Array<ArrayBuffer> } | { failed: string };

// One worker per sign-in, ended with its answer: Argon2 holds 64 MB while it runs and is needed again only at the
// next sign-in.
export const stretchInWorker: Stretch = (password, salt) =>
  new Promise((resolve, reject) => {
    const worker = moduleWorker(workerUrl);
    worker.onmessage = ({ data }: MessageEvent<StretchUp>) => {
      worker.terminate();
      if ('stretched' in data) resolve(data.stretched);
      else reject(new Error(data.failed));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('Password worker failed'));
    };
    worker.postMessage({ stretch: { password, salt } } satisfies StretchDown);
  });
