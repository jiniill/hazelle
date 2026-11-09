import { describe, expect, it } from 'vitest';
import { BLOCK_NAMES } from '../../../engine/cbs/parse';
import { normalize, tagNames } from '../../../engine/cbs/tags';
import { COMMANDS } from './cbsCommands';

describe('COMMANDS', () => {
  it('describes every tag the engine evaluates, once, under the name its form writes', () => {
    const commands = COMMANDS.flatMap((group) => group.commands);
    expect(commands.flatMap((command) => command.names).toSorted()).toEqual(tagNames().toSorted());
    for (const { names, form } of commands.filter((command) => command.names.length)) expect(normalize(/^\{\{([^:}]+|:)/.exec(form)![1]!)).toBe(names[0]);
  });

  it('describes only blocks the engine evaluates', () => {
    const heads = COMMANDS.flatMap((group) => group.commands).flatMap(({ form }) => /^\{\{#([^\s:}]+)/.exec(form)?.[1] ?? []);
    expect(BLOCK_NAMES).toEqual(expect.arrayContaining(heads));
  });
});
