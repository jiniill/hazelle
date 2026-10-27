// Self-hosts report pulse counts and open community links at this shared installation, not their own.
export const HOSTED = 'https://hazelle.app';
// GET /api/release: the newer release a self-host could update to (server/releases.ts), null when it runs the newest.
export type Release = { newer: string | null };
