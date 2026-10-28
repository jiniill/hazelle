import { Brand, Intro, Screen, Section, Stack, Text } from '../ui';
import { selfHost } from '../../runtime/installation';
import { EFFECTIVE, OUTBOUND, PRIVACY, TERMS, type LegalText } from './legal';
import { LegalNotice } from './LegalNotice';

// main.tsx asks before the account flow, so the pages read the same signed in or out. A self-host has OUTBOUND alone.
export function legalPage(path: string) {
  const text = (selfHost() ? [OUTBOUND] : [TERMS, PRIVACY]).find((page) => page.path === path);
  return text ? <LegalPage text={text} /> : null;
}

function LegalPage({ text }: { text: LegalText }) {
  return (
    <Screen top={<Brand />}>
      <Intro title={text.title}>{text === OUTBOUND ? '이 헤이젤에서 외부로 전송되는 데이터를 모두 정리했어요.' : `시행일: ${EFFECTIVE}`}</Intro>
      {text.sections.map((section) => (
        <Section key={section.title} title={section.title}>
          <Stack gap="related">
            {section.body.flatMap((block) => (typeof block === 'string' ? [block] : block.map((line) => `· ${line}`))).map((line) => (
              <Text key={line}>{line}</Text>
            ))}
          </Stack>
        </Section>
      ))}
      <LegalNotice />
    </Screen>
  );
}
