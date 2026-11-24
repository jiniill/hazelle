import { isRecord } from '../record';
import type { DecideQuestion, Decision } from './types';
import { amount } from './values';

// What both decision APIs take (Gemini Decisions API reference and a live call, 2026-11-24; docs.typesafe.ai/api,
// read the same day), so one set of questions runs on either: TypeSafe's rubric ends at 10 levels and Gemini refuses a
// choice of one option.
export const DECIDE_LIMITS = { questions: 1000, options: { least: 2, most: 255 }, levels: { least: 2, most: 10 } } as const;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const worded = (value: unknown): value is string => typeof value === 'string' && value !== '';
const within = (size: number, { least, most }: { least: number; most: number }) => size >= least && size <= most;

function isQuestion(value: unknown): value is DecideQuestion {
  if (!isRecord(value) || !worded(value.instructions)) return false;
  const { criteria } = value;
  switch (value.type) {
    case 'noul':
      return criteria === undefined || (isRecord(criteria) && worded(criteria.true) && worded(criteria.false));
    case 'choice':
      return isRecord(criteria) && within(Object.keys(criteria).length, DECIDE_LIMITS.options) && Object.entries(criteria).every(([id, described]) => id !== '' && worded(described));
    case 'score':
      return Array.isArray(criteria) && within(criteria.length, DECIDE_LIMITS.levels) && criteria.every(worded);
    default:
      return false;
  }
}

export function isQuestions(value: unknown): value is Record<string, DecideQuestion> {
  if (!isRecord(value)) return false;
  const asked = Object.entries(value);
  return asked.length >= 1 && asked.length <= DECIDE_LIMITS.questions && asked.every(([id, question]) => ID.test(id) && isQuestion(question));
}

const probability = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1;

// One question's answer as both APIs write it, the same but for what each adds (confidence, a score's legend); a
// score's probabilities come keyed by level. null for an answer that is not the question's.
export function decisionOf(question: DecideQuestion, raw: unknown): Decision | null {
  if (!isRecord(raw) || raw.type !== question.type) return null;
  const given = isRecord(raw.probabilities) ? raw.probabilities : {};
  switch (question.type) {
    case 'noul':
      return probability(raw.noul) ? { type: 'noul', noul: raw.noul } : null;
    case 'choice': {
      const options = Object.keys(question.criteria);
      const { choice } = raw;
      if (typeof choice !== 'string' || !options.includes(choice) || !options.every((option) => probability(given[option]))) return null;
      return { type: 'choice', choice, probabilities: Object.fromEntries(options.map((option) => [option, given[option] as number])) };
    }
    case 'score': {
      const levels = question.criteria.map((_, level) => given[level]);
      const score = amount(raw.score);
      return score !== null && levels.every(probability) ? { type: 'score', score, probabilities: levels } : null;
    }
  }
}
