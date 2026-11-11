import { createContext } from 'react';
import type { StatusFrame } from './shown';

// The 틀 the blocks under a panel are drawn in. A block that sets fields in a line's room (a record's row) gives its own.
export const StatusFrameContext = createContext<StatusFrame>('card');

// What stands where a value is not set yet.
export const UNSET = '—';
