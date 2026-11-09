import { describe, expect, it } from 'vitest';
import { cardSource, convert } from './convert';
import { activeOnboarding, answered, readOnboarding, toggled } from './onboarding';

const risu = {
  enabled: true,
  mode: 'form',
  title: '시작',
  questions: [
    { id: 'q1', title: '언어', type: 'single', varName: 'lang', required: true, options: [{ label: '한국어', value: 'ko' }, { label: 'English' }] },
    { title: '이름 없음', type: 'text' },
    'junk',
  ],
};

describe('onboarding', () => {
  it('reads a card’s as Risu does, carries it on the card and writes it back on export', () => {
    const onboarding = readOnboarding(risu)!;
    expect(onboarding).toEqual({
      enabled: true,
      mode: 'form',
      title: '시작',
      description: '',
      html: '',
      floatingButton: false,
      questions: [
        { id: 'q1', title: '언어', description: '', type: 'single', varName: 'lang', required: true, placeholder: '', options: [{ label: '한국어', value: 'ko' }, { label: 'English', value: '' }] },
        { id: '1', title: '이름 없음', description: '', type: 'text', varName: '', required: false, placeholder: '', options: [] },
      ],
    });
    expect(readOnboarding('none')).toBeUndefined();
    const card = convert({ spec: 'chara_card_v3', data: { name: 'Luna', extensions: { risuai: { onboarding: risu } } } }, null, new Map())!.card;
    expect(card.onboarding).toEqual(onboarding);
    expect(convert(cardSource(card, [], {}, false), null, new Map())!.card.onboarding).toEqual(onboarding);
  });

  it('asks only while on with something to show, a question without a variable left out', () => {
    const onboarding = readOnboarding(risu)!;
    expect(activeOnboarding(onboarding)!.questions.map(({ id }) => id)).toEqual(['q1']);
    expect(activeOnboarding({ ...onboarding, enabled: false })).toBeNull();
    expect(activeOnboarding({ ...onboarding, mode: 'html', html: ' ' })).toBeNull();
    expect(activeOnboarding(undefined)).toBeNull();
  });

  it('keeps a multiple choice as a JSON array, and counts an answer only when it holds something', () => {
    const picks = toggled(toggled(undefined, 'a'), 'b');
    expect(picks).toBe('["a","b"]');
    expect(toggled(picks, 'a')).toBe('["b"]');
    const question = readOnboarding(risu)!.questions[0]!;
    expect(answered({ ...question, type: 'multiple' }, new Map([['lang', '[]']]))).toBe(false);
    expect(answered(question, new Map([['lang', ' ']]))).toBe(false);
    expect(answered(question, new Map([['lang', 'ko']]))).toBe(true);
  });
});
