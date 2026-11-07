import { expect, it } from 'vitest';
import { placeMark } from '../../model/illustration';
import { markPart, PART_MARK, partOf, typeAt, withPart } from './editPart';

const reply = ['*그녀가 창문을 연다.*', '"오늘은 <span class="x">비가</span> 오네."', '', '그래.', '**잠시** 침묵이 흐른다.', '그래.'].join('\n');

it('finds the paragraphs a selection drawn from the text runs over, and none when it could start in two', () => {
  expect([
    partOf(reply, ['창문을 연']),
    partOf(reply, ['"오늘은 비가 오네."']),
    partOf(reply, ['오네."', '잠시 침']),
    partOf(reply, ['그래.']),
    partOf(reply, ['우산']),
  ]).toEqual([{ from: 0, to: 0 }, { from: 1, to: 1 }, { from: 1, to: 4 }, null, null]);
});

it('writes a part back, an emptied one with its line, and marks it in the drawn text beside a picture', () => {
  const part = { from: 1, to: 1 };
  expect(withPart(reply, part, '"맑네."').split('\n')[1]).toBe('"맑네."');
  expect(withPart(reply, part, '').split('\n')).toHaveLength(5);
  expect(markPart(`${reply.split('\n').slice(0, 2).join('\n')}\n${placeMark(1)}`, { from: 1, to: 2 }).split('\n')).toEqual(['*그녀가 창문을 연다.*', PART_MARK, placeMark(1)]);
});

it('types a key into a part where the selection starts in its drawn paragraph, counting letters past tags and marks', () => {
  expect([typeAt('"오늘은 <span class="x">비가</span> 오네."', '"오늘은 ', '참'), typeAt('**잠시** 침묵', '', '그'), typeAt('그래.', '그래.', '!')]).toEqual([
    { value: '"오늘은 <span class="x">참비가</span> 오네."', caret: 22 },
    { value: '**그잠시** 침묵', caret: 3 },
    { value: '그래.!', caret: 4 },
  ]);
});
