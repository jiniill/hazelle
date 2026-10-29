import { nearest } from '../../../engine/edit-distance';
import { readTool, splitTool, toolSource, toolText, USES } from '../../../engine/import/tool';
import type { ToolIdentity } from '../../../model/tool';
import type { CodeLanguage, CodeProblem } from '../../ui';
import { describeImportFailure } from '../importFailure';

// The studio's editor holds the body alone; the draft's own identity is checked on its 정보 tab, so a stand-in fills it.
const STAND_IN: ToolIdentity = { name: 'draft', author: 'draft', displayName: '', version: '', description: '' };

function at(text: string, written: string | undefined): { from: number; line: string } {
  const lines = text.split('\n');
  const index = Math.max(0, written ? lines.findIndex((line) => line.trim() === written) : 0);
  return { from: lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0), line: lines[index]! };
}

function lint(body: string): CodeProblem[] {
  const { found } = splitTool(body);
  if (found.length > 0) {
    return found.map(({ written }) => {
      const { from, line } = at(body, written);
      return { from, to: from + line.length, severity: 'error', message: '이 줄은 정보 탭에서 바꿔요.' };
    });
  }
  const bytes = new TextEncoder().encode(toolSource(STAND_IN, body));
  const read = readTool(bytes);
  if (read.ok) return [];
  const { failure } = read;
  const { from, line } = at(body, failure.line);
  const problem: CodeProblem = { from, to: from + line.length, severity: 'error', message: describeImportFailure({ ...failure, line: undefined }) };
  if (failure.detail === 'tool-uses') {
    const parsed = toolText(bytes);
    const header = parsed.ok && parsed.header.find(({ written }) => written === failure.line);
    const near = header && nearest(header.value, USES, (use) => use, 3);
    if (near && header) problem.fix = { label: `${near}로 바꾸기`, insert: line.slice(0, line.lastIndexOf(header.value)) + near + line.slice(line.lastIndexOf(header.value) + header.value.length) };
  }
  return [problem];
}

export function jsLanguage(): CodeLanguage {
  return { syntax: 'javascript', lint, complete: () => null, explain: () => null };
}
