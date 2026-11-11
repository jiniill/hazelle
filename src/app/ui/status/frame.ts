import { createContext } from 'react';
import type { ShownPlace, StatusEdit, StatusFrame } from './shown';

// The 틀 the blocks under a panel are drawn in. A block that sets fields in a line's room (a record's row) gives its own.
export const StatusFrameContext = createContext<StatusFrame>('card');

// Present under a panel whose values are edited by hand (design §6.1 By hand), and the record the fields under it are of.
export const StatusEditContext = createContext<StatusEdit | undefined>(undefined);
export const StatusMemberContext = createContext<ShownPlace['member']>(undefined);

// What stands where a value is not set yet.
export const UNSET = '—';
