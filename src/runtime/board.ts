import { GUEST_BOARD_HEADER, MAX_DIAGNOSTICS_LENGTH, type Activity, type Category, type Comment, type Compose, type Post, type PostPicture, type PostRow, type Sort, type Status, type Visibility } from '../contracts/board';
import { api, hasAccount, type ApiResult } from './api';
import { page } from './pages';
import { recallGuest } from '../vault/device';
import { guestBoardSecret } from './guest-store';

// Guest authors use browser secrets; votes/reports/nicknames/activity still require account-session routes.
async function guestHeaders(create = false): Promise<ApiResult<Record<string, string>>> {
  if (hasAccount()) return { ok: true, data: {} };
  const guest = await recallGuest();
  if (!guest) return { ok: true, data: {} };
  const secret = await guestBoardSecret(guest.accountId, create);
  return secret.ok ? { ok: true, data: secret.data ? { [GUEST_BOARD_HEADER]: secret.data } : {} } : secret;
}
async function boardApi<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<ApiResult<T>> {
  const headers = await guestHeaders(method !== 'GET');
  return headers.ok ? api<T>(method, path, body, undefined, undefined, headers.data) : headers;
}

// null: not chosen yet, which the board asks for before the first write. The operator has none and needs none.
export const readNickname = () => api<{ name: string | null }>('GET', 'board/name');
export const setNickname = (name: string) => api<undefined>('PUT', 'board/name', { name });

// mine: only what this account wrote. visibility 'operator' lists operator-only posts: one's own, or every one for the
// operator. 'top' sorts by votes; its cursor is the server's (contracts/board PostList).
export type ListAsk = { sort: Sort; category?: Category; status?: Status; visibility?: Visibility; mine?: boolean; limit?: number };
export const readPosts = async (after: string | null, { sort, category, status, visibility, mine, limit }: ListAsk) => {
  const headers = await guestHeaders();
  return headers.ok ? page<'posts', PostRow>('board/posts', 'posts', after, { sort, category, status, visibility, mine, limit }, headers.data) : headers;
};

export const readPost = (id: number) => boardApi<{ post: Post }>('GET', `board/posts/${id}`);
export const writePost = ({ diagnostics, ...compose }: Compose) => boardApi<{ id: number }>('POST', 'board/posts', { ...compose, diagnostics: diagnostics?.slice(0, MAX_DIAGNOSTICS_LENGTH) ?? null });
export const editPost = (id: number, edit: Pick<Compose, 'title' | 'text' | 'category'>) => boardApi<undefined>('PUT', `board/posts/${id}`, edit);
// The author's or the operator's: a post with comments stays as a placeholder (PostRow.deleted).
export const deletePost = (id: number) => boardApi<undefined>('DELETE', `board/posts/${id}`);
// Accounts only: a guest has no picture routes (server/board.ts).
export const addPostPicture = (post: number, bytes: Uint8Array<ArrayBuffer>) => api<PostPicture>('POST', `board/posts/${post}/pictures`, bytes);
export const readPostPicture = (post: number, picture: number) => api<Uint8Array<ArrayBuffer>>('GET', `board/posts/${post}/pictures/${picture}`);
export const deletePostPicture = (post: number, picture: number) => api<undefined>('DELETE', `board/posts/${post}/pictures/${picture}`);
export const votePost = (id: number, voted: boolean) => api<{ votes: number }>('PUT', `board/posts/${id}/vote`, { voted });

export const writeComment = (post: number, text: string, parentId: number | null) => boardApi<{ comment: Comment }>('POST', `board/posts/${post}/comments`, { text, parentId });
export const editComment = (id: number, text: string) => boardApi<undefined>('PUT', `board/comments/${id}`, { text });
export const deleteComment = (id: number) => boardApi<undefined>('DELETE', `board/comments/${id}`);

export const reportPost = (id: number, text: string) => api<undefined>('POST', `board/posts/${id}/reports`, { text });
export const reportComment = (id: number, text: string) => api<undefined>('POST', `board/comments/${id}/reports`, { text });

export const readActivity = (after: string | null, ask: { limit?: number } = {}) => page<'activity', Activity>('board/activity', 'activity', after, ask);
export const markActivitySeen = (newest: number) => api<undefined>('POST', 'board/seen', { id: newest });

// The operator's moves. hidden: a reason and, for a hold (임시조치), its length in days; null shows it again.
export const setPostStatus = (id: number, status: Status, version: string | null) => api<undefined>('PUT', `board/posts/${id}/status`, { status, version });
export const setPostHidden = (id: number, hidden: { reason: string; days: number | null } | null) => api<undefined>('PUT', `board/posts/${id}/hidden`, { hidden });
export const setPostLocked = (id: number, locked: boolean) => api<undefined>('PUT', `board/posts/${id}/locked`, { locked });
export const setCommentHidden = (id: number, hidden: { reason: string; days: number | null } | null) => api<undefined>('PUT', `board/comments/${id}/hidden`, { hidden });

export const blockGuestPost = (id: number) => api<undefined>('PUT', `board/posts/${id}/guest-block`);
export const blockGuestComment = (id: number) => api<undefined>('PUT', `board/comments/${id}/guest-block`);
