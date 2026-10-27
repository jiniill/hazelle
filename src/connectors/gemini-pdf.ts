import { zlibSync } from 'fflate';
import type { Pdf } from './settings';
import type { ChatMessage } from './types';

// PDF text uses an unembedded font's ToUnicode map. Eligible Gemini models bill page images, not that text
// (ai.google.dev document processing, 2026-10).

export type PdfPlan = { lead: ChatMessage[]; packed: ChatMessage[]; tail: ChatMessage[]; transcript: string };

// recent keeps at least the last message out of the PDF.
export function planPdf(messages: ChatMessage[], { keep, recent }: Pdf): PdfPlan | null {
  const first = messages.findIndex((message) => message.role !== 'system');
  const lead = keep === 'none' ? 0 : first === -1 ? messages.length : first;
  const rest = messages.length - lead;
  const tail = keep === 'recent' ? Math.min(rest, Math.max(1, Math.ceil((rest * recent) / 100))) : 0;
  const packed = messages.slice(lead, messages.length - tail);
  if (!packed.length) return null;
  return {
    lead: messages.slice(0, lead),
    packed,
    tail: messages.slice(messages.length - tail),
    transcript: packed.map(({ role, content }) => `[${role}]\n${content}`).join('\n\n'),
  };
}

// A text layer keeps no empty line, so a paragraph break travels as U+2029, which the instruction names.
const PARAGRAPH = ' ';
const INSTRUCTION =
  'The attached PDF holds the earlier part of this conversation, in order; each message there starts with its role in brackets. A U+2029 character in its text marks a paragraph break, which was a blank line in the original.';

// Packed messages must retain their pictures beside the PDF.
export function packPdf(messages: ChatMessage[], pdf: Pdf): ChatMessage[] {
  const plan = planPdf(messages, pdf);
  if (!plan) return messages;
  const pictures = plan.packed.flatMap((message) => message.pictures ?? []);
  return [...plan.lead, { role: 'user', content: INSTRUCTION, document: plan.transcript, ...(pictures.length > 0 && { pictures }) }, ...plan.tail];
}

export const pdfData = (transcript: string) => base64(textPdf(transcript));

// US Letter, half-em glyphs. Keep 0.1 pt: PDF pages bill as images, while text remains readable.
// A 290k-character chat used 315 tokens on one page vs 11,172 on 42 at 8 pt (Gemini 3.8 Flash, 2026-10-18).
const WIDTH = 612;
const HEIGHT = 792;
const MARGIN = 36;
const SIZE = 0.1;
// Rounded, not floored: 0.1 is inexact in binary, and (792 - 72) / 0.1 comes out a hair under 7,200.
const PER_LINE = Math.round((WIDTH - 2 * MARGIN) / (SIZE / 2));
const PER_PAGE = Math.round((HEIGHT - 2 * MARGIN) / SIZE);

export function wrap(text: string, room: number): string[] {
  const lines: string[] = [];
  for (const source of text.split('\n')) {
    let line = Array.from(source);
    while (line.length > room) {
      const space = line.lastIndexOf(' ', room - 1);
      const cut = space > 0 ? space + 1 : room;
      lines.push(line.slice(0, cut).join(''));
      line = line.slice(cut);
    }
    lines.push(line.join(''));
  }
  return lines;
}

export function textPdf(transcript: string): Uint8Array {
  const lines = wrap(transcript.replace(/\n{2,}/g, PARAGRAPH), PER_LINE);
  // Every page's codes first: the font's ToUnicode map is written from them before the pages that use it.
  const cids = new Map<string, string>();
  const cid = (char: string) => {
    let known = cids.get(char);
    if (known === undefined) cids.set(char, (known = hex(cids.size + 1)));
    return known;
  };
  const shown: string[] = [];
  for (let at = 0; at < lines.length; at += PER_PAGE) {
    shown.push(lines.slice(at, at + PER_PAGE).map((line) => (line ? `<${Array.from(line, cid).join('')}> Tj T*` : 'T*')).join('\n'));
  }
  const writer = new PdfWriter();
  // No glyph is ever drawn from these metrics, so they need only be well formed: a half-em cell, as /DW sets.
  const descriptor = writer.object('<< /Type /FontDescriptor /FontName /HazelleText /Flags 4 /FontBBox [0 -250 500 750] /ItalicAngle 0 /Ascent 750 /Descent -250 /CapHeight 650 /StemV 50 >>');
  const cidFont = writer.object(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /HazelleText /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 500 /CIDToGIDMap /Identity >>`);
  const map = writer.stream(encode(toUnicode(cids)));
  const font = writer.object(`<< /Type /Font /Subtype /Type0 /BaseFont /HazelleText /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${map} 0 R >>`);
  const top = HEIGHT - MARGIN - SIZE;
  const pages = shown.map((page) => {
    const content = writer.stream(encode(`BT /F0 ${SIZE} Tf ${SIZE} TL ${MARGIN} ${top} Td\n${page}\nET`));
    return writer.object(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /Font << /F0 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
  });
  return writer.finish(pages);
}

const hex = (value: number) => value.toString(16).padStart(4, '0');
const utf16 = (char: string) => Array.from({ length: char.length }, (_, at) => hex(char.charCodeAt(at))).join('');

function toUnicode(cids: Map<string, string>): string {
  const entries = Array.from(cids, ([char, id]) => `<${id}> <${utf16(char)}>`);
  const blocks: string[] = [];
  for (let at = 0; at < entries.length; at += 100) {
    const block = entries.slice(at, at + 100);
    blocks.push(`${block.length} beginbfchar\n${block.join('\n')}\nendbfchar`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

const encode = (text: string) => new TextEncoder().encode(text);

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

// Object n is bodies[n - 1]. 1 is the catalog and 2 the page tree, filled in last since they name every page.
class PdfWriter {
  private readonly bodies: Uint8Array[][] = [[], []];

  object(dictionary: string): number {
    return this.bodies.push([encode(dictionary)]);
  }

  stream(bytes: Uint8Array): number {
    const packed = zlibSync(bytes);
    return this.bodies.push([encode(`<< /Length ${packed.length} /Filter /FlateDecode >>\nstream\n`), packed, encode('\nendstream')]);
  }

  finish(pages: number[]): Uint8Array {
    this.bodies[0] = [encode('<< /Type /Catalog /Pages 2 0 R >>')];
    this.bodies[1] = [encode(`<< /Type /Pages /Kids [${pages.map((page) => `${page} 0 R`).join(' ')}] /Count ${pages.length} >>`)];
    // The second line's four bytes above 127 mark the file binary, as the PDF header asks.
    const chunks: Uint8Array[] = [encode('%PDF-1.7\n%'), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
    let offset = chunks[0]!.length + chunks[1]!.length;
    const offsets: number[] = [];
    this.bodies.forEach((body, at) => {
      offsets.push(offset);
      for (const chunk of [encode(`${at + 1} 0 obj\n`), ...body, encode('\nendobj\n')]) {
        chunks.push(chunk);
        offset += chunk.length;
      }
    });
    const size = this.bodies.length + 1;
    // Each xref entry is 20 bytes with its line end.
    const xref = [`xref\n0 ${size}`, '0000000000 65535 f ', ...offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n `)].join('\n');
    chunks.push(encode(`${xref}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}
