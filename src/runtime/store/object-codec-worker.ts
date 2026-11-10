import { codeObjects, type CodecDown, type CodecUp } from './object-codec-core';

const scope = self as unknown as { postMessage(message: CodecUp): void };
let account: string;
let key: CryptoKey;

addEventListener('message', ({ data }: MessageEvent<CodecDown>) => {
  if (data.kind === 'init') {
    account = data.account;
    key = data.key;
    return;
  }
  void codeObjects(key, account, data.job).then((results) => scope.postMessage({ id: data.id, results }));
});
