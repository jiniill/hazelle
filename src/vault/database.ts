export class DatabaseBlocked extends Error {}

// Reject blocked upgrades rather than hanging; release on versionchange so newer builds can upgrade.
export function cachedDatabase(name: string, version: number, upgrade: (request: IDBOpenDBRequest, event: IDBVersionChangeEvent) => void): () => Promise<IDBDatabase> {
  let opened: Promise<IDBDatabase> | undefined;
  return () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, version);
      let blocked = false;
      req.onupgradeneeded = (event) => upgrade(req, event);
      req.onblocked = () => {
        blocked = true;
        reject(new DatabaseBlocked('An older tab holds the database open'));
      };
      req.onsuccess = () => {
        // A blocked request can still open later, after its caller has already retried.
        if (blocked) return req.result.close();
        req.result.onclose = () => { opened = undefined; };
        req.result.onversionchange = () => {
          req.result.close();
          opened = undefined;
        };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    }).catch((error: unknown) => {
      opened = undefined;
      throw error;
    });
    return opened;
  };
}
