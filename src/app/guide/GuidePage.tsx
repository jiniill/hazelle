import { Brand, Figure, Intro, Link, Screen, Section, Stack, Text } from '../ui';
import { GUIDE_INDEX, GUIDES, type Guide, type GuideBlock } from '../../contracts/guides';
import { LegalNotice } from '../common/LegalNotice';

// main.tsx asks before the account flow, so a guide reads the same signed in or out.
export function guidePage(path: string) {
  if (path === GUIDE_INDEX.path) return <GuideIndex />;
  const guide = GUIDES.find((each) => each.path === path);
  return guide ? <GuideText guide={guide} /> : null;
}

const OPEN_APP = <Link href="/">헤이젤 열기</Link>;

function GuideIndex() {
  return (
    <Screen top={<Brand />}>
      <Intro title={GUIDE_INDEX.title}>{GUIDE_INDEX.line}</Intro>
      {GUIDES.map((guide) => (
        <Stack key={guide.path} gap="related">
          <Link href={guide.path}>{guide.title}</Link>
          <Text variant="note">{guide.line}</Text>
        </Stack>
      ))}
      {OPEN_APP}
      <LegalNotice />
    </Screen>
  );
}

function Block({ block }: { block: GuideBlock }) {
  if (typeof block === 'string') return <Text>{block}</Text>;
  if ('steps' in block) return block.steps.map((step, index) => <Text key={step}>{`${index + 1}. ${step}`}</Text>);
  if ('picture' in block) return <Figure src={block.picture} alt={block.alt} />;
  return <Link href={block.link}>{block.label}</Link>;
}

function GuideText({ guide }: { guide: Guide }) {
  return (
    <Screen top={<Brand />}>
      <Intro title={guide.title}>{guide.line}</Intro>
      {guide.sections.map((section) => (
        <Section key={section.title} title={section.title}>
          <Stack gap="related">
            {section.blocks.map((block, index) => (
              <Block key={index} block={block} />
            ))}
          </Stack>
        </Section>
      ))}
      {OPEN_APP}
      <LegalNotice />
    </Screen>
  );
}
