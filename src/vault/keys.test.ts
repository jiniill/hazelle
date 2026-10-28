import { describe, expect, it } from 'vitest';
import { createVault, openVault, passwordCredential, stretchPassword, recoveryCredential, wrapWithPassword } from './keys';

const vaultFor = async (accountId: string, password: string) => {
  const { vaultKey, recoveryKey, signup } = await createVault(accountId, await passwordCredential('jin', password, stretchPassword));
  return { vaultKey, recoveryKey, record: { passwordWrap: signup.passwordWrap, recoveryWrap: signup.recoveryWrap }, signup };
};

describe('vault keys', () => {
  it('opens with the password or the recovery key, and nothing else', async () => {
    const { vaultKey, recoveryKey, record } = await vaultFor('account-1', '비밀번호 하나');

    expect(await openVault('account-1', record, await passwordCredential('jin', '비밀번호 하나', stretchPassword))).toEqual(vaultKey);
    expect(await openVault('account-1', record, await passwordCredential('jin', '다른 비밀번호', stretchPassword))).toBeNull();
    expect(await openVault('account-1', record, (await recoveryCredential(recoveryKey))!)).toEqual(vaultKey);
    const wrongKey = recoveryKey.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
    expect(await openVault('account-1', record, (await recoveryCredential(wrongKey))!)).toBeNull();
  });

  it('gives the server proofs that stay the same for the same input and differ from everything else', async () => {
    const { signup, recoveryKey } = await vaultFor('account-1', '한글비밀번호입니다');
    const nfd = await passwordCredential('jin', '한글비밀번호입니다'.normalize('NFD'), stretchPassword);

    expect(nfd.proof).toBe(signup.passwordProof);
    expect((await recoveryCredential(recoveryKey))!.proof).toBe(signup.recoveryProof);
    expect((await passwordCredential('other', '한글비밀번호입니다', stretchPassword)).proof).not.toBe(signup.passwordProof);
    expect(signup.recoveryProof).not.toBe(signup.passwordProof);
  });

  it('refuses a wrapped key moved to another account', async () => {
    const { record } = await vaultFor('account-1', '비밀번호 하나');
    expect(await openVault('account-2', record, await passwordCredential('jin', '비밀번호 하나', stretchPassword))).toBeNull();
  });

  it('re-wraps the same vault key under a new password', async () => {
    const { vaultKey, record } = await vaultFor('account-1', '예전 비밀번호');
    const next = await wrapWithPassword('account-1', vaultKey, await passwordCredential('jin', '새 비밀번호', stretchPassword));
    const rewrapped = { ...record, passwordWrap: next.passwordWrap };

    expect(await openVault('account-1', rewrapped, await passwordCredential('jin', '새 비밀번호', stretchPassword))).toEqual(vaultKey);
    expect(await openVault('account-1', rewrapped, await passwordCredential('jin', '예전 비밀번호', stretchPassword))).toBeNull();
  });
});
