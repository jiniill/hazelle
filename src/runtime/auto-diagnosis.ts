import { AUTO_ERROR_NAMES, readAutoReport, type AutoChat, type AutoDetail, type AutoErrorName, type AutoEvent, type AutoReport } from '../contracts/auto-diagnosis';
import { without } from '../model/fields';
import { EMPTY_SETTINGS, type Settings } from '../model/settings';
import { fetchApi } from './api';
import { BUILT_VERSION, selfHost } from './installation';
import type { ObjectStore } from './store';

// 자동 진단 (design §6.13): the account's switch, on unless set off. A guest and a self-host send none.
export const sharesDiagnosis = (settings: Settings | undefined) => !selfHost() && settings?.diagnosis !== false;

export const setDiagnosisSharing = (store: ObjectStore, on: boolean) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => (on ? without(current, 'diagnosis') : { ...current, diagnosis: false }));

let armed = false;
// For the page's life: a problem that repeats, as a failure does on each try, is one report per chat.
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

// A thrown error's name and where in the app's bundle it went off. Its message and its stack's function names stay out.
export function errorFacts(error: object): { detail: AutoErrorName; place: string | null } {
  const { name, stack } = error as { name?: unknown; stack?: unknown };
  return {
    detail: AUTO_ERROR_NAMES.find((known) => known === name) ?? 'other',
    place: typeof stack === 'string' ? (/\/assets\/([\w.-]{1,100}\.js:\d{1,9}:\d{1,9})/.exec(stack)?.[1] ?? null) : null,
  };
}

type Problem = { event: AutoEvent; detail?: AutoDetail | null; place?: string | null; chat?: { id: string; read: () => AutoChat | null } };

// Never fails its caller, and a report that goes wrong tells no one: this is the app's own note about a problem.
export function autoDiagnose({ event, detail = null, place = null, chat }: Problem) {
  if (!armed) return;
  const key = JSON.stringify([event, detail, place, chat?.id ?? null]);
  if (said.has(key)) return;
  said.add(key);
  try {
    const report = readAutoReport({ event, detail, version: BUILT_VERSION, place, ...deviceFacts(navigator.userAgent), chat: chat?.read() ?? null });
    if (report) void fetchApi('diagnoses', { anonymous: true, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report), keepalive: true }).catch(() => {});
  } catch {
    // Whatever a read of the chat threw, the problem being reported is the caller's to handle, not this one.
  }
}
