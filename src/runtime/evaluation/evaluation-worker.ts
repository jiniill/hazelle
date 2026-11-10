import { Evaluator, type EvaluationDown, type EvaluationUp } from './evaluation-core';
import { errorText } from './error-text';
import { tokenizer } from './tokenizer';
import { postProgress } from '../worker';

const evaluator = new Evaluator();
const scope = self as unknown as { postMessage(message: EvaluationUp): void };
postProgress(() => scope.postMessage({ progress: true }));
addEventListener('message', ({ data }: MessageEvent<EvaluationDown>) => {
  if ('ping' in data) return scope.postMessage({ pong: true });
  // A job that counts says only that the tokenizer failed (Counted); the warm-up, the first to load it, says why.
  if ('warm' in data) return void tokenizer().catch((error: unknown) => scope.postMessage({ trouble: `토크나이저를 불러오지 못했어요: ${errorText(error)}` }));
  if ('probe' in data) return void probe().then((probed) => scope.postMessage({ probed }));
  if ('forget' in data) return evaluator.forget(data.forget);
  void evaluator.run(data.input, () => scope.postMessage({ started: data.id })).then(
    (result) => scope.postMessage({ id: data.id, result }),
    (error: unknown) => scope.postMessage({ id: data.id, error: String(error) }),
  );
});

// How 문제 진단 sees the tokenizer from a fresh worker, whose failed import no earlier attempt has cached.
async function probe(): Promise<string> {
  const started = performance.now();
  const took = () => `${Math.round(performance.now() - started)}ms`;
  try {
    const countTokens = await tokenizer();
    return `불러옴 · ${took()} · "안녕하세요 hello" ${countTokens('안녕하세요 hello')}토큰`;
  } catch (error) {
    return `실패 · ${took()} · ${errorText(error)}`;
  }
}
