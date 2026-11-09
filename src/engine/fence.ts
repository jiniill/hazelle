// Fenced code blocks as markdown-it reads them: ``` or ~~~ opens, a run of the same mark at least as long closes, and
// one left open runs to the end, as a reply does while it streams. Each block is [first line, line after it).
const FENCE = /^ {0,3}(`{3,}(?!.*`)|~{3,})/;

export function fenceBlocks(lines: readonly string[]): [number, number][] {
  const blocks: [number, number][] = [];
  let open: { mark: string; at: number } | null = null;
  for (const [at, line] of lines.entries()) {
    const fence = FENCE.exec(line)?.[1];
    if (!open) {
      if (fence) open = { mark: fence, at };
    } else if (fence && fence[0] === open.mark[0] && fence.length >= open.mark.length && !line.slice(line.indexOf(fence) + fence.length).trim()) {
      blocks.push([open.at, at + 1]);
      open = null;
    }
  }
  if (open) blocks.push([open.at, lines.length]);
  return blocks;
}
