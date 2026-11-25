import { AUTO_BROWSER_MESSAGES, AUTO_ERROR_NAMES, AUTO_OPEN_FAILURES, closedWord, readAutoReport, type AutoChat, type AutoDetail, type AutoErrorCause, type AutoErrorName, type AutoEvent, type AutoFrame, type AutoJob, type AutoReport, type AutoScript } from '../../contracts/auto-diagnosis';
import { stalls } from './frames';
import type { Place } from './diagnostic-state';
import { without } from '../../model/fields';
import type { Settings } from '../../model/settings';
import { fetchApi } from '../api';
import { BUILT_VERSION, ownScript, selfHost } from '../installation';
import type { ObjectStore } from '../store/store';
import { changeSettings } from '../account-settings';

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

type ChatRead = { id: string; read: () => AutoChat | null };
// The chat on screen (app/chat/useChat), which a report about no chat reads.
let open: ChatRead | null = null;
export function noteChat(next: ChatRead | null) {
  open = next;
}
// A read that fails leaves the report without a chat: the problem told is not this chat's.
function onScreen(): AutoChat | null {
  try {
    return open?.read() ?? null;
  } catch {
    return null;
  }
}

const TRAIL = 40;
const trail: { word: string; at: number; n: number | null }[] = [];
// What the page just did, kept for the next report's trail. word: a closed word of the app's own, never a name or a
// text; n: a number of its own, such as how long it took.
export function noteStep(word: string, n: number | null = null) {
  trail.push({ word: closedWord(word), at: performance.now(), n: n === null ? null : Math.round(n) });
  if (trail.length > TRAIL) trail.shift();
}

let errors = 0;
const NETS = ['slow-2g', '2g', '3g', '4g'] as const;
const ENTERED = ['navigate', 'reload', 'back_forward', 'prerender'] as const;
const MB = 1024 * 1024;

const FRAMES = 12;
const PLACE = /^[\w.-]{1,100}\.js:\d{1,9}:\d{1,9}$/;

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

// The elements inside the open shadow roots under a root, each story being one, and inside the roots in those.
function shadowed(root: Document | ShadowRoot): number {
  let count = 0;
  for (const { shadowRoot } of root.querySelectorAll('*')) if (shadowRoot) count += shadowRoot.querySelectorAll('*').length + shadowed(shadowRoot);
  return count;
}

// What a report says of the page and the machine, whatever the problem.
function pageFacts(): Pick<AutoReport, 'screen' | 'page' | 'online' | 'visible' | 'standalone' | 'cores' | 'memoryGb' | 'width' | 'height' | 'language' | 'dpr' | 'touch' | 'reducedMotion' | 'heapMb' | 'heapLimitMb' | 'net' | 'saveData' | 'discarded' | 'entered' | 'translated' | 'dom' | 'shadow' | 'errors' | 'stalls' | 'trail'> {
  const nav = navigator as Navigator & { deviceMemory?: number; standalone?: boolean; connection?: { effectiveType?: string; saveData?: boolean } };
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const now = performance.now();
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
    dpr: devicePixelRatio,
    touch: nav.maxTouchPoints > 0,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    heapMb: heap ? Math.round(heap.usedJSHeapSize / MB) : null,
    heapLimitMb: heap ? Math.round(heap.jsHeapSizeLimit / MB) : null,
    net: NETS.find((known) => known === nav.connection?.effectiveType) ?? null,
    saveData: nav.connection?.saveData ?? null,
    discarded: (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true,
    entered: ENTERED.find((known) => known === entry?.type) ?? null,
    // Chrome marks <html> while its translation has the page.
    translated: ['translated-ltr', 'translated-rtl'].some((mark) => document.documentElement.classList.contains(mark)),
    dom: document.querySelectorAll('*').length,
    shadow: shadowed(document),
    errors,
    stalls: stalls(),
    trail: trail.map(({ word, at, n }) => ({ word, ago: Math.round(now - at), n })),
  };
}

// A thrown error's name and where in the app's bundle it went off. Its message and its stack's function names stay out.
export function errorFacts(error: object): { detail: AutoErrorName; cause: AutoErrorCause; place: string | null; frames: string | null } {
  const { name, message, stack } = error as { name?: unknown; message?: unknown; stack?: unknown };
  const frames = typeof stack === 'string' ? [...stack.matchAll(/https?:\/\/[^\s()@]+/g)].flatMap(([url]) => ownScript(url) ?? []).filter((at) => PLACE.test(at)).slice(0, FRAMES) : [];
  const cause = AUTO_BROWSER_MESSAGES.find((known) => known.message === message)?.cause ?? 'other';
  return { detail: AUTO_ERROR_NAMES.find((known) => known === name) ?? 'other', cause, place: frames[0] ?? null, frames: frames.join(' ') || null };
}

export const openFailure = (error: string): AutoDetail => AUTO_OPEN_FAILURES.find((known) => known === error) ?? 'other';

export type AutoOrigin = NonNullable<AutoReport['origin']>;

// id: what else a problem with neither a chat nor a job is one report a page for, never reported itself.
type Problem = { event: AutoEvent; detail?: AutoDetail | null; cause?: AutoErrorCause | null; place?: string | null; frames?: string | null; origin?: AutoReport['origin']; chat?: ChatRead; job?: { id: string; facts: AutoJob }; script?: AutoScript | null; frame?: AutoFrame | null; id?: string | null };

// Never fails its caller, and a report that goes wrong tells no one: this is the app's own note about a problem.
export function autoDiagnose({ event, detail = null, cause = null, place: thrown = null, frames = null, origin = null, chat, job, script = null, frame = null, id = null }: Problem) {
  if (event === 'app-error') errors++;
  if (!armed) return;
  // The origin counts: an error a frame threw and the same one taking the screen down are two things to know.
  const key = JSON.stringify([event, detail, cause, thrown, origin, (chat ?? job)?.id ?? id]);
  if (said.has(key)) return;
  said.add(key);
  try {
    const report = readAutoReport({ event, detail, cause, version: BUILT_VERSION, place: thrown, frames, origin, ...deviceFacts(navigator.userAgent), ...pageFacts(), chat: chat ? chat.read() : onScreen(), job: job?.facts ?? null, script, frame });
    if (report) void fetchApi('diagnoses', { anonymous: true, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report), keepalive: true }).catch(() => {
      // Reporting must not create another report, and a failed report is never queued or retried.
    });
  } catch {
    // Whatever a read of the chat threw, the problem being reported is the caller's to handle, not this one.
  }
}
