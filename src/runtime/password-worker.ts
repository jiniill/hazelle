import { stretchPassword } from '../vault/keys';
import type { StretchDown, StretchUp } from './password';

const scope = self as unknown as { postMessage(message: StretchUp): void };

addEventListener('message', ({ data }: MessageEvent<StretchDown>) => {
  stretchPassword(data.stretch.password, data.stretch.salt).then(
    (stretched) => scope.postMessage({ stretched }),
    (error: unknown) => scope.postMessage({ failed: String(error) }),
  );
});
