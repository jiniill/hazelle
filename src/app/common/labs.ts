import { labOn, type LabId } from '../../model/settings';
import { useSettings } from '../session';
import { AGENTS, AGENTS_HELP, CACHE_GUARD, CACHE_GUARD_HELP, PRE_READ, PRE_READ_HELP } from './words';

type Lab = { id: LabId; name: string; help: string };

// Experiments may add separately hidden data, never change existing stored shapes (user ruling).
// Ending an experiment deletes its entry and losing path together; disabling retains its data.
export const LABS: readonly Lab[] = [
  { id: 'preread', name: PRE_READ, help: PRE_READ_HELP },
  { id: 'agents', name: AGENTS, help: AGENTS_HELP },
  { id: 'cacheguard', name: CACHE_GUARD, help: CACHE_GUARD_HELP },
];

export const useLab = (id: LabId) => labOn(useSettings(), id);
