import { GENERIC } from '../connectors/registry';
import type { Connection } from '../connectors/types';
import { DIRECT_TYPE, type PulseAnswer, type PulseLabel, type PulseRole, type PulseWeek } from '../contracts/pulse';
import { without } from '../model/fields';
import { EMPTY_SETTINGS, type Settings } from '../model/settings';
import { api } from './api';
import { selfHost } from './installation';
import type { CallPurpose } from './request-log';
import type { ObjectStore } from './store';

// 헤이젤 나우 (design §6.12): the account's switch, on unless set off. A self-host's board is hazelle.app's, which counts
// its own accounts only, so a self-host labels nothing.
export const sharesPulse = (settings: Settings | undefined) => !selfHost() && settings?.pulse !== false;

export const setPulseSharing = (store: ObjectStore, on: boolean) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => (on ? without(current, 'pulse') : { ...current, pulse: false }));

// The public board, signed in or not.
export const readPulse = (signal?: AbortSignal) => api<PulseAnswer>('GET', 'pulse', undefined, signal);
export const readPulseWeek = (from: number, signal?: AbortSignal) => api<PulseWeek>('GET', `pulse/weeks/${from}`, undefined, signal);

export const PULSE_ROLE: Record<CallPurpose, PulseRole> = {
  reply: 'chat',
  translation: 'aux',
  input: 'aux',
  note: 'aux',
  memory: 'aux',
  script: 'aux',
  illustration: 'aux',
  likeness: 'aux',
  mascot: 'aux',
  preread: 'aux',
  agent: 'aux',
  embedding: 'embedding',
};

export const callLabel = (role: PulseRole, connection: Connection, model: string): PulseLabel => ({ kind: 'call', role, type: connection.type === GENERIC ? DIRECT_TYPE : connection.type, model });
