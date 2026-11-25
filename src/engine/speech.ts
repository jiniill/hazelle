// What 음성 reads of a message (design §6.19): the text the screen shows, without its markup.

const DROPPED = /<(style|script|template|head)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi;
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
// provider's limit. A stretch ends between lines, else between sentences, else at most.
const FIRST = 300;

export function speechParts(text: string, most: number): string[] {
  const pieces = text.split('\n').flatMap((line) => (line.length <= most ? [line] : sentences(line, most)));
  const parts: string[] = [];
  let part = '';
  let size = Math.min(FIRST, most);
  for (const piece of pieces) {
    if (part && part.length + 1 + piece.length > size) {
      parts.push(part);
      part = '';
      size = Math.min(size * 2, most);
    }
    part = part ? `${part}\n${piece}` : piece;
  }
  if (part) parts.push(part);
  return parts;
}

function sentences(line: string, most: number): string[] {
  const cut: string[] = [];
  let rest = line;
  while (rest.length > most) {
    const window = rest.slice(0, most);
    const end = Math.max(...[...window.matchAll(/[.!?。…](?=\s)/g)].map((match) => match.index + 1), 0);
    const at = end > 0 ? end : most;
    cut.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  return rest ? [...cut, rest] : cut;
}
