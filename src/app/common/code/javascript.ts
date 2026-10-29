import { nearest } from '../../../engine/edit-distance';
import { readTool, toolText, USES } from '../../../engine/import/tool';
import type { CodeLanguage, CodeProblem } from '../../ui';
import { describeImportFailure } from '../importFailure';

function lint(text: string): CodeProblem[] {
  const bytes = new TextEncoder().encode(text);
  const read = readTool(bytes);
  if (read.ok) return [];
  const { failure } = read;
  const lines = text.split('\n');
  const index = failure.line ? lines.findIndex((line) => line.trim() === failure.line) : 0;
  const line = lines[Math.max(0, index)]!;
  const from = lines.slice(0, Math.max(0, index)).reduce((at, line) => at + line.length + 1, 0);
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
