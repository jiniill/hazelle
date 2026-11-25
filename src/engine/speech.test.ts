import { describe, expect, it } from 'vitest';
import { speechParts, speechText } from './speech';

describe('speechText', () => {
  it("reads the shown text without its markup, a styled box's rules or a picture", () => {
    const shown = '<style>.box{color:red}</style><div class="box"><b>민서</b>가 웃었다.</div>\n\n**"안녕?"** [링크](https://a.b) &amp; 끝\n![그림](x.png)\n---\n# 제목';
    expect(speechText(shown, false)).toBe('민서가 웃었다.\n"안녕?" 링크 & 끝\n제목');
  });

  it('skips a code block, fenced or drawn, with any quotes inside it', () => {
    const shown = '그가 웃었다.\n```\n[상태] "호감도 +1"\n```\n<pre><code>"로그"</code></pre>\n"가자."\n~~~\n"끝나지 않은 상자';
    expect(speechText(shown, false)).toBe('그가 웃었다.\n"가자."');
    expect(speechText(shown, true)).toBe('가자.');
  });

  it('reads only what stands in quotation marks when asked, a line each', () => {
    expect(speechText('그가 말했다. "가자." 그리고 “늦었어.”\n「여기야」 하고 손짓했다.', true)).toBe('가자.\n늦었어.\n여기야');
    expect(speechText('대사가 없다.', true)).toBe('');
  });
});

describe('speechParts', () => {
  it('starts small and lets each stretch grow, ending between paragraphs', () => {
    const paragraph = 'ㄱ'.repeat(100);
    const parts = speechParts(Array(7).fill(paragraph).join('\n'), 5000);
    expect(parts.map((part) => part.split('\n').length)).toEqual([1, 2, 4]);
    expect(parts.join('\n')).toBe(Array(7).fill(paragraph).join('\n'));
  });

  it('cuts a paragraph longer than its stretch between sentences, else between words, else at the size', () => {
    const sentence = `${'가'.repeat(50)}다."`;
    const paragraph = Array(6).fill(sentence).join(' ');
    const parts = speechParts(`${paragraph}\n끝.`, 5000);
    expect(parts).toEqual([[sentence, sentence].join(' '), [sentence, sentence, sentence, sentence].join(' ') + '\n끝.']);
    expect(speechParts('가나 다라 마바사', 5)).toEqual(['가나 다라', '마바사']);
    expect(speechParts('ㄱ'.repeat(25), 10)).toEqual(['ㄱ'.repeat(10), 'ㄱ'.repeat(10), 'ㄱ'.repeat(5)]);
  });
});
