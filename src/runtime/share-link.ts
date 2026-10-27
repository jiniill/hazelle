import { SHARE_ID, type ShareState } from '../contracts/shares';
import type { Stored } from '../model/kinds';
import { SHARE_KEY } from '../vault/shares';
import { api, type ApiResult } from './api';
import type { ObjectStore } from './store';

// Separate link lifecycle from runtime/share content/charx dependencies so permanent removal can cut links cheaply.

export const shareLink = (origin: string, id: string, key: string) => `${origin}/s/${id}#${key}`;

// A share page's address: its id and the key its fragment holds, or null for a path that is no share's. key is null
// for a link cut short of its key.
export function readShareLink(path: string, hash: string): { id: string; key: string | null } | null {
  const id = /^\/s\/([^/]+)$/.exec(path)?.[1];
  if (id === undefined || !SHARE_ID.test(id)) return null;
  const key = hash.slice(1);
  return { id, key: SHARE_KEY.test(key) ? key : null };
}

export const shareOf = (store: ObjectStore, character: string): Stored<'share'> | null => store.children('share', character)[0] ?? null;

// covered: the link's embed carries the opt-in text. removed: the operator blocked it.
export type SharedLink = { id: string; createdAt: number; received: number; held: boolean; removed: boolean; covered: boolean; version: number };
export const readShares = () => api<{ consent: number | null; shares: SharedLink[] }>('GET', 'shares/mine');
export const agreeToShare = () => api<undefined>('PUT', 'shares/consent');

// 링크 끊기. id: the server's, for a link this account's vault no longer names. A link already cut counts as cut.
export async function cutShare(store: ObjectStore, id: string): Promise<ApiResult<null>> {
  const cut = await api<undefined>('DELETE', `shares/${id}`);
  if (!cut.ok && cut.error !== 'not-found') return cut;
  const own = store.list('share').find(({ value }) => value.share === id);
  return own ? store.remove(own.id) : { ok: true, data: null };
}

export const readShareState = (id: string) => api<ShareState>('GET', `shares/${id}`);

export const countReceived = (id: string) => api<undefined>('POST', `shares/${id}/received`);

// link: the full link with its key, which is how the operator opens what was reported.
export const reportShare = (id: string, text: string, link: string, version: number) => api<undefined>('POST', `shares/${id}/reports`, { text, link, version });
