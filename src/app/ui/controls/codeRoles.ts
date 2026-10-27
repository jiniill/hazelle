import { tags, type Tag } from '@lezer/highlight';

// Keep roles synchronized between CodeEditor.module.css and Story.shadow.css code-<role> classes.
export type CodeRole = 'keyword' | 'string' | 'comment' | 'number' | 'operator';
export const CODE_ROLES: readonly { tag: Tag | Tag[]; role: CodeRole }[] = [
  { tag: tags.keyword, role: 'keyword' },
  { tag: [tags.string, tags.special(tags.string)], role: 'string' },
  { tag: tags.comment, role: 'comment' },
  { tag: [tags.number, tags.bool, tags.null], role: 'number' },
  { tag: tags.operator, role: 'operator' },
];
