import { progressed } from '../engine/progress';

// Load o200k_base only in evaluation workers so other realms never duplicate tables.
// Special-token-looking strings remain text; jobs surface tokenizer load failures.
export const tokenizer = () => import('gpt-tokenizer/encoding/o200k_base').then(({ countTokens }) => (text: string) => (progressed(), countTokens(text, { disallowedSpecial: new Set() })));
