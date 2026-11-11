import { describe, expect, it } from 'vitest';
import type { StatusBlock, StatusDefinition, StatusField } from './status';
import { fieldsOf, withFields, withGroup, withLog, withoutGroup, withoutLog, withoutView, withView } from './statusEdit';
import { STATUS_TYPES } from './statusTypes';

const text = (id: string, name = id): StatusField => ({ id, name, kind: 'text' });

const plain: StatusDefinition = { id: 'd', name: '상태', writer: 'after', fields: [text('place'), text('mood')], groups: [{ id: 'party', name: '동료', fields: [text('hp')], members: [] }], logs: [{ id: 'events', name: '사건', fields: [text('what')] }] };
const viewed: StatusDefinition = {
  ...plain,
  views: [
    {
      id: 'v',
      name: '카드',
      frame: 'card',
      mood: 'hazelle',
      blocks: [
        { kind: 'head', fields: ['place', 'mood'] },
        { kind: 'section', name: '지금', blocks: [{ kind: 'field', field: 'mood' }] },
        { kind: 'tabs', tabs: [{ id: 't', name: '동료', blocks: [{ kind: 'records', group: 'party' }, { kind: 'log', log: 'events' }] }] },
      ],
    },
  ],
};

describe('a definition under its editor', () => {
  it("changes a 묶음's or a 기록's fields in their own list, the views untouched", () => {
    const next = withFields(viewed, { of: 'group', id: 'party' }, [text('hp'), text('mp')]);
    expect(fieldsOf(next, { of: 'group', id: 'party' }).map(({ id }) => id)).toEqual(['hp', 'mp']);
    expect(fieldsOf(next, { of: 'log', id: 'events' })).toBe(viewed.logs[0]!.fields);
    expect(next.views).toBe(viewed.views);
  });

  it('adds a new field of its own to the end of each view it declares, and declares no view for it', () => {
    const fields = [...viewed.fields, text('weather')];
    expect(withFields(viewed, { of: 'definition' }, fields).views![0]!.blocks.at(-1)).toEqual({ kind: 'field', field: 'weather' });
    expect(withFields(plain, { of: 'definition' }, fields).views).toBeUndefined();
  });

  it('takes a removed field out of every block that named it, however deep, and keeps a moved one where it was shown', () => {
    const next = withFields(viewed, { of: 'definition' }, [text('place')]);
    expect(next.views![0]!.blocks.slice(0, 2)).toEqual([
      { kind: 'head', fields: ['place'] },
      { kind: 'section', name: '지금', blocks: [] },
    ]);
    expect(withFields(viewed, { of: 'definition' }, [text('mood'), text('place')]).views).toEqual(viewed.views);
  });

  it('shows a new 묶음 and a new 기록 in each view, and takes a removed one out of a tab', () => {
    const more = withLog(withGroup(viewed, 'foes', '적'), 'notes', '메모');
    expect(more.groups.at(-1)).toEqual({ id: 'foes', name: '적', fields: [], members: [], open: true });
    expect(more.views![0]!.blocks.slice(-2)).toEqual([{ kind: 'records', group: 'foes' }, { kind: 'log', log: 'notes' }]);
    const less = withoutLog(withoutGroup(viewed, 'party'), 'events');
    expect(less.groups).toEqual([]);
    expect(less.views![0]!.blocks.at(-1)).toEqual({ kind: 'tabs', tabs: [{ id: 't', name: '동료', blocks: [] }] });
  });

  it('makes a first view that shows everything, and declares none again once its last view is removed', () => {
    const made = withView(plain, 'v1', '카드');
    expect(made.views).toEqual([{ id: 'v1', name: '카드', frame: 'card', mood: 'hazelle', blocks: [{ kind: 'field', field: 'place' }, { kind: 'field', field: 'mood' }, { kind: 'records', group: 'party' }, { kind: 'log', log: 'events' }] }]);
    expect(withoutView(made, 'v1')).toEqual(plain);
    expect(withoutView(withView(made, 'v2', 'HUD'), 'v1').views!.map(({ id }) => id)).toEqual(['v2']);
  });
});

describe('유형', () => {
  const named = (blocks: readonly StatusBlock[], out: { fields: string[]; groups: string[]; logs: string[] }) => {
    for (const block of blocks) {
      if (block.kind === 'head' || block.kind === 'radar') out.fields.push(...block.fields);
      else if (block.kind === 'field' || block.kind === 'choices') out.fields.push(block.field);
      else if (block.kind === 'records') out.groups.push(block.group);
      else if (block.kind === 'log') out.logs.push(block.log);
      else if (block.kind === 'section') named(block.blocks, out);
      else for (const tab of block.tabs) named(tab.blocks, out);
    }
    return out;
  };

  it.each(STATUS_TYPES)('$name names only what it declares, each name once in its place, every start one its field takes', ({ definition }) => {
    const lists = [definition.fields, ...definition.groups.map(({ fields }) => fields), ...definition.logs.map(({ fields }) => fields)];
    for (const fields of lists) expect(new Set(fields.map(({ name }) => name.trim().toLowerCase())).size).toBe(fields.length);
    for (const field of lists.flat()) {
      if (field.kind === 'gauge' && field.start !== undefined) expect(field.start >= field.min && field.start <= field.max, field.name).toBe(true);
      if (field.kind === 'stage' && field.start !== undefined) expect(field.labels, field.name).toContain(field.start);
    }
    for (const view of definition.views ?? []) {
      const { fields, groups, logs } = named(view.blocks, { fields: [], groups: [], logs: [] });
      expect(definition.fields.map(({ id }) => id)).toEqual(expect.arrayContaining(fields));
      expect(definition.groups.map(({ id }) => id)).toEqual(expect.arrayContaining(groups));
      expect(definition.logs.map(({ id }) => id)).toEqual(expect.arrayContaining(logs));
    }
  });
});
