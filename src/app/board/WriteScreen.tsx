import { Globe, Lock } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CATEGORIES, MAX_POST_LENGTH, MAX_TITLE_LENGTH, type Category, type Post } from '../../contracts/board';
import { editPost, readPost, writePost } from '../../runtime/board';
import { stateFacts } from '../../runtime/diagnostic-state';
import { diagnosticReport, lastPlace } from '../../runtime/diagnostics';
import { describeFailure } from '../common/failure';
import { BUILT_VERSION } from '../../runtime/installation';
import { useAttempt } from '../common/useAttempt';
import { CATEGORY_LOOK } from '../common/postRow';
import { readPersisted } from '../common/usePersisted';
import { useLoaded } from '../common/useLoaded';
import { BOARD, DIAGNOSIS_NOTE } from '../common/words';
import { useAccount, useSession, useStanding } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, Checkbox, ChoiceGroup, NavBar, Row, Screen, Stack, Tag, Text, TextField } from '../ui';
import { useNicknameGate } from './nickname';
import { counted } from './parts';

// What a bug report needs, laid into an empty text when 버그 is picked and taken out again, untouched, when it is not.
const BUG_TEMPLATE = '재현 순서\n1. \n2. \n\n기대한 결과\n\n실제 결과\n';

// A new post's words kept on this device as they are typed, until it is posted or cleared: leaving the page loses
// nothing. Per account, since a device may hold several.
type Draft = { title: string; text: string; category: Category | null; toOperator: boolean };
const draftKey = (username: string) => `risu-alpha:board-draft:${username}`;
function parseDraft(stored: string): Draft | null {
  const draft: unknown = JSON.parse(stored);
  if (typeof draft !== 'object' || draft === null) return null;
  const { title, text, category, toOperator } = draft as Record<string, unknown>;
  if (typeof title !== 'string' || typeof text !== 'string' || typeof toOperator !== 'boolean') return null;
  return { title, text, category: CATEGORIES.find((each) => each === category) ?? null, toOperator };
}
function keepDraft(key: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {
    // Kept for this page only.
  }
}

const CATEGORY_CARDS = CATEGORIES.map((value) => ({
  value,
  label: BOARD.categories[value],
  sub: CATEGORY_LOOK[value].sub,
  mark: <Tag hue={CATEGORY_LOOK[value].hue} icon={CATEGORY_LOOK[value].icon} />,
}));
type Reach = 'public' | 'operator';
const REACH_CARDS: { value: Reach; label: string; sub: string; mark: ReactNode }[] = [
  { value: 'public', label: '모두에게', sub: '누구나 읽을 수 있어요', mark: <Tag icon={Globe} /> },
  { value: 'operator', label: BOARD.operatorOnly, sub: '운영자와 나만 읽어요. 오류 제보에 좋아요', mark: <Tag icon={Lock} /> },
];

// A post read for its edit; only its title, text and category change (runtime/board editPost).
export function EditScreen({ id, back }: { id: number; back: Back }) {
  const loaded = useLoaded(() => readPost(id), [id]);
  if (!loaded.data) return (
    <Screen width="form" top={<NavBar title="글 수정" {...backBar(back)} />}>
      {loaded.loading}
      {loaded.failure}
    </Screen>
  );
  return <WriteScreen key={id} editing={loaded.data.post} operator={false} back={back} />;
}

