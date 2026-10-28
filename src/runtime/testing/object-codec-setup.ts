import { Evaluator, type EvaluationDown, type EvaluationUp } from '../evaluation-core';
import { codeObjects, type CodecDown, type CodecJob, type CodecResult, type CodecUp } from '../object-codec-core';
import type { StretchDown, StretchUp } from '../password';
import { stretchPassword } from '../../vault/keys';

// Plain Node has no browser Worker. The object codec's and the password's real transports talk to this in-process one; a test scripts
// replies or a crash with vi.stubGlobal, which vi.unstubAllGlobals puts back to this.
export class CodecWorker {
  onmessage: ((event: { data: CodecUp | EvaluationUp | StretchUp }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private readonly evaluator = new Evaluator();
  private account = '';
  private key: CryptoKey | null = null;

  postMessage(message: CodecDown | EvaluationDown | StretchDown) {
    if ('stretch' in message) return void stretchPassword(message.stretch.password, message.stretch.salt).then((stretched) => this.onmessage?.({ data: { stretched } }));
    if ('ping' in message) return this.onmessage?.({ data: { pong: true } });
    if ('warm' in message || 'probe' in message) return;
    if ('forget' in message) return this.evaluator.forget(message.forget);
    if ('input' in message) {
      void this.evaluator.run(structuredClone(message.input), () => this.onmessage?.({ data: { started: message.id } })).then((result) => this.onmessage?.({ data: { id: message.id, result: structuredClone(result) } }), (error: unknown) => this.onmessage?.({ data: { id: message.id, error: String(error) } }));
      return;
    }
    if (message.kind === 'init') {
      this.account = message.account;
      this.key = message.key;
      return;
    }
    void this.run(message.job).then((results) => this.onmessage?.({ data: { id: message.id, results } }), () => this.onerror?.());
  }

  run(job: CodecJob): Promise<CodecResult[]> {
    return codeObjects(this.key!, this.account, job);
  }

  terminate() {}
}

globalThis.Worker = CodecWorker as unknown as typeof Worker;
// Two codec workers and three windows ahead on every machine: tests count dispatched windows.
Object.defineProperty(navigator, 'hardwareConcurrency', { value: 3, configurable: true });
