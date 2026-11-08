// follow: takes what the place before it holds; own: picked apart from that, or pinned; gap: what it needs is missing;
// off: runs nothing now.
export type FlowKind = 'follow' | 'own' | 'gap' | 'off';
export type FlowEdge = { from: string; to: string; kind: FlowKind; label?: string };

// Everything joined to a node along the edges' direction: what feeds it and what it feeds, not its siblings.
export function pathOf(edges: readonly FlowEdge[], id: string): Set<string> {
  const seen = new Set([id]);
  const walk = (at: string, down: boolean) => {
    for (const { from, to } of edges) {
      const [here, next] = down ? [from, to] : [to, from];
      if (here !== at || seen.has(next)) continue;
      seen.add(next);
      walk(next, down);
    }
  };
  walk(id, true);
  walk(id, false);
  return seen;
}
