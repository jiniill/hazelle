import type { SharedState } from '../../contracts/admin';
import { SHARE } from '../common/words';

// A reported share's state as the inbox shows it. 검토됨: the operator lifted a hold, so a later report waits here
// instead of pausing the link (server/shares).
export const shareTags = (shared: SharedState) =>
  [shared.removed ? '차단됨' : shared.cut ? '끊김' : shared.held ? SHARE.held : null, shared.reviewed && !shared.removed ? '검토됨' : null].filter((tag) => tag !== null);
