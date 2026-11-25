import { describe, expect, it } from 'vitest';
import { speechParts, speechText } from './speech';

describe('speechText', () => {
  it("reads the shown text without its markup, a styled box's rules or a picture", () => {
    const shown = '<style>.box{color:red}</style><div class="box"><b>민서</b>가 웃었다.</div>\n\n**"안녕?"** [링크](https://a.b) &amp; 끝\n![그림](x.png)\n---\n# 제목';
    expect(speechText(shown, false)).toBe('민서가 웃었다.\n"안녕?" 링크 & 끝\n제목');
  });

  it('reads only what stands in quotation marks when asked, a line each', () => {
    expect(speechText('그가 말했다. "가자." 그리고 “늦었어.”\n「여기야」 하고 손짓했다.', true)).toBe('가자.\n늦었어.\n여기야');
    expect(speechText('대사가 없다.', true)).toBe('');
  });
});

describe('speechParts', () => {
  it('starts small and lets each stretch grow, ending between lines', () => {
    const line = 'ㄱ'.repeat(200);
    const parts = speechParts(Array(8).fill(line).join('\n'), 5000);
    expect(parts.map((part) => part.split('\n').length)).toEqual([1, 2, 5]);
    expect(parts.join('\n')).toBe(Array(8).fill(line).join('\n'));
  });

  it('cuts a line past the limit between sentences, else at the limit', () => {
    expect(speechParts('가나다. 라마바. 사아자.', 10)).toEqual(['가나다. 라마바.', '사아자.']);
    expect(speechParts('ㄱ'.repeat(25), 10)).toEqual(['ㄱ'.repeat(10), 'ㄱ'.repeat(10), 'ㄱ'.repeat(5)]);
  });
});
