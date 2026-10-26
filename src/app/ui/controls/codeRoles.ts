import { tags, type Tag } from '@lezer/highlight';

// What each highlighted piece of code is drawn as, the code editor's and a story's code block alike. Each role has its
// class in CodeEditor.module.css and in Story.shadow.css (code-<role>).
export type CodeRole = 'keyword' | 'string' | 'comment' | 'number' | 'operator';
export const CODE_ROLES: readonly { tag: Tag | Tag[]; role: CodeRole }[] = [
  { tag: tags.keyword, role: 'keyword' },
  { tag: [tags.string, tags.special(tags.string)], role: 'string' },
  { tag: tags.comment, role: 'comment' },
  { tag: [tags.number, tags.bool, tags.null], role: 'number' },
  { tag: tags.operator, role: 'operator' },
];
