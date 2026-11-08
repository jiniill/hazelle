import type { Service } from '../../contracts/admin';

// No setting: a server one person uses has no one to moderate, and a second account or anything waiting on the operator
// brings the moderation sections back by itself.
export const moderates = ({ people, pending }: Pick<Service, 'people' | 'pending'>) => people > 1 || pending > 0;
