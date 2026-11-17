import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { useFieldTranslation } from './TranslatableField';

const translateOnTool = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), undoable: vi.fn() }));
vi.mock('../../runtime/tasks/translate', () => ({ translateOnTool }));
vi.mock('../session', () => ({ useSession: () => ({}) }));
vi.mock('../toast', () => ({ useToast: () => toast, useOwnUndo: () => toast.undoable }));
vi.mock('../ui', () => ({ IconButton: () => null }));
vi.mock('./CountedFields', () => ({ CountedField: () => null }));

const answer = (text: string, state = 'done') => ({ ok: true, translation: { text, receipt: { state } } });

let field: ReturnType<typeof useFieldTranslation>;
function Probe({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  field = useFieldTranslation({ value, onChange });
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('puts a whole answer in the text’s place into English, and offers the text back while the field holds the answer', async () => {
  const onChange = vi.fn();
  const withdraw = vi.fn();
  toast.undoable.mockReturnValue(withdraw);
  const root = probeRoot();
  const render = (value: string) => act(() => root.render(<Probe value={value} onChange={onChange} />));
  await render('등대를 지킨다.');
  translateOnTool.mockResolvedValue(answer('Keeps the lighthouse.'));
  await act(async () => field.start());
  expect(translateOnTool).toHaveBeenCalledWith({}, '등대를 지킨다.', 'English', expect.any(AbortSignal), expect.any(Function));
  expect(onChange.mock.calls).toEqual([['Keeps the lighthouse.']]);
  await render('Keeps the lighthouse.');
  expect(withdraw).not.toHaveBeenCalled();
  toast.undoable.mock.calls[0]![1]();
  expect(onChange.mock.calls.at(-1)).toEqual(['등대를 지킨다.']);
  // Another text stands in the field: a greeting moved here, or the answer typed over.
  await render('다른 첫인사.');
  expect(withdraw).toHaveBeenCalledTimes(1);
  await act(() => root.unmount());
});

it('leaves the text alone when the answer was cut, failed, or came after the text changed', async () => {
  const onChange = vi.fn();
  const root = probeRoot();
  const render = (value: string) => act(() => root.render(<Probe value={value} onChange={onChange} />));
  await render('등대를 지킨다.');
  translateOnTool.mockResolvedValueOnce(answer('Keeps the', 'cut'));
  await act(async () => field.start());
  translateOnTool.mockResolvedValueOnce({ ok: false, failure: { kind: 'no-model', role: 'aux' } });
  await act(async () => field.start());
  let land: (made: unknown) => void = () => {};
  translateOnTool.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
  await act(async () => field.start());
  expect(field.running).toBe(true);
  await render('등대를 지켰다.');
  await act(async () => land(answer('Keeps the lighthouse.')));
  expect(field.running).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledTimes(3);
  expect(toast.undoable).not.toHaveBeenCalled();
  await act(() => root.unmount());
});
