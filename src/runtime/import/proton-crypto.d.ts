// tsconfig.base.json maps @protontech/crypto here for `tsc -b` alone (vite.config.ts turns tsconfig paths off): the package
// ships TypeScript sources written for its own compiler settings, which tsc would otherwise check as ours.
export const CryptoProxy: { setEndpoint(endpoint: unknown): void };
export class Api {
  static init(options: object): void;
}
export function getSrp(info: { Version: number; Modulus: string; ServerEphemeral: string; Username: string; Salt: string }, credentials: { username: string; password: string }, version: number): Promise<{ expectedServerProof: string; clientProof: string; clientEphemeral: string }>;
export function computeKeyPassword(password: string, salt: string): Promise<string>;