// operator: 운영자에게만 preset, as 설정 › 계정 and 내 글 open it. A suspended account writes nothing else (design §6.13).
export function WriteScreen({ editing, operator, category: preset, back }: { editing: Post | null; operator: boolean; category?: Category; back: Back }) {
  const { suspended } = useStanding();
  const session = useSession();
  const { username } = session;
  const { admin } = useAccount();
  const { gate, dialog } = useNicknameGate();
  const key = draftKey(username);
  const [restored] = useState(() => (editing ? null : readPersisted(key, parseDraft, null)));
  // An error report is what an operator-only post most often is.
  const fresh = operator ? 'bug' : (preset ?? null);
  const start = editing ?? restored ?? { title: '', text: fresh === 'bug' ? BUG_TEMPLATE : '', category: fresh };
  const [title, setTitle] = useState(start.title);
  const [text, setText] = useState(start.text ?? '');
  const [category, setCategory] = useState<Category | null>(start.category);
  const [toOperator, setToOperator] = useState(operator || (restored?.toOperator ?? false));
  const [fromDraft, setFromDraft] = useState(restored !== null);
  // On by default: an error report is rarely answerable without it.
  const [withReport, setWithReport] = useState(true);
  // What was shown is what goes: read once, not again at the press.
  const [report, setReport] = useState<string | null>(null);
  const { busy, failure, run } = useAttempt();
  const titled = counted(title, MAX_TITLE_LENGTH);
  const body = counted(text, MAX_POST_LENGTH);
  // 소식 is public, whatever the reach was before it was picked.
  const news = category === 'news';
  const operatorOnly = (toOperator || suspended) && !news;
  const blank = title.trim() === '' && (text.trim() === '' || text === BUG_TEMPLATE);
  const attaching = !editing && operatorOnly && withReport;
  // The report says what happened by itself, so it may go without the template filled in.
  const ready = titled.length > 0 && !titled.over && body.length > 0 && (text !== BUG_TEMPLATE || attaching) && !body.over && category !== null && (!attaching || report !== null);

  useEffect(() => {
    if (attaching && report === null) void diagnosticReport(BUILT_VERSION, stateFacts(session, lastPlace())).then(setReport);
  }, [attaching]);

  useEffect(() => {
    if (!editing) keepDraft(key, blank ? null : { title, text, category, toOperator });
  }, [editing, key, blank, title, text, category, toOperator]);

  function pick(next: Category) {
    if (next === 'bug' && text.trim() === '') setText(BUG_TEMPLATE);
    if (next !== 'bug' && text === BUG_TEMPLATE) setText('');
    setCategory(next);
  }

  function clearDraft() {
    setTitle('');
    setText(category === 'bug' ? BUG_TEMPLATE : '');
    setFromDraft(false);
  }

  const send = (picked: Category) =>
    run(async () => {
      const fields = { title: title.trim(), text: text.trim(), category: picked };
      if (editing) {
        const saved = await editPost(editing.id, fields);
        if (!saved.ok) return describeFailure(saved);
        navigate({ kind: 'post', id: editing.id }, { replace: true });
        return null;
      }
      const written = await writePost({ ...fields, visibility: operatorOnly ? 'operator' : 'public', diagnostics: attaching ? report : null });
      if (!written.ok) return describeFailure(written);
      keepDraft(key, null);
      navigate({ kind: 'post', id: written.data.id }, { replace: true });
      return null;
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || category === null) return;
    const picked = category;
    gate(() => void send(picked));
  }

  return (
    <Screen
      width="form"
      top={<NavBar title={editing ? '글 수정' : BOARD.write} {...backBar(back)} />}
      onSubmit={submit}
      actions={
        <Button type="submit" busy={busy} disabled={!ready}>
          {editing ? '저장' : '올리기'}
        </Button>
      }
    >
      {fromDraft && (
        <Row kind="spread">
          <Text variant="note">쓰던 글을 불러왔어요.</Text>
          <Button variant="link" size="xs" onClick={clearDraft}>
            새로 쓰기
          </Button>
        </Row>
      )}
      <ChoiceGroup label="분류" showLabel options={admin ? CATEGORY_CARDS : CATEGORY_CARDS.filter(({ value }) => value !== 'news')} value={category} onChange={pick} layout="cards" />
      <TextField label="제목" value={title} onChange={setTitle} placeholder="한 줄로 요약해 주세요" hint={titled.hint} error={titled.error} />
      <TextField label="내용" lines={12} value={text} onChange={setText} hint={body.hint} error={body.error} />
      {!editing &&
        !news &&
        (suspended ? (
          <Text variant="note">정지된 계정은 운영자에게만 보낼 수 있어요.</Text>
        ) : (
          <ChoiceGroup label="공개 범위" showLabel options={REACH_CARDS} value={operatorOnly ? 'operator' : 'public'} onChange={(reach) => setToOperator(reach === 'operator')} layout="cards" />
        ))}
      {!editing && operatorOnly && (
        <Stack gap="related">
          <Checkbox label="진단 정보 함께 보내기" checked={withReport} onChange={setWithReport} />
          <Text variant="note">{DIAGNOSIS_NOTE}</Text>
          {attaching && (report === null ? <Text variant="note">진단 정보를 불러오는 중이에요.</Text> : <TextField label="진단 정보" lines={8} value={report} onChange={() => {}} readOnly />)}
        </Stack>
      )}
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
      {dialog}
    </Screen>
  );
}
