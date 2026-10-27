import { errorText, type EvaluationDown, type EvaluationUp } from './evaluation-core';
import { moduleWorker } from './worker';
import workerUrl from './evaluation-worker?worker&url';

// Device/tab-only diagnostics: never include chat text, keys or account identity; never persist across reloads.
type Problem = { at: number; text: string };

const KEPT = 20;
const PROBE_MS = 30_000;
const problems: Problem[] = [];

// The same problem said again in a row, as a failure repeats on each try, stays one line.
export function noteProblem(text: string, at = Date.now()) {
  if (problems[problems.length - 1]?.text === text) return;
  problems.push({ at, text });
  if (problems.length > KEPT) problems.shift();
}

export const recentProblems = (): readonly Problem[] => problems;

export function watchProblems() {
  addEventListener('error', (event) => noteProblem(`오류 · ${event.error === undefined || event.error === null ? event.message : errorText(event.error)}`));
  addEventListener('unhandledrejection', (event) => noteProblem(`처리되지 않은 오류 · ${errorText(event.reason)}`));
}

// A worker of its own, so a failed import the app's worker has cached is tried again, as a reload would.
function probeTokenizer(): Promise<string> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = moduleWorker(workerUrl);
    } catch (error) {
      return resolve(`워커를 만들지 못했어요 · ${errorText(error)}`);
    }
    const done = (text: string) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(text);
    };
    const timer = setTimeout(() => done(`${PROBE_MS / 1000}초 동안 응답이 없었어요`), PROBE_MS);
    worker.onmessage = ({ data }: MessageEvent<EvaluationUp>) => {
      if ('probed' in data) done(data.probed);
    };
    worker.onerror = (event) => done(`워커 오류 · ${event.message || '내용 없음'}`);
    worker.onmessageerror = () => done('워커의 응답을 읽지 못했어요');
    worker.postMessage({ probe: true } satisfies EvaluationDown);
  });
}

type Device = { userAgent: string; language: string; screen: string; cores: number | null; memory: number | null; standalone: boolean; online: boolean };

function device(): Device {
  const nav = navigator as Navigator & { deviceMemory?: number; standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    language: nav.language,
    screen: `${screen.width}×${screen.height} @${devicePixelRatio} · 창 ${innerWidth}×${innerHeight}`,
    cores: nav.hardwareConcurrency || null,
    memory: nav.deviceMemory ?? null,
    standalone: matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
    online: nav.onLine,
  };
}

const UNKNOWN = '알 수 없음';

export function reportText({ version, now, device, tokenizer, problems }: { version: string | null; now: number; device: Device; tokenizer: string; problems: readonly Problem[] }): string {
  return [
    '헤이젤 진단 정보',
    `시각: ${new Date(now).toISOString()}`,
    `버전: ${version ?? UNKNOWN}`,
    `브라우저: ${device.userAgent}`,
    `언어: ${device.language}`,
    `화면: ${device.screen}`,
    `코어: ${device.cores ?? UNKNOWN} · 메모리: ${device.memory === null ? UNKNOWN : `${device.memory}GB`}`,
    `홈 화면 앱: ${device.standalone ? '예' : '아니요'} · 온라인: ${device.online ? '예' : '아니요'}`,
    `토크나이저: ${tokenizer}`,
    '최근 오류:',
    ...(problems.length === 0 ? ['- 없음'] : problems.map(({ at, text }) => `- ${new Date(at).toISOString()} ${text}`)),
  ].join('\n');
}

export async function diagnosticReport(version: string | null): Promise<string> {
  const tokenizer = await probeTokenizer();
  return reportText({ version, now: Date.now(), device: device(), tokenizer, problems });
}
