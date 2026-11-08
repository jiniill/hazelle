import { expect, it } from 'vitest';
import { pathOf, type FlowEdge } from './flow';

it('lights what feeds a node and what it feeds, never its siblings', () => {
  const edges: FlowEdge[] = [
    { from: 'google', to: 'low', kind: 'follow' },
    { from: 'google', to: 'high', kind: 'follow' },
    { from: 'low', to: 'aux', kind: 'follow' },
    { from: 'high', to: 'main', kind: 'follow' },
    { from: 'aux', to: 'translate', kind: 'follow' },
    { from: 'aux', to: 'memory', kind: 'off' },
  ];
  expect([...pathOf(edges, 'aux')].sort()).toEqual(['aux', 'google', 'low', 'memory', 'translate']);
  expect([...pathOf(edges, 'translate')].sort()).toEqual(['aux', 'google', 'low', 'translate']);
});
