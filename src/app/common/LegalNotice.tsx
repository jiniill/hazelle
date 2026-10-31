import { Link, Row, Stack, Text } from '../ui';
import { HOSTED } from '../../contracts/installation';
import { selfHost } from '../../runtime/installation';
import { INSTALL_GUIDE, OPERATOR, OUTBOUND, PRIVACY, REPOSITORY, TERMS } from './legal';
import { BUILT_VERSION } from '../../runtime/installation';
import { PULSE } from './words';

// The notices GPLv3 §5(d) has an interactive program show, with AGPL-3.0 §13's offer of the running version's
// source. It shows before sign-in too: the page's code reaches a browser that never makes an account.
// scripts/source.sh writes both files at build, so the dev server has neither.
// The archive is the offer that holds for any image, one built from a fork included; the repository link is this
// repository's tag, so it does not replace the archive.
export function LegalNotice() {
  const source = BUILT_VERSION ? `${REPOSITORY}/tree/${BUILT_VERSION}` : REPOSITORY;
  return (
    <Stack gap="related">
      <Text variant="note">
        © 2026 {OPERATOR}. AGPL-3.0에 따라 누구나 쓰고, 수정하고, 다시 배포할 수 있는 자유 소프트웨어예요. 보증은 제공하지 않아요.
      </Text>
      <Row kind="tags">
        <Link href={source}>GitHub</Link>
        <Link href={INSTALL_GUIDE}>내 기기에 설치</Link>
        <Link href="/source.tar.gz" download="hazelle-source.tar.gz">
          소스 코드 받기
        </Link>
        <Link href="/license.txt">라이선스 전문</Link>
        {selfHost() ? (
          <>
            <Link href={OUTBOUND.path}>{OUTBOUND.title}</Link>
            <Link href={HOSTED + PRIVACY.path}>hazelle.app {PRIVACY.title}</Link>
            <Link href={HOSTED + PULSE.path}>{PULSE.title}</Link>
          </>
        ) : (
          <>
            <Link href={TERMS.path}>{TERMS.title}</Link>
            <Link href={PRIVACY.path}>{PRIVACY.title}</Link>
            <Link href={PULSE.path}>{PULSE.title}</Link>
          </>
        )}
      </Row>
    </Stack>
  );
}
