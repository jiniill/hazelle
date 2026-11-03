// An error as 문제 진단 reports it. WebKit names the failing file and line only in the stack, so its first lines come too;
// V8's stack opens with the name and message, said once.
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const head = `${error.name}: ${error.message}`;
  const lines = error.stack?.split('\n') ?? [];
  return [head, ...(lines[0] === head ? lines.slice(1) : lines).slice(0, 3)].join('\n');
}
