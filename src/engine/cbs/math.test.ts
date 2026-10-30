import { describe, expect, it } from 'vitest';
import { calc } from './math';

describe('calc', () => {
  it("reads ?? as the author's fallback and ?: as a choice, loosest of all", () => {
    expect(['null??50', '??50', '30??50', '0??50', 'null??null', '1+null??2', '(1>=1)?0.65:0', '0?1:2', '1?2?3:4:5', '0?1:0?2:3', 'null??1?2:3'].map((expression) => calc(expression, none))).toEqual([50, 50, 30, 0, 0, 1, 0.65, 2, 3, 3, 2]);
    expect(calc('$x??7', () => null)).toBe(7);
    expect(['1?2', '1:2'].map((expression) => calc(expression, none))).toEqual([null, null]);
  });

  const none = () => 0;

  it('keeps precedence, left-associates every operator, ^ included, and gives comparisons and logic as 1 or 0', () => {
    expect([' 1 + 2 * 3', '2^3^2', '-2^2', '(1+2)*-3', '7%4', '3>2 && 1<=0', '!0 || 0', '2==2'].map((expression) => calc(expression, none))).toEqual([7, 64, 4, -9, 3, 0, 1, 1]);
  });

  it("reads Risu's single = and its ≠ ≤ ≥ as the comparisons they fold into", () => {
    expect(['0=0', '1=2', '1≠2', '2≤2', '3≥4'].map((expression) => calc(expression, none))).toEqual([1, 0, 1, 1, 0]);
  });

  it('reads $ and @ tokens through its reader, and gives null for an expression it cannot read', () => {
    expect(calc('$hp + @toggle_x', (token) => (token === '$hp' ? 10 : 1))).toBe(11);
    expect(['2 + abc', '(1', '1)'].map((expression) => calc(expression, none))).toEqual([null, null, null]);
  });

  it("reads a missing operand and `null`, an unset variable's text, as 0", () => {
    expect(['1 +', '+1', '', '()', 'null+1', 'NULL*2', '5-', '2*-3'].map((expression) => calc(expression, none))).toEqual([1, 1, 0, 0, 1, 0, 5, -6]);
  });
});
