import { list, text, toggle } from '../../connectors/values';
import { isRecord } from '../../record';

// A card's 시작 전 설문 (Risu's extensions.risuai.onboarding), kept in Risu's own shape so a card exported again carries
// it as it came. Each answer is a chat variable a new chat starts from.
export type OnboardingQuestion = {
  id: string;
  title: string;
  description: string;
  type: 'single' | 'multiple' | 'text';
  varName: string;
  required: boolean;
  placeholder: string;
  options: { label: string; value: string }[];
};
// html: the creator's own page, whose elements set variables through risu-change-var-name and -value (app/ui Story bind).
// floatingButton is carried, never drawn: the survey is a new chat's (app/chat useChat).
export type Onboarding = {
  enabled: boolean;
  mode: 'form' | 'html';
  title: string;
  description: string;
  html: string;
  floatingButton: boolean;
  questions: OnboardingQuestion[];
};

// As Risu reads an imported card's (onboarding.ts normalizeOnboarding): anything not an object is none, and every field
// takes Risu's default when it is missing or of another type.
export function readOnboarding(raw: unknown): Onboarding | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    enabled: raw.enabled === true,
    mode: raw.mode === 'html' ? 'html' : 'form',
    title: text(raw.title),
    description: text(raw.description),
    html: text(raw.html),
    floatingButton: raw.floatingButton === true,
    questions: list(raw.questions).filter(isRecord).map((question, index) => ({
      id: text(question.id) || String(index),
      title: text(question.title),
      description: text(question.description),
      type: question.type === 'multiple' || question.type === 'text' ? question.type : 'single',
      varName: text(question.varName),
      required: question.required === true,
      placeholder: text(question.placeholder),
      options: list(question.options).filter(isRecord).map((option) => ({ label: text(option.label), value: text(option.value) })),
    })),
  };
}

// What a new chat asks: none while it is off or has nothing to show. A question without a variable is never shown, as
// in Risu, since its answer would go nowhere.
export function activeOnboarding(onboarding: Onboarding | undefined): Onboarding | null {
  if (!onboarding?.enabled) return null;
  if (onboarding.mode === 'html') return onboarding.html.trim() ? onboarding : null;
  const questions = onboarding.questions.filter((question) => question.varName);
  return questions.length ? { ...onboarding, questions } : null;
}

export const optionValue = ({ label, value }: OnboardingQuestion['options'][number]) => (value !== '' ? value : label);
export const optionLabel = (option: OnboardingQuestion['options'][number]) => option.label || optionValue(option);

// A multiple choice's answer is a JSON array, as CBS's array tags read one.
export function picked(answer: string | undefined): string[] {
  if (!answer) return [];
  try {
    const parsed: unknown = JSON.parse(answer);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // A plain value is one pick.
  }
  return [answer];
}

export const toggled = (answer: string | undefined, value: string) => JSON.stringify(toggle(picked(answer), value));

export const answered = ({ type, varName }: OnboardingQuestion, answers: ReadonlyMap<string, string>) =>
  type === 'multiple' ? picked(answers.get(varName)).length > 0 : (answers.get(varName) ?? '').trim() !== '';
