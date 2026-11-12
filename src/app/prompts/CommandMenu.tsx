import { BookOpen, Braces } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { PromptSort } from '../../model/prompt';
import { useSearch } from '../common/useSearch';
import { COMMAND, SEARCH_RESULTS } from '../common/words';
import { Button, Dialog, Empty, MarkupArea, Menu, MenuHeading, MenuItem, Row, Stack, Text } from '../ui';
import { cbsLanguage } from '../common/code/cbs';
import { COMMANDS, type Command, type GuideId } from '../common/code/cbsCommands';
import { commandSnippet, type Snippet } from './edits';
import { SAMPLE_NOTE, tryExample } from '../common/code/sample';
import { CbsResult } from '../common/code/Trial';
import { GUIDES, type Example } from './guides';

type Props = { sort: PromptSort; onInsert: (snippet: Snippet) => void };

const LABEL = `${COMMAND} 삽입`;
const CBS = cbsLanguage();

export function CommandMenu({ sort, onInsert }: Props) {
  const [guide, setGuide] = useState<GuideId | null>(null);
  return (
    <>
      <Menu
        label={LABEL}
        place="below-end"
        size="lg"
        trigger={(opener) => (
          <Button variant="ghost" size="sm" icon={Braces} {...opener}>
            {LABEL}
          </Button>
        )}
      >
        <Commands sort={sort} onInsert={(command) => onInsert(commandSnippet(command))} onGuide={setGuide} />
      </Menu>
      {guide && <GuideDialog id={guide} onInsert={onInsert} onClose={() => setGuide(null)} />}
    </>
  );
}

const describe = ({ names, what, example }: Command) =>
  [what, example && `예: ${example[0]} → ${example[1]}`, names.length > 1 && `다른 이름: ${names.slice(1).join(', ')}`].filter(Boolean).join(' ');

// Mounted only while the menu is open, so each opening starts with an empty search.
function Commands({ sort, onInsert, onGuide }: { sort: PromptSort; onInsert: (command: Command) => void; onGuide: (id: GuideId) => void }) {
  const groups = COMMANDS.filter((group) => !group.sorts || group.sorts.includes(sort));
  const all = groups.flatMap((group) => group.commands);
  const often = all.filter((command) => command.uses?.[sort]);
  const search = useSearch(all, `${COMMAND} 검색`, (command) => [command.form, ...command.names, command.what]);
  const item = (command: Command, sub = describe(command), key = command.form) => <MenuItem key={key} label={command.form} description={sub} onClick={() => onInsert(command)} />;
  const guideItem = (id: GuideId, sub?: string) => <MenuItem key={`guide:${id}`} icon={BookOpen} label={`${GUIDES[id].title} 사용법`} description={sub} onClick={() => onGuide(id)} />;

  return (
    <>
      {search.field}
      {search.words ? (
        search.none === null ? (
          <>
            <MenuHeading>{SEARCH_RESULTS}</MenuHeading>
            {search.found.map((command) => item(command))}
          </>
        ) : (
          <Empty variant="menu">{search.none}</Empty>
        )
      ) : (
        <>
          {guideItem('basics')}
          <MenuHeading>자주 쓰는 명령어</MenuHeading>
          {often.map((command) => item(command, command.uses![sort], `often:${command.form}`))}
          {groups.map((group) => (
            <Fragment key={group.title}>
              <MenuHeading>{group.title}</MenuHeading>
              {group.guide && guideItem(group.guide)}
              {group.commands.map((command) => item(command))}
            </Fragment>
          ))}
        </>
      )}
    </>
  );
}

function GuideDialog({ id, onInsert, onClose }: { id: GuideId; onInsert: (snippet: Snippet) => void; onClose: () => void }) {
  const { title, steps } = GUIDES[id];
  const insert = (text: string) => {
    onInsert({ text, select: [text.length, text.length] });
    onClose();
  };
  return (
    <Dialog title={`${title} 사용법`} note={SAMPLE_NOTE} onClose={onClose}>
      <Stack gap="section">
        {steps.map(({ text, example }) => (
          <Stack key={text} gap="related">
            <Text>{text}</Text>
            {example && <Tryout example={example} onInsert={insert} />}
          </Stack>
        ))}
      </Stack>
    </Dialog>
  );
}

// The example stays editable, so the reader can change it and see what that gives.
function Tryout({ example, onInsert }: { example: Example; onInsert: (text: string) => void }) {
  const [written, setWritten] = useState(example.written);
  const result = tryExample(written, example.inMessage);
  return (
    <Stack gap="related">
      <MarkupArea label="예시" variant="field" language={CBS} value={written} onChange={setWritten} />
      <CbsResult result={result} />
      <Row kind="actions">
        <Button variant="ghost" size="xs" onClick={() => onInsert(written)}>
          이 예시 삽입
        </Button>
      </Row>
    </Stack>
  );
}
