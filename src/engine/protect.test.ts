import { describe, expect, it } from 'vitest';
import { protect, protectRules, restore } from './protect';

describe('protect', () => {
  it('keeps code, comments, styles, scripts and media tags out, and puts them back', () => {
    const text = 'She smiles. <img src="a.png" alt="x">\n```js\nlet a = 1;\n```\n<!-- note --><style>p{}</style><SCRIPT>x()</SCRIPT> <audio src="b.mp3"></audio>\n~~~\nopen to the end';
    const { masked, spans } = protect(text, []);
    expect(masked).toBe('She smiles. ⟦1⟧\n⟦2⟧\n⟦3⟧⟦4⟧⟦5⟧ ⟦6⟧⟦7⟧\n⟦8⟧');
    expect(spans.slice(1)).toEqual(['```js\nlet a = 1;\n```', '<!-- note -->', '<style>p{}</style>', '<SCRIPT>x()</SCRIPT>', '<audio src="b.mp3">', '</audio>', '~~~\nopen to the end']);
    expect(restore(masked, spans)).toEqual({ text, missing: 0 });
  });

  it('ends a code block where markdown does: at a longer run of its own mark, not at the other mark', () => {
    const text = '````\n~~~\n```\n`````\nafter';
    expect(protect(text, []).spans).toEqual(['````\n~~~\n```\n`````']);
  });

  it('keeps a bot’s bracketed asset tokens out, whatever their brackets, and leaves plain brackets alone', () => {
    const text = 'He turned [ 🖼 | Indoor | looking away shyly ] and {{img::cat}} fell silent [[asset_name]] <sprite=happy_blush> [not a token] {ok}';
    const { masked, spans } = protect(text, []);
    expect(masked).toBe('He turned ⟦1⟧ and ⟦2⟧ fell silent ⟦3⟧ ⟦4⟧ [not a token] {ok}');
    expect(spans).toEqual(['[ 🖼 | Indoor | looking away shyly ]', '{{img::cat}}', '[[asset_name]]', '<sprite=happy_blush>']);
  });

  it('takes the earliest of overlapping matches, a custom rule’s among them, and drops one inside a span taken', () => {
    const rules = protectRules(['\\[\\[.*?\\]\\]', '<img']);
    if ('kind' in rules) throw new Error(rules.kind);
    expect(protect('[[a <img src=x>]] then <img src=y>', rules)).toEqual({ masked: '⟦1⟧ then ⟦2⟧', spans: ['[[a <img src=x>]]', '<img src=y>'] });
  });

  it('counts a token the answer lost, and puts back one it repeats each time', () => {
    expect(restore('⟦1⟧ and ⟦1⟧', ['<img>', '<br>'])).toEqual({ text: '<img> and <img>', missing: 1 });
  });

  it('names a custom source that does not read as a pattern', () => {
    expect(protectRules(['ok', '(open'])).toEqual({ kind: 'protect-invalid', pattern: '(open' });
  });
});
