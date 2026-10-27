import { labOn, type LabId } from '../../model/settings';
import { useSettings } from '../session';
import { AGENTS, AGENTS_HELP, CACHE_GUARD, CACHE_GUARD_HELP, PRE_READ, PRE_READ_HELP } from './words';

type Lab = { id: LabId; name: string; help: string };

// The experiments running, each a switch on 설정 › 실험실. An experiment ends by deleting its entry together with the
// path that lost (design.md, 실험실). It may add stored data the old path does not read, never change a stored shape
// (user ruling): turned off, its data stays hidden and comes back when turned on.
export const LABS: readonly Lab[] = [
  { id: 'preread', name: PRE_READ, help: PRE_READ_HELP },
  { id: 'agents', name: AGENTS, help: AGENTS_HELP },
  { id: 'cacheguard', name: CACHE_GUARD, help: CACHE_GUARD_HELP },
];

export const useLab = (id: LabId) => labOn(useSettings(), id);
