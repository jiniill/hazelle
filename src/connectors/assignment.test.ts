import { describe, expect, it } from 'vitest';
import { fitsRole, resolveRole, sameModelRef } from './assignment';
import type { Model } from './types';

describe('model assignment', () => {
  it('identifies models by both their connection and model IDs', () => {
    const selected = { connection: 'c1', model: 'shared' };
    expect(sameModelRef(selected, { ...selected })).toBe(true);
    expect(sameModelRef(selected, { connection: 'c2', model: 'shared' })).toBe(false);
    expect(sameModelRef(selected, { connection: 'c1', model: 'other' })).toBe(false);
  });

  it('takes the most specific layer that sets the role', () => {
    const general = { main: { connection: 'c1', model: 'claude' } };
    const chat = { main: { connection: 'c2', model: 'gemini' } };
    expect(resolveRole('main', [chat, {}, general])).toEqual({ ref: chat.main, layer: 0, role: 'main' });
    expect(resolveRole('main', [{}, general])).toEqual({ ref: general.main, layer: 1, role: 'main' });
    expect(resolveRole('main', [{}, {}])).toBeNull();
  });

  it('falls back from 보조 모델 to 대화 모델 only after every layer is asked', () => {
    const main = { connection: 'c1', model: 'claude' };
    const aux = { connection: 'c1', model: 'haiku' };
    expect(resolveRole('aux', [{ main }, { aux }])).toEqual({ ref: aux, layer: 1, role: 'aux' });
    expect(resolveRole('aux', [{ main }, {}])).toEqual({ ref: main, layer: 0, role: 'main' });
  });

  it('offers a model whose output is unknown, not one that cannot write text', () => {
    const model = (output: Model['output']) => ({ output }) as Model;
    expect(fitsRole(model(['text']), 'main')).toBe(true);
    expect(fitsRole(model(null), 'main')).toBe(true);
    expect(fitsRole(model(['image']), 'main')).toBe(false);
  });
});
