import type { ScriptQuestion } from '../../runtime/scripts/interactions';
import { CARD_WRITE_ASK_HELP, cardWriteConsent, modelConsent, modelsHelp, pluginConsent, pluginConsentHelp, type Asker } from '../common/words';
import type { AskAnswer } from '../ui';

const CONSENT: AskAnswer = { kind: 'choices', choices: [{ label: '허용', value: 'yes', primary: true }, { label: '안 함', value: 'no' }] };

// Each value is what ScriptInteractions.answer takes for that kind (runtime/scripts/interactions): the line typed, 'yes' or a dismissal, an
// option's index, and for a model call, a card write or a plugin's grants 'yes' or 'no'.
export function asking(question: ScriptQuestion['question'], asker: Asker): { text?: string; help?: string; answer: AskAnswer } {
  switch (question.kind) {
    case 'input':
      return { text: question.text, answer: { kind: 'line' } };
    case 'confirm':
      return { text: question.text, answer: { kind: 'choices', choices: [{ label: '예', value: 'yes', primary: true }, { label: '아니요', value: null }] } };
    case 'select':
      return { text: question.text, answer: { kind: 'choices', choices: question.options.map((label, index) => ({ label, value: String(index) })) } };
    case 'model':
      return {
        text: modelConsent(asker),
        help: modelsHelp(asker),
        answer: CONSENT,
      };
    case 'card':
      return { text: cardWriteConsent(asker), help: CARD_WRITE_ASK_HELP, answer: CONSENT };
    case 'plugin':
      return { text: pluginConsent(question.grants), help: pluginConsentHelp(question.grants, question.hosts), answer: CONSENT };
  }
}
