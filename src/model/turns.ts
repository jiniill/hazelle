import type { Account, Connection, Group, Turns } from '../connectors/types';
import { moved } from './fields';

export const DEFAULT_DAY = 16;

const modulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

// Months counted from year 0, local time; a month's turn starts on day, so before it the month before's runs.
export function cycleOf(now: number, day: number): number {
  const date = new Date(now);
  const month = date.getFullYear() * 12 + date.getMonth();
  return date.getDate() < day ? month - 1 : month;
}

export const cycleStart = (cycle: number, day: number): number => new Date(Math.floor(cycle / 12), modulo(cycle, 12), day).getTime();

// window: when the current group's turn started and ends; null with one group, whose turn never ends.
// timeline: one round from the current group, each with its turn's start and end.
export type Schedule = { cycle: number; active: Group; next: Group; window: { start: number; end: number } | null; timeline: { group: Group; startsAt: number; endsAt: number }[] };

export function schedule(turns: Turns, now: number): Schedule {
  const cycle = cycleOf(now, turns.day);
  const { groups } = turns;
  const anchor = groups.findIndex((group) => group.id === turns.anchor.group);
  const at = modulo(anchor + cycle - turns.anchor.cycle, groups.length);
  return {
    cycle,
    active: groups[at]!,
    next: groups[modulo(at + 1, groups.length)]!,
    window: groups.length > 1 ? { start: cycleStart(cycle, turns.day), end: cycleStart(cycle + 1, turns.day) } : null,
    timeline: groups.map((_, offset) => ({ group: groups[modulo(at + offset, groups.length)]!, startsAt: cycleStart(cycle + offset, turns.day), endsAt: cycleStart(cycle + offset + 1, turns.day) })),
  };
}

export function onTurn(connection: Connection, now: number): Account[] {
  if (!connection.turns) return connection.accounts;
  const ids = schedule(connection.turns, now).active.accounts;
  return ids.flatMap((id) => connection.accounts.filter((account) => account.id === id));
}

export const firstTurns = (group: string, account: string): Turns => ({ day: DEFAULT_DAY, groups: [{ id: group, name: '그룹 1', accounts: [account] }], anchor: { group, cycle: 0 } });

export const groupOf = (turns: Turns, account: string): Group | undefined => turns.groups.find((group) => group.accounts.includes(account));

// The stored order starts from the current group, so a group moved or added never lands inside the round mid-turn.
function anchored(turns: Turns, now: number): Turns {
  const { cycle, timeline } = schedule(turns, now);
  const groups = timeline.map(({ group }) => group);
  return { ...turns, groups, anchor: { group: groups[0]!.id, cycle } };
}

export function addGroup(turns: Turns, id: string, now: number): Turns {
  const from = anchored(turns, now);
  let number = from.groups.length + 1;
  while (from.groups.some((group) => group.name === `그룹 ${number}`)) number++;
  return { ...from, groups: [...from.groups, { id, name: `그룹 ${number}`, accounts: [] }] };
}

export const renameGroup = (turns: Turns, id: string, name: string): Turns => ({ ...turns, groups: turns.groups.map((group) => (group.id === id ? { ...group, name } : group)) });

// The current group keeps its place; making another current is takeTurn's.
export function moveGroup(turns: Turns, id: string, by: -1 | 1, now: number): Turns | null {
  const from = anchored(turns, now);
  const index = from.groups.findIndex((group) => group.id === id);
  const to = index + by;
  if (index < 1 || to < 1 || to >= from.groups.length) return null;
  return { ...from, groups: moved(from.groups, index, to) };
}

// Only an empty group, never the last. Removing the current group hands its turn to the next.
export function removeGroup(turns: Turns, id: string, now: number): Turns | null {
  const group = turns.groups.find((entry) => entry.id === id);
  if (!group || group.accounts.length || turns.groups.length === 1) return null;
  const { active, next, cycle } = schedule(turns, now);
  return { ...turns, groups: turns.groups.filter((entry) => entry.id !== id), anchor: { group: active.id === id ? next.id : active.id, cycle } };
}

export const takeTurn = (turns: Turns, id: string, now: number): Turns => ({ ...turns, anchor: { group: id, cycle: cycleOf(now, turns.day) } });

export function setDay(turns: Turns, day: number, now: number): Turns {
  const { active } = schedule(turns, now);
  return { ...turns, day, anchor: { group: active.id, cycle: cycleOf(now, day) } };
}

export function moveAccount(turns: Turns, account: string, to: string): Turns {
  return { ...turns, groups: turns.groups.map((group) => (group.id === to ? { ...group, accounts: [...group.accounts.filter((id) => id !== account), account] } : { ...group, accounts: group.accounts.filter((id) => id !== account) })) };
}

export function moveAccountOrder(turns: Turns, account: string, by: -1 | 1): Turns | null {
  const group = groupOf(turns, account);
  if (!group) return null;
  const index = group.accounts.indexOf(account);
  const to = index + by;
  if (to < 0 || to >= group.accounts.length) return null;
  return { ...turns, groups: turns.groups.map((entry) => (entry.id === group.id ? { ...entry, accounts: moved(group.accounts, index, to) } : entry)) };
}

export function signedIn(connection: Connection & { turns: Turns }, account: Account, now: number): Connection {
  const same = connection.accounts.find((entry) => entry.name === account.name);
  if (same) return { ...connection, accounts: connection.accounts.map((entry) => (entry === same ? { ...entry, secret: account.secret } : entry)) };
  const { active } = schedule(connection.turns, now);
  return { ...connection, accounts: [...connection.accounts, account], turns: { ...connection.turns, groups: connection.turns.groups.map((group) => (group.id === active.id ? { ...group, accounts: [...group.accounts, account.id] } : group)) } };
}

// Never the last account: removing the connection does that.
export function removeAccount(connection: Connection & { turns: Turns }, id: string): Connection | null {
  if (connection.accounts.length === 1 || !connection.accounts.some((account) => account.id === id)) return null;
  return { ...connection, accounts: connection.accounts.filter((account) => account.id !== id), turns: { ...connection.turns, groups: connection.turns.groups.map((group) => ({ ...group, accounts: group.accounts.filter((entry) => entry !== id) })) } };
}

// 되돌리기 of removeAccount: back at its place, or last in the current group when its group went meanwhile.
export function putBack(connection: Connection & { turns: Turns }, account: Account, group: string, index: number, now: number): Connection | null {
  if (connection.accounts.some((entry) => entry.id === account.id)) return null;
  const into = connection.turns.groups.some((entry) => entry.id === group) ? group : schedule(connection.turns, now).active.id;
  return { ...connection, accounts: [...connection.accounts, account], turns: { ...connection.turns, groups: connection.turns.groups.map((entry) => (entry.id === into ? { ...entry, accounts: entry.accounts.toSpliced(index, 0, account.id) } : entry)) } };
}
