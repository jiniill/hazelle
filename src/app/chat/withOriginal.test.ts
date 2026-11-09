import { expect, it } from 'vitest';
import { placeMark, withMarks } from '../../model/illustration';
import { ORIGINAL_MARK as O } from '../ui';
import { withOriginal } from './withOriginal';

it('follows each translated paragraph with its original when the counts match', () => {
  expect(withOriginal('하나\n<hr>\n둘', 'One\n<hr>\nTwo')).toBe(`하나\n\nOne${O}\n\n<hr>\n둘\n\nTwo${O}\n`);
});

it('pairs by alignment where the translation drops a heading and splits a paragraph', () => {
  const original = [
    'His laugh shook through his chest and into her cheek. His hand went back to her hair, palm sliding down the waves like he was smoothing a cat.',
    '## Chapter 3: The Short List',
    'Koyomi stayed where she was for a moment. Then she lifted her head.',
    '"Excuse me?"',
    'Not about the last part. The last part was silly. The part before it.',
    '"Who doesn\'t have friends? You?" She pulled back just enough to frown at him properly. "You have friends. You have... "',
    'She opened her mouth to list them and found the list was shorter than she\'d meant it to be.',
    'Okay. Fine. He didn\'t go out. He didn\'t do the thing where men stood around a grill on Sunday holding drinks and talking about torque. When people called the house, it was usually about work, and when it was about work, he got that flat, patient voice that made the person on the other end talk faster. That wasn\'t friends. She knew that wasn\'t friends.',
    'But still.',
  ];
  const translated = [
    '그의 웃음소리가 가슴을 타고 그녀의 뺨까지 전해졌다. 그의 손은 다시 그녀의 머리카락으로 향했고, 고양이를 쓰다듬듯 부드럽게 물결치는 머릿결을 따라 손바닥이 미끄러졌다.',
    '코요미는 잠시 그대로 머물러 있었다. 그러다 고개를 슥 들어 올렸다.',
    '"뭐라고?"',
    '뒷부분이 아니라, 그 앞부분에 대한 반응이었다. 뒷부분은 그냥 바보 같은 소리였지만.',
    '"친구 없는 사람이 누구라고? 당신이?" 그녀는 그를 제대로 쏘아붙이기 위해 몸을 살짝 떼고 미간을 찌푸렸다. "당신 친구 있잖아. 예를 들면..."',
    '그녀는 친구들의 이름을 쭉 읊으려 입을 열었지만, 생각보다 목록이 너무 짧다는 사실을 깨달았다.',
    '그래, 인정한다. 그는 밖으로 잘 나가지 않았다. 일요일마다 남자들이 그릴 앞에 모여 술잔을 들고 토크(torque)니 뭐니 떠드는 그런 분위기에도 끼지 않았다.',
    '집에 전화가 오는 건 대개 업무 관련이었고, 그럴 때면 그는 상대방이 말을 더 빨리 하게 만드는 특유의 낮고 인내심 어린 목소리로 응대했다. 그건 친구라고 할 수 없었다. 그녀도 잘 알고 있었다.',
    '그래도.',
  ];
  const under = (original: string) => `\n${original}${O}\n`;
  // The heading stands under the paragraph before it; the split paragraph's two halves share one original.
  const pairs = [[0, 1], [2], [3], [4], [5], [6], [], [7], [8]].map((indices, index) => [translated[index]!, ...indices.map((at) => under(original[at]!))].join('\n'));
  expect(withOriginal(translated.join('\n'), original.join('\n'))).toBe(pairs.join('\n'));
});

it('finds where a run of like paragraphs lost one by the numbers both sides hold', () => {
  const original = ['Room 101 was empty.', 'Room 102 was empty too.', 'Room 103 was dark.', 'Room 104 was locked.'];
  const translated = ['101호는 비어 있었다.', '103호는 어두웠다.', '104호는 잠겨 있었다.'];
  const under = (at: number) => `\n${original[at]}${O}\n`;
  expect(withOriginal(translated.join('\n'), original.join('\n'))).toBe([translated[0], under(0), under(1), translated[1], under(2), translated[2], under(3)].join('\n'));
});

it("keeps a picture's mark after its translated paragraph and that paragraph's original", () => {
  expect(withOriginal(withMarks('하나\n둘', new Set([0])), 'One\nTwo')).toBe(`하나\n\nOne${O}\n\n${placeMark(0)}\n둘\n\nTwo${O}\n`);
});

it('pairs a line of speech and its tag with the translation that merged them tag first', () => {
  const original = ['She looked up at him, eyes wide.', '"Anything,"', 'he whispered.', 'For a while neither of them moved.'];
  const translated = ['그녀가 눈을 동그랗게 뜨고 그를 올려다보았다.', '그가 속삭였다. "뭐든지."', '한동안 둘 다 움직이지 않았다.'];
  const under = (at: number) => `\n${original[at]}${O}\n`;
  expect(withOriginal(translated.join('\n'), original.join('\n'))).toBe([translated[0], under(0), translated[1], under(1), under(2), translated[2], under(3)].join('\n'));
});

it('pairs a paragraph of speech, tag and speech with the three lines its translation broke it into', () => {
  const original = ['She opened the door.', '"You\'re back?" he asked. "Just now?"', 'She hung up her coat without answering.', 'The kitchen light was still on.', '"I\'m hungry."'];
  const translated = ['그녀가 문을 열었다.', '"왔어?"', '그가 물었다.', '"방금 온 거야?"', '그녀는 대답 없이 코트를 벗어 걸었다.', '부엌 불은 아직 켜져 있었다.', '"배고파."'];
  const under = (at: number) => `\n${original[at]}${O}\n`;
  const pairs = [[0], [], [], [1], [2], [3], [4]].map((indices, index) => [translated[index]!, ...indices.map(under)].join('\n'));
  expect(withOriginal(translated.join('\n'), original.join('\n'))).toBe(pairs.join('\n'));
});

it('pairs a paragraph with the four lines its translation broke it into', () => {
  const original = ['She opened the door.', '"You\'re back?" he asked, and set down his cup. "Just now?" He looked at the clock.', 'She hung up her coat without answering.', '"I\'m hungry."'];
  const translated = ['그녀가 문을 열었다.', '"왔어?"', '그가 컵을 내려놓으며 물었다.', '"방금 온 거야?"', '그는 시계를 올려다보았다.', '그녀는 대답 없이 코트를 벗어 걸었다.', '"배고파."'];
  const under = (at: number) => `\n${original[at]}${O}\n`;
  const pairs = [[0], [], [], [], [1], [2], [3]].map((indices, index) => [translated[index]!, ...indices.map(under)].join('\n'));
  expect(withOriginal(translated.join('\n'), original.join('\n'))).toBe(pairs.join('\n'));
});

it('keeps a fenced code block whole, shown once, and pairs the prose around it', () => {
  const block = ['```', 'A', '```'];
  const translated = [...block, '', '나', '', '~~~js', 'C', '~~~'];
  const original = [...block, '', 'B', '', '~~~js', 'C', '~~~'];
  expect(withOriginal(translated.join('\n'), original.join('\n'))).toBe([...block, '', '나', `\nB${O}\n`, '', '~~~js', 'C', '~~~'].join('\n'));
});
