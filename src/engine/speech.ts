// What 음성 reads of a message (design §6.19): the text the screen shows, without its markup.

// A code block is the bot's own box (a status window, a log), not the story: skipped, quotes inside it too.
const DROPPED = /<(style|script|template|head|pre)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2[^\n]*$|(?![\s\S]))/gim;
const BREAKS = /<\/?(br|p|div|li|tr|h[1-6]|blockquote|section|article|details|summary)\b[^>]*>/gi;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function entities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// Markdown's marks go; a link reads as its words, a picture as nothing.
function unmarked(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, '')
    .replace(/(\*{1,3}|_{2,3}|~~|`+)/g, '');
}

const QUOTED = /"([^"\n]+)"|“([^”\n]+)”|「([^」\n]+)」|『([^』\n]+)』/g;

// quotes: only what stands inside quotation marks, a line each (Risu's ttsReadOnlyQuoted).
export function speechText(shown: string, quotes: boolean): string {
  const plain = entities(shown.replace(DROPPED, '').replace(BREAKS, '\n').replace(/<[^>]*>/g, ''));
  const lines = plain.split('\n').map((line) => unmarked(line).replace(/\s+/g, ' ').trim());
  if (quotes) return lines.flatMap((line) => [...line.matchAll(QUOTED)].map((match) => match.slice(1).find((part) => part !== undefined)!.trim())).filter(Boolean).join('\n');
  return lines.filter((line) => line !== '' && !/^[-*_=]{3,}$/.test(line)).join('\n');
}

// The first stretch is small so the reading starts soon; each after it may be twice the one before, up to most, the
// provider's limit. A stretch ends between paragraphs; a paragraph longer than the stretch it starts is cut between
// sentences, else between words, else at the size.
const FIRST = 120;

export function speechParts(text: string, most: number): string[] {
  const parts: string[] = [];
  let part = '';
  let size = Math.min(FIRST, most);
  const close = () => {
    parts.push(part);
    part = '';
    size = Math.min(size * 2, most);
  };
  for (const paragraph of text.split('\n')) {
    if (part && part.length + 1 + paragraph.length > size) close();
    let rest = paragraph;
    while (rest.length > size) {
      const at = cutAt(rest, size);
      part = rest.slice(0, at).trim();
      rest = rest.slice(at).trim();
      close();
    }
    if (rest) part = part ? `${part}\n${rest}` : rest;
  }
  if (part) parts.push(part);
  return parts;
}

function cutAt(line: string, size: number): number {
  const window = line.slice(0, size + 1);
  const last = (pattern: RegExp) => Math.max(0, ...[...window.matchAll(pattern)].map((match) => match.index + match[0].length));
  return last(/[.!?。…]+["'”’」』)]*(?=\s)/g) || last(/\S(?=\s)/g) || size;
}
