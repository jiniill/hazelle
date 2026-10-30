type Operator = (a: number, b: number) => number;

// Loosest first. Every operator is left-associative, ^ included (spec §d Math).
const LEVELS: Map<string, Operator>[] = [
  new Map<string, Operator>([['||', (a, b) => Number(a !== 0 || b !== 0)]]),
  new Map<string, Operator>([['&&', (a, b) => Number(a !== 0 && b !== 0)]]),
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
const TOKENS = /\d+(?:\.\d+)?|\.\d+|[$@][\p{L}\p{N}_]+|null|<=|>=|==|!=|&&|\|\||\?\?|[-+*/%^<>=≠≤≥!()?:]/giu;

// What may follow an operand: where one comes first, the operand is missing. `-` is left out, since it also negates.
const AFTER_OPERAND = new Set([...LEVELS.flatMap((operators) => [...operators.keys()]).filter((op) => op !== '-'), ')', '??', '?', ':']);

class Invalid {}

// Missing operands and unset-variable null text count as 0, as in Risu.
// Unparseable expressions return null and stay literal; never discard bad tokens and evaluate the rest.
// Ruled 2026-10-31: `a ?? b` and `c ? a : b` mean what their authors meant, where Risu's tokenizer reads a text it
// cannot place as 0 and gives `null??50` as 0. `??` alone sees a missing operand or null as absent.
export function calc(expression: string, variable: (token: string) => number | null): number | null {
  const source = expression.replace(/\s/g, '');
  const tokens = source.match(TOKENS) ?? [];
  if (tokens.join('') !== source) return null;
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
    if (token.startsWith('$') || token.startsWith('@')) return variable(token);
    if (token.toLowerCase() === 'null') return null;
    if (!/^[\d.]/.test(token)) throw new Invalid();
    return Number(token);
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
