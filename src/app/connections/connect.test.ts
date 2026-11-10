import { expect, it, vi } from 'vitest';
import type { Connection } from '../../connectors/types';
import type { Session } from '../../runtime/session';
import { navigate } from '../shell/router';
import { connect } from './connect';

vi.mock('../../runtime/models/connections', () => ({ addConnection: async () => ({ ok: true, id: 'made' }) }));
vi.mock('../shell/router', () => ({ navigate: vi.fn() }));

it('opens the new connection only while the screen that made it is there', async () => {
  const left = new AbortController();
  left.abort();
  expect(await connect({} as Session, {} as Connection, left.signal)).toBeNull();
  expect(navigate).not.toHaveBeenCalled();

  await connect({} as Session, {} as Connection, new AbortController().signal);
  expect(navigate).toHaveBeenCalledWith({ kind: 'connection', id: 'made' }, { replace: true });
});
