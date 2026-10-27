import type { Mark } from './library';

// Personas keep only a thumbnail, never an original picture. Modules follow the character's in activation order.
export type Persona = Mark & { name: string; description: string; picture: string | null; alias?: string; modules?: string[]; folder?: string };
