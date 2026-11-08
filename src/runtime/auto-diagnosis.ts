import { AUTO_BROWSER_MESSAGES, AUTO_ERROR_NAMES, AUTO_OPEN_FAILURES, readAutoReport, type AutoChat, type AutoDetail, type AutoErrorCause, type AutoErrorName, type AutoEvent, type AutoJob, type AutoReport } from '../contracts/auto-diagnosis';
import type { Place } from './diagnostic-state';
import { without } from '../model/fields';
import type { Settings } from '../model/settings';
import { fetchApi } from './api';
import { BUILT_VERSION, selfHost } from './installation';
import type { ObjectStore } from './store';
import { changeSettings } from './account-settings';

// 자동 진단 (design §6.13): the account's switch, on unless set off. A guest and a self-host send none.
export const sharesDiagnosis = (settings: Settings) => !selfHost() && settings.diagnosis !== false;

export const setDiagnosisSharing = (store: ObjectStore, on: boolean) =>
  changeSettings(store, (current) => (on ? without(current, 'diagnosis') : { ...current, diagnosis: false }));

// Null leaves the last place standing: 앱 정보 and the board are where a report is written, not what it is about.
let place: Place | null = null;
export function notePlace(next: Place | null) {
  if (next) place = next;
}
export const lastPlace = () => place;

const FRAMES = 12;

let armed = false;
// For the page's life: a problem that repeats, as a failure does on each try, is one report per chat or job.
const said = new Set<string>();

export function holdDiagnosis(on: boolean) {
  armed = on;
}

const first = (agent: string, patterns: [AutoReport['browser'], RegExp][]) => {
  for (const [browser, pattern] of patterns) {
    const major = pattern.exec(agent)?.[1];
    if (major) return { browser, major: Number(major) };
  }
  return { browser: 'other' as const, major: null };
};

export function deviceFacts(agent: string): Pick<AutoReport, 'browser' | 'major' | 'os' | 'mobile'> {
  return {
    // The order counts: each of these also says Chrome or Safari.
    ...first(agent, [['samsung', /SamsungBrowser\/(\d+)/], ['edge', /Edg\w*\/(\d+)/], ['firefox', /(?:Firefox|FxiOS)\/(\d+)/], ['chrome', /(?:Chrome|CriOS)\/(\d+)/], ['safari', /Version\/(\d+)[^ ]* .*Safari/]]),
    os: /iPhone|iPad/.test(agent) ? 'ios' : /Android/.test(agent) ? 'android' : /Windows/.test(agent) ? 'windows' : /Mac OS X/.test(agent) ? 'mac' : /Linux/.test(agent) ? 'linux' : 'other',
    mobile: /Mobi|Android|iPhone|iPad/.test(agent),
  };
}

// What a report says of the page and the machine, whatever the problem.
function pageFacts(): Pick<AutoReport, 'screen' | 'page' | 'online' | 'visible' | 'standalone' | 'cores' | 'memoryGb' | 'width' | 'height' | 'language'> {
  const nav = navigator as Navigator & { deviceMemory?: number; standalone?: boolean };
  return {
    screen: place?.kind ?? null,
    page: Math.round(performance.now() / 1000),
    online: nav.onLine,
    visible: document.visibilityState === 'visible',
    standalone: nav.standalone === true || matchMedia('(display-mode: standalone)').matches,
    cores: nav.hardwareConcurrency || null,
    memoryGb: nav.deviceMemory ?? null,
    width: innerWidth,
    height: innerHeight,
    language: /^[A-Za-z-]{2,20}$/.test(nav.language) ? nav.language : null,
  };
}

// A thrown error's name and where in the app's bundle it went off. Its message and its stack's function names stay out.
export function errorFacts(error: object): { detail: AutoErrorName; cause: AutoErrorCause; place: string | null; frames: string | null } {
  const { name, message, stack } = error as { name?: unknown; message?: unknown; stack?: unknown };
  const frames = typeof stack === 'string' ? [...stack.matchAll(/\/assets\/([\w.-]{1,100}\.js:\d{1,9}:\d{1,9})/g)].slice(0, FRAMES).map((match) => match[1]!) : [];
  const cause = AUTO_BROWSER_MESSAGES.find((known) => known.message === message)?.cause ?? 'other';
  return { detail: AUTO_ERROR_NAMES.find((known) => known === name) ?? 'other', cause, place: frames[0] ?? null, frames: frames.join(' ') || null };
}

export const openFailure = (error: string): AutoDetail => AUTO_OPEN_FAILURES.find((known) => known === error) ?? 'other';

export type AutoOrigin = NonNullable<AutoReport['origin']>;

type Problem = { event: AutoEvent; detail?: AutoDetail | null; cause?: AutoErrorCause | null; place?: string | null; frames?: string | null; origin?: AutoReport['origin']; chat?: { id: string; read: () => AutoChat | null }; job?: { id: string; facts: AutoJob } };

// Never fails its caller, and a report that goes wrong tells no one: this is the app's own note about a problem.
export function autoDiagnose({ event, detail = null, cause = null, place: thrown = null, frames = null, origin = null, chat, job }: Problem) {
  if (!armed) return;
  const key = JSON.stringify([event, detail, cause, thrown, (chat ?? job)?.id ?? null]);
  if (said.has(key)) return;
  said.add(key);
  try {
    const report = readAutoReport({ event, detail, cause, version: BUILT_VERSION, place: thrown, frames, origin, ...deviceFacts(navigator.userAgent), ...pageFacts(), chat: chat?.read() ?? null, job: job?.facts ?? null });
    if (report) void fetchApi('diagnoses', { anonymous: true, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report), keepalive: true }).catch(() => {
      // Reporting must not create another report, and a failed report is never queued or retried.
    });
  } catch {
    // Whatever a read of the chat threw, the problem being reported is the caller's to handle, not this one.
  }
}
