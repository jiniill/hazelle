import { Fragment } from 'react';
import { Brand, Bullets, Button, Callout, Contents, ControlName, Disclosure, Figure, HowTo, Intro, Link, List, ListItem, PathBar, Screen, Section, Stack, Table, Text } from '../ui';
import { GUIDE_INDEX, GUIDE_TOPICS, GUIDE_WORDS, GUIDES, guideMeta, spans, type Guide, type GuideBlock, type GuideStep, type GuideTopic } from '../../contracts/guides';
import { OPEN_APP } from '../../contracts/start';
import { LegalNotice } from '../common/LegalNotice';

// main.tsx asks before the account flow, so a guide reads the same signed in or out.
export function guidePage(path: string) {
  if (path === GUIDE_INDEX.path) return <GuideIndex />;
  const guide = GUIDES.find((each) => each.path === path);
  return guide ? <GuideText guide={guide} /> : null;
}

const TOP = (
  <>
    <Brand />
    <Link href="/">{OPEN_APP}</Link>
  </>
);

const go = (path: string) => () => location.assign(path);

function GuideIndex() {
  const topics = (Object.entries(GUIDE_TOPICS) as [GuideTopic, string][]).map(([topic, name]) => [name, GUIDES.filter((guide) => guide.topic === topic)] as const);
  return (
    <Screen top={TOP} foot={<LegalNotice />}>
      <Intro title={GUIDE_INDEX.title}>{GUIDE_INDEX.line}</Intro>
      {topics.map(
        ([name, guides]) =>
          guides.length > 0 && (
            <Section key={name} title={name}>
              <List label={name} box places>
                {guides.map((guide) => (
                  <ListItem key={guide.path} title={guide.title} description={guide.line} onClick={go(guide.path)} />
                ))}
              </List>
            </Section>
          ),
      )}
    </Screen>
  );
}

function Said({ text }: { text: string }) {
  return spans(text).map((span, index) => <Fragment key={index}>{span.control ? <ControlName>{span.text}</ControlName> : span.text}</Fragment>);
}

const step = (each: GuideStep) =>
  typeof each === 'string' ? { key: each, content: <Said text={each} /> } : { key: each.text, content: <Said text={each.text} />, note: each.note && <Said text={each.note} />, figure: each.picture && <Figure {...each.picture} /> };

function Block({ block }: { block: GuideBlock }) {
  if (typeof block === 'string') return <Text><Said text={block} /></Text>;
  if ('steps' in block) return <HowTo steps={block.steps.map(step)} />;
  if ('list' in block) return <Bullets items={block.list} />;
  if ('table' in block) {
    const { columns, rows } = block.table;
    return <Table variant="read" label={columns[0]!} columns={columns.map((label, index) => (index === 0 ? { label, track: 'name' } : { label, track: 'fill', keep: true }))} rows={rows.map((cells) => ({ key: cells[0]!, cells }))} />;
  }
  return 'tip' in block ? <Callout tone="tip"><Said text={block.tip} /></Callout> : <Callout tone="warn"><Said text={block.warn} /></Callout>;
}

function GuideText({ guide }: { guide: Guide }) {
  const path = [
    { key: 'guide', name: GUIDE_WORDS.path, onClick: go(GUIDE_INDEX.path) },
    { key: guide.topic, name: GUIDE_TOPICS[guide.topic], onClick: go(GUIDE_INDEX.path) },
  ];
  return (
    <Screen
      top={TOP}
      lead={
        <Stack gap="related">
          <PathBar label="위치" parts={path} />
          <Intro title={guide.title}>{guide.line}</Intro>
          <Text variant="note">{guideMeta(guide)}</Text>
        </Stack>
      }
      aside={<Contents label={GUIDE_WORDS.contents} items={guide.sections} />}
      asideSize="sm"
      stickyAside
      foot={<LegalNotice />}
    >
      <Section title={GUIDE_WORDS.needs}>
        <Bullets items={guide.needs} />
      </Section>
      {guide.sections.map((section) => (
        <Section key={section.id} anchor={section.id} title={section.title}>
          <Stack gap="related">
            {section.blocks.map((block, index) => (
              <Block key={index} block={block} />
            ))}
          </Stack>
        </Section>
      ))}
      <Section title={GUIDE_WORDS.faq}>
        {guide.faq.map(({ question, answer }) => (
          <Disclosure key={question} label={question}>
            <Text><Said text={answer} /></Text>
          </Disclosure>
        ))}
      </Section>
      <Section title={guide.end.title}>
        <Text>{guide.end.line}</Text>
        <Button size="xl" onClick={go(guide.end.link)}>
          {guide.end.label}
        </Button>
      </Section>
    </Screen>
  );
}
