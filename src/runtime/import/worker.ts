import { errorMessage } from '../../error-message';
import { ImportReader } from './reader';
import type { Down, Up } from './protocol';
import { postProgress } from '../worker';

const scope = self as unknown as { postMessage(message: Up, transfer: ArrayBuffer[]): void };
const reader = new ImportReader();
postProgress(() => scope.postMessage({ progress: true }, []));

addEventListener('message', ({ data }: MessageEvent<Down>) => {
  if ('ping' in data) return scope.postMessage({ pong: true }, []);
  void reader.handle(data.request).then(
    (result) => {
      const bytes = result instanceof Uint8Array ? result : result && 'bytes' in result ? result.bytes : null;
      scope.postMessage({ id: data.id, result }, bytes ? [bytes.buffer] : []);
    },
    (error: unknown) => scope.postMessage({ id: data.id, error: errorMessage(error) }, []),
  );
});
