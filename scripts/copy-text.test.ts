import { expect, it } from 'vitest';
import { apply, extract, fromText, toText } from './copy-text';

it('writes revised Korean back where it now sits, keeping each template expression and refusing text that would break the code', () => {
  const source = [
    "const A = '저장했어요';",
    'const B = `${count}개 남았어요 ${on ? `켜짐` : \'꺼짐\'}`;',
    "const C = <p title=\"제목\">설명이에요</p>;",
    "type D = '타입';",
  ].join('\n');
  const sources = [{ path: 'x.tsx', source }];
  const entries = extract(sources);
  expect(entries.map((entry) => [entry.kind, entry.text])).toEqual([
    ['string', '저장했어요'],
    ['template', '${count}개 남았어요 ${on ? `켜짐` : \'꺼짐\'}'],
    ['template', '켜짐'],
    ['string', '꺼짐'],
    ['string', '제목'],
    ['jsx', '설명이에요'],
  ]);
  const [a, b, nested, off, title, text] = entries;
  const moved = [{ path: 'x.tsx', source: `// a line added since extract\n${source.replace("'저장했어요'", "'저장됨'")}` }];
  const { written, rejected } = apply(moved, entries, [
    { id: a!.id, text: "저장'했어요" },
    { id: b!.id, text: '${count}개 남음 ${on ? `켜짐` : \'꺼짐\'}' },
    { id: nested!.id, text: '켬' },
    { id: off!.id, text: '끔' },
    { id: title!.id, text: '이름' },
    { id: text!.id, text: '설명 {이에요}' },
  ]);
  expect(rejected.map((each) => [each.id, each.reason])).toEqual([
    [a!.id, 'the source changed since extract'],
    [text!.id, 'JSX text cannot hold { } < >'],
  ]);
  expect(written[0]!.source.split('\n').slice(2, 4)).toEqual(['const B = `${count}개 남음 ${on ? `켬` : \'끔\'}`;', 'const C = <p title="이름">설명이에요</p>;']);
  const quoted = apply(sources, entries, [{ id: a!.id, text: "저장'했어요" }, { id: b!.id, text: '${total}개 남았어요' }, { id: off!.id, text: '꺼\'"짐' }]);
  expect(quoted.rejected.map((each) => each.reason)).toEqual(['the ${…} expressions changed', 'not one string literal in either quotes']);
  expect(quoted.written[0]!.source.split('\n')[0]).toBe('const A = "저장\'했어요";');
});

it('lists copy as numbered lines with {n} slots, and reads `old ⇒ new` answers back, trusting a number only when its line shows that old text', () => {
  const source = [
    "const A = '설정에서 \\'모델\\'을 선택해 주세요.';",
    'const B = `${name} 캐릭터를 ${count}개 옮겼어요.`;',
    "const C = '저장';",
    "const D = '저장';",
  ].join('\n');
  const list = extract([{ path: 'x.ts', source }]);
  expect(toText(list)).toBe("## x.ts\n[1] 설정에서 '모델'을 선택해 주세요.\n[2] {1} 캐릭터를 {2}개 옮겼어요.\n[3] 저장\n[4] 저장\n");
  expect(toText(list, new Map([['x.ts', new Set([2])]]))).toBe('## x.ts\n[2] {1} 캐릭터를 {2}개 옮겼어요.\n');
  const { revised, problems } = fromText(list, [
    "```text\n[1] 설정에서 '모델'을 선택해 주세요. ⇒ '모델'을 설정에서 선택해 주세요.\n[9] {1} 캐릭터를 {2}개 옮겼어요. ⇒ {1} 캐릭터 {2}개를 옮겼어요.\n```",
    '[4] 저장 ⇒ 저장하기\n[1] 저장 ⇒ 보관\n[7] 지어낸 줄 ⇒ 새 줄',
  ]);
  expect(revised).toEqual([
    { id: list[0]!.id, text: "\\'모델\\'을 설정에서 선택해 주세요." },
    { id: list[1]!.id, text: '${name} 캐릭터 ${count}개를 옮겼어요.' },
    { id: list[3]!.id, text: '저장하기' },
  ]);
  expect(problems).toEqual(['[1] 저장: shown on several lines, and not on this one', '[7] 지어낸 줄: no line shows this text']);
  expect(fromText(list, ['[2] {1} 캐릭터를 {2}개 옮겼어요. ⇒ {2}개의 {1} 캐릭터를 옮겼어요.']).problems).toEqual([`2 ${list[1]!.id}: the {n} slots changed`]);
});
