
// Nickname uniqueness ignores case and spacing (nicknameKey).
export const NICKNAME_LENGTH = { min: 2, max: 20 } as const;
// Letters, digits, marks and single inner spaces; nothing that reads as an address, a path or a tag.
const NICKNAME_FORBIDDEN = /[\s@#/\\<>]/u;
export function validNickname(name: string): boolean {
  const words = name.split(' ');
  if (name !== name.trim() || words.some((word) => word === '')) return false;
  const length = [...name].length;
  return length >= NICKNAME_LENGTH.min && length <= NICKNAME_LENGTH.max && !words.some((word) => NICKNAME_FORBIDDEN.test(word));
}
export const nicknameKey = (name: string) => name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
// What the operator writes as; never a nickname anyone else can take.
export const OPERATOR_NAME = '운영자';

export const MAX_TITLE_LENGTH = 80;
export const MAX_POST_LENGTH = 8000;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_REASON_LENGTH = 200;
// A 문제 진단 sent with an operator-only post, clipped to this by the sender.
export const MAX_DIAGNOSTICS_LENGTH = 16000;
// Per account or guest browser, counted over the last 24 hours in the database, so a restart resets nothing.
export const POSTS_PER_DAY = 10;
export const COMMENTS_PER_DAY = 60;
// Pictures on an operator-only post, by its author with an account (design §6.13).
export const MAX_POST_PICTURES = 3;
export const PICTURES_PER_DAY = 9;
export const MAX_PICTURE_BYTES = 2_000_000;
// Shared mobile-carrier addresses need room for several browsers, but not unlimited fresh secrets.
export const GUEST_ADDRESS_CAP_MULTIPLIER = 10;
// 임시조치 (정보통신망법 제44조의2): a reported post is held hidden at most this long.
export const HOLD_DAYS_MAX = 30;

// News stays out of the uncategorized feed. No chat category: feedback only (migration 0019).
export const CATEGORIES = ['bug', 'idea', 'question', 'news'] as const;
export type Category = (typeof CATEGORIES)[number];
// News posts have no status; their version names the release, not resolution of a report.
export const STATUSES = ['open', 'seen', 'working', 'done', 'declined'] as const;
export type Status = (typeof STATUSES)[number];
// operator: the author and the operator alone read it; the only kind a suspended account reads or writes.
export type Visibility = 'public' | 'operator';
export const SORTS = ['new', 'top'] as const;
export type Sort = (typeof SORTS)[number];

// name null with left false means no nickname, possible for migrated or guest-authored posts.
export type Author = { name: string | null; operator: boolean; mine: boolean; left: boolean; guest?: boolean };
// Hidden content is author/operator-only; until null means indefinite.
// Others see no post, or a comment placeholder with text/hidden null and deleted false, never a deletion.
export type Hidden = { reason: string; until: number | null };

export type PostRow = {
  id: number;
  title: string;
  excerpt: string | null;
  category: Category;
  status: Status;
  version: string | null;
  visibility: Visibility;
  author: Author;
  createdAt: number;
  editedAt: number | null;
  votes: number;
  voted: boolean;
  commentCount: number;
  locked: boolean;
  hidden: Hidden | null;
  // The author deleted it while it had comments: the row stays as a placeholder over them, its text gone.
  deleted: boolean;
};
export type Comment = {
  id: number;
  postId: number;
  parentId: number | null;
  // Short guest tags can collide, and converted accounts may have no nickname: match identity on the server.
  byAuthor: boolean;
  author: Author;
  // null once deleted or hidden from the asking account.
  text: string | null;
  createdAt: number;
  editedAt: number | null;
  hidden: Hidden | null;
  deleted: boolean;
};
export type PostPicture = { id: number; type: string };
// diagnostics is operator-only, never exposed with public post text.
export type Post = PostRow & {
  text: string | null;
  pictures: PostPicture[];
  // Only the latest status change time is retained, null before the first change.
  statusAt: number | null;
  diagnostics: string | null;
  // Author account is operator-only and null after departure; enables restore/deletion from a report.
  account: { id: string; username: string } | null;
  comments: Comment[];
};

export type Compose = { title: string; text: string; category: Category; visibility: Visibility; diagnostics: string | null };

export type ActivityKind = 'comment' | 'reply' | 'status';
export type Activity = { id: number; kind: ActivityKind; postId: number; title: string; by: Author; at: number; commentId: number | null; status: Status | null };

// The cursor of a 'top' list is `${votes}:${id}` of the last row shown, since votes order it; a 'new' list cursors on id.
export type PostList = { posts: PostRow[]; next: string | null };

export const GUEST_BOARD_HEADER = 'x-hazelle-board-secret';
export type BoardSettings = { guests: boolean };
