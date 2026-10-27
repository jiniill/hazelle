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
const TOKENS = /\d+(?:\.\d+)?|\.\d+|[$@][\p{L}\p{N}_]+|null|<=|>=|==|!=|&&|\|\||[-+*/%^<>=≠≤≥!()]/giu;

// What may follow an operand: where one comes first, the operand is missing. `-` is left out, since it also negates.
const AFTER_OPERAND = new Set([...LEVELS.flatMap((operators) => [...operators.keys()]).filter((op) => op !== '-'), ')']);

class Invalid {}

// Missing operands and unset-variable null text count as 0, as in Risu.
// Unparseable expressions return null and stay literal; never discard bad tokens and evaluate the rest.
export function calc(expression: string, variable: (token: string) => number): number | null {
  const source = expression.replace(/\s/g, '');
  const tokens = source.match(TOKENS) ?? [];
  if (tokens.join('') !== source) return null;
  let at = 0;

  const operand = (): number => {
    if (at === tokens.length || AFTER_OPERAND.has(tokens[at]!)) return 0;
    const token = tokens[at++]!;
    if (token === '-') return -operand();
    if (token === '!') return operand() === 0 ? 1 : 0;
    if (token === '(') {
      const value = level(0);
      if (tokens[at++] !== ')') throw new Invalid();
      return value;
    }
    if (token.startsWith('$') || token.startsWith('@')) return variable(token);
    if (token.toLowerCase() === 'null') return 0;
    if (!/^[\d.]/.test(token)) throw new Invalid();
    return Number(token);
  };
  const level = (depth: number): number => {
    const operators = LEVELS[depth];
    if (!operators) return operand();
    let left = level(depth + 1);
    for (let op = operators.get(tokens[at] ?? ''); op; op = operators.get(tokens[at] ?? '')) {
      at++;
      left = op(left, level(depth + 1));
    }
    return left;
  };

  try {
    const value = level(0);
    return at === tokens.length ? value : null;
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
}
