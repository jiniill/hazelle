type Operator = (a: number, b: number) => number;

const or: Operator = (a, b) => Number(a !== 0 || b !== 0);
const and: Operator = (a, b) => Number(a !== 0 && b !== 0);
// Loosest first. Every operator is left-associative, ^ included (spec §d Math).
const LEVELS: Map<string, Operator>[] = [
  // Risu reads its single & and | as && and ||.
  new Map<string, Operator>([
    ['||', or],
    ['|', or],
  ]),
  new Map<string, Operator>([
    ['&&', and],
    ['&', and],
  ]),
  new Map<string, Operator>([
    // Risu folds == != <= >= into = ≠ ≤ ≥ before it reads, so a preset may write either form; a single = is equality.
    ['==', (a, b) => Number(a === b)],
    ['=', (a, b) => Number(a === b)],
    ['!=', (a, b) => Number(a !== b)],
    ['≠', (a, b) => Number(a !== b)],
    ['<', (a, b) => Number(a < b)],
    ['>', (a, b) => Number(a > b)],
    ['<=', (a, b) => Number(a <= b)],
    ['≤', (a, b) => Number(a <= b)],
    ['>=', (a, b) => Number(a >= b)],
    ['≥', (a, b) => Number(a >= b)],
  ]),
  new Map<string, Operator>([
    ['+', (a, b) => a + b],
    ['-', (a, b) => a - b],
  ]),
  new Map<string, Operator>([
    ['*', (a, b) => a * b],
    ['/', (a, b) => a / b],
    ['%', (a, b) => a % b],
  ]),
  new Map<string, Operator>([['^', (a, b) => a ** b]]),
];
// A word is everything between two operators, so no text is left over.
const TOKENS = /<=|>=|==|!=|&&|\|\||\?\?|[-+*/%^<>=≠≤≥!()?:&|]|[^-+*/%^<>=≠≤≥!()?:&|]+/gu;
const VARIABLE = /^[$@][\p{L}\p{N}_]+$/u;

// What may follow an operand: where one comes first, the operand is missing. `-` is left out, since it also negates.
const AFTER_OPERAND = new Set([...LEVELS.flatMap((operators) => [...operators.keys()]).filter((op) => op !== '-'), ')', '??', '?', ':']);

// A text as calc reads it, as Risu's parseFloat does: its leading number (`1,000` is 1), else 0.
export const leadingNumber = (text: string) => Number.parseFloat(text) || 0;

// As in Risu, a `)` that closes nothing is dropped, and the end closes what is still open.
function balanced(tokens: string[]): string[] {
  const out: string[] = [];
  let open = 0;
  for (const token of tokens) {
    if (token === ')' && open === 0) continue;
    if (token === '(') open++;
    if (token === ')') open--;
    out.push(token);
  }
  return [...out, ...Array<string>(open).fill(')')];
}

class Invalid {}

// As in Risu, a missing operand, `null` (an unset variable's text) and a word that is no number read as 0. Only a
// ?: missing its other half gives null, which leaves the tag as written.
// Ruled 2026-10-31: `a ?? b` and `c ? a : b` mean what their authors meant, where Risu's tokenizer reads a text it
// cannot place as 0 and gives `null??50` as 0. `??` alone sees a missing operand or null as absent.
export function calc(expression: string, variable: (token: string) => number | null): number | null {
  const tokens = balanced(expression.replace(/\s/g, '').match(TOKENS) ?? []);
  let at = 0;

  const operand = (): number | null => {
    if (at === tokens.length || AFTER_OPERAND.has(tokens[at]!)) return null;
    const token = tokens[at++]!;
    if (token === '-') return -(operand() ?? 0);
    if (token === '!') return (operand() ?? 0) === 0 ? 1 : 0;
    if (token === '(') {
      const value = conditional();
      if (tokens[at++] !== ')') throw new Invalid();
      return value;
    }
    if (VARIABLE.test(token)) return variable(token);
    if (token.toLowerCase() === 'null') return null;
    return leadingNumber(token);
  };
  const level = (depth: number): number | null => {
    const operators = LEVELS[depth];
    if (!operators) return operand();
    let left = level(depth + 1);
    for (let op = operators.get(tokens[at] ?? ''); op; op = operators.get(tokens[at] ?? '')) {
      at++;
      left = op(left ?? 0, level(depth + 1) ?? 0);
    }
    return left;
  };
  const coalesced = (): number | null => {
    let left = level(0);
    while (tokens[at] === '??') {
      at++;
      const right = level(0);
      left ??= right;
    }
    return left;
  };
  const conditional = (): number | null => {
    const test = coalesced();
    if (tokens[at] !== '?') return test;
    at++;
    const yes = conditional();
    if (tokens[at++] !== ':') throw new Invalid();
    const no = conditional();
    return (test ?? 0) !== 0 ? yes : no;
  };

  try {
    const value = conditional();
    return at === tokens.length ? (value ?? 0) : null;
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
}
