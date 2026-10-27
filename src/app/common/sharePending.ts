// Keep keyed share arrival in tab sessionStorage across reload/sign-in/unlock, then consume/clear in ShareArrival.
// While pending, main.tsx shows account flow instead of the public share page.
const PENDING = 'hazelle:share-pending';

type Pending = { id: string; key: string };

export function holdPending(pending: Pending) {
  try {
    sessionStorage.setItem(PENDING, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function pendingFor(id: string): string | null {
  try {
    const held = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null') as Pending | null;
    return held?.id === id && typeof held.key === 'string' ? held.key : null;
  } catch {
    return null;
  }
}

export function clearPending() {
  try {
    sessionStorage.removeItem(PENDING);
  } catch {
    // Nothing waits where nothing could be stored.
  }
}
