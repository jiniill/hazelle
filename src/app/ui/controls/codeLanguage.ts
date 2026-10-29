// Kit renders language data, but app/common/code fills it from engine; never import engine into the kit.
export type CodeDoc = { form: string; text: string; facts?: [string, string][] };

export type CodeProblem = { from: number; to: number; severity: 'error' | 'warning'; message: string; fix?: { label: string; insert: string } };

// template: what accepting it inserts, its stops written ${1:이름} and the caret's last place ${0}; a line's leading
// tabs become the editor's indent.
export type CodeItem = { label: string; kind: 'function' | 'keyword' | 'variable' | 'namespace'; detail?: string; template?: string; boost?: number; doc?: CodeDoc };

// closing: the end its templates write themselves, which one replaces when it already follows the caret (the `}}` that
// closing brackets typed after `{{`).
export type CodeCompletion = { from: number; items: CodeItem[]; validFor: RegExp; closing?: string };

// Language spans never overlap; preserve original text positions and separate tag braces/names/arguments.
export type CodeSpan = { from: number; to: number; kind: 'tag' | 'separator' | 'argument' | 'comment' | 'slot' };

// syntax: lua and javascript are CodeMirror's own modes; a function is the language's spans. comment: what Ctrl+/ wraps a
// selection in, when the syntax has no comment of its own. place: what the caret is in, by the syntax's own reading.
export type CodeLanguage = {
  syntax: 'lua' | 'javascript' | ((text: string) => CodeSpan[]);
  comment?: { open: string; close: string };
  lint: (text: string) => CodeProblem[] | Promise<CodeProblem[]>;
  complete: (text: string, at: number, place: 'code' | 'string' | 'comment', explicit: boolean) => CodeCompletion | null;
  explain: (text: string, at: number) => { from: number; to: number; doc: CodeDoc } | null;
};

// How 크게 편집 carries the caret between the field and its big copy, whichever control each is.
export type Caret = { focus: () => void; selection: () => [number, number]; select: (at: [number, number]) => void };

export const areaCaret = (area: HTMLTextAreaElement): Caret => ({
  focus: () => area.focus(),
  selection: () => [area.selectionStart, area.selectionEnd],
  select: (at) => area.setSelectionRange(...at),
});
