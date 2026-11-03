import type { ModelSettings } from '../connectors/settings';
import type { Mark } from './library';

export type Profile = Mark & { name: string; settings: ModelSettings };

// The starter's name, which the default's mark leaves out (words defaultMark).
export const FIRST_PROFILE_NAME = '기본';
