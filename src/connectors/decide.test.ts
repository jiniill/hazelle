import { expect, it } from 'vitest';
import { fitsRole } from './assignment';
import { isQuestions } from './decide';
import recorded from './fixtures/gemini-decisions.json';
import { decideAnswer, decideRequest, decideRoute, parseCatalog, resolveConnection, servesRole, type Route } from './registry';
import type { Connection, DecideQuestion } from './types';

const connection = (type: string): Connection => ({ type, label: type, baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'key' }], turns: null, starred: [] });
const google = resolveConnection(connection('google')) as Route;
const [model] = parseCatalog(google, { models: [recorded.model] })!;

const questions: Record<string, DecideQuestion> = {
  mira_present: { type: 'noul', instructions: 'Is Mira physically present in this scene?' },
  king_present: { type: 'noul', instructions: 'Is the king physically present in this scene?', criteria: { true: 'The king is in the tavern.', false: 'The king is not in the tavern.' } },
  tam_mood: { type: 'choice', instructions: "What is Tam's mood?", criteria: { happy: 'Pleased to see her.', annoyed: 'Irritated or resentful.', afraid: 'Frightened.' } },
  tension: { type: 'score', instructions: 'How tense is the scene?', criteria: ['Calm.', 'Slightly tense.', 'Openly hostile.'] },
};

it('takes questions within the bounds both decision APIs share, and no others', () => {
  expect(isQuestions(questions)).toBe(true);
  const noul = questions.mira_present!;
  const refused: unknown[] = [
    {},
    { 'bad id': noul },
    { ['a'.repeat(65)]: noul },
    { q: { type: 'noul', instructions: '' } },
    { q: { type: 'noul', instructions: 'x', criteria: { true: 'yes' } } },
    { q: { type: 'choice', instructions: 'x', criteria: { only: 'one' } } },
    { q: { type: 'score', instructions: 'x', criteria: Array(11).fill('level') } },
    { q: { type: 'box', instructions: 'x' } },
    Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`q${index}`, noul])),
  ];
  for (const each of refused) expect(isQuestions(each)).toBe(false);
});

it('lists a Gemini model that only decides as a decision model, which Google serves and Vertex AI does not', () => {
  expect(model).toMatchObject({ id: 'gemini-decision-1', name: 'Gemini Decision 1', output: ['decision'], contextLength: 262144 });
  expect(fitsRole(model!, 'decide')).toBe(true);
  expect(fitsRole(model!, 'aux')).toBe(false);
  expect(decideRoute(connection('google'), model!)).not.toBeNull();
  expect(servesRole(connection('google'), model!, 'decide')).toBe(true);
  expect(servesRole(connection('openai'), model!, 'decide')).toBe(false);
  expect(servesRole(connection('openai'), model!, 'aux')).toBe(true);
});

it('asks Gemini with its own words for a noul’s criteria and reads a live answer, each score level in the rubric’s order', () => {
  const request = decideRequest(google, model!, '비 오는 밤.', questions);
  expect(request).toMatchObject({ url: 'https://generativelanguage.googleapis.com/v1beta/decisions', method: 'POST' });
  expect(JSON.parse(request.body!)).toEqual({
    model: 'gemini-decision-1',
    input: '비 오는 밤.',
    questions: { ...questions, king_present: { ...questions.king_present, criteria: { true_description: 'The king is in the tavern.', false_description: 'The king is not in the tavern.' } } },
  });
  expect(decideAnswer(google, model!, recorded.answer, questions)).toEqual({
    answers: {
      mira_present: { type: 'noul', noul: 0.99 },
      king_present: { type: 'noul', noul: 0.04740241190870961 },
      tam_mood: { type: 'choice', choice: 'annoyed', probabilities: { happy: 0.005640038493941186, annoyed: 0.9900114921780002, afraid: 0.004348469328058593 } },
      tension: { type: 'score', score: 0.999646879475506, probabilities: [0.16060717403265387, 0.6791387724591861, 0.16025405350816] },
    },
    usage: { inputTokens: 352, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 0, reasoningTokens: null },
    cost: null,
  });
});

it('refuses an answer that leaves a question out or answers it as another kind', () => {
  const { answers } = recorded.answer;
  expect(decideAnswer(google, model!, { answers: { ...answers, tension: undefined } }, questions)).toBeNull();
  expect(decideAnswer(google, model!, { answers: { ...answers, mira_present: answers.tam_mood } }, questions)).toBeNull();
  expect(decideAnswer(google, model!, { answers: { ...answers, tam_mood: { ...answers.tam_mood, choice: 'asleep' } } }, questions)).toBeNull();
  expect(decideAnswer(google, model!, { error: { code: 'invalid_request' } }, questions)).toBeNull();
});
