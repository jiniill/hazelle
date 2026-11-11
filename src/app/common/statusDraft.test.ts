import { describe, expect, it } from 'vitest';
import type { StatusField } from '../../model/status';
import { draftField, draftProblems, fieldDraft, newDraft } from './statusDraft';

const FIELDS: StatusField[] = [
  { id: 'love', name: '호감도', kind: 'gauge', min: -50, max: 50, start: 0, change: true, unit: '%', main: true, tone: 'warm' },
  { id: 'gold', name: '소지금', kind: 'number', start: 1200, unit: 'G' },
  { id: 'place', name: '장소', kind: 'text', start: '교실' },
  { id: 'mood', name: '기분', kind: 'stage', labels: ['평온', '들뜸'], start: '평온' },
  { id: 'bag', name: '소지품', kind: 'list', checked: true, start: [{ text: '지도' }] },
  { id: 'note', name: '메모', kind: 'text' },
];

describe("a field's form", () => {
  it.each(FIELDS)('gives $name back as it was', (field) => {
    expect(draftField(field.kind, field.id, fieldDraft(field), field)).toEqual(field);
  });

  it('starts a gauge and a number as ones the writer moves', () => {
    expect([newDraft('gauge').change, newDraft('number').change, newDraft('text').change]).toEqual([true, true, false]);
  });

  it('says which input stops it, and makes no field until none does', () => {
    const gauge = { ...newDraft('gauge'), name: 'HP' };
    expect(draftProblems('gauge', newDraft('gauge'))).toEqual(['name']);
    expect(draftProblems('gauge', { ...gauge, min: '100', max: '0' })).toEqual(['range']);
    expect(draftProblems('gauge', { ...gauge, start: '120' })).toEqual(['start']);
    expect(draftProblems('number', { ...newDraft('number'), name: '레벨', start: '많이' })).toEqual(['start']);
    expect(draftProblems('stage', { ...newDraft('stage'), name: '기분', labels: ['평온'] })).toEqual(['labels']);
    expect(draftProblems('stage', { ...newDraft('stage'), name: '기분', labels: ['평온', '들뜸'], start: '우울' })).toEqual(['start']);
    expect(draftField('gauge', 'hp', { ...gauge, start: '120' })).toBeUndefined();
  });

  it('reads a number typed with commas, and a blank start as none', () => {
    expect(draftField('number', 'gold', { ...newDraft('number'), name: ' 소지금 ', start: '1,200' })).toEqual({ id: 'gold', name: '소지금', kind: 'number', start: 1200, change: true });
    expect(draftField('gauge', 'hp', { ...newDraft('gauge'), name: 'HP', change: false })).toEqual({ id: 'hp', name: 'HP', kind: 'gauge', min: 0, max: 100 });
  });
});
