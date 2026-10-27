import { createContext, useContext } from 'react';

// Null shows pictures. Keep revealed sources for this veil instance only; re-enabling must cover everything again.
export type Veil = { revealed: Set<string> };

export const VeilContext = createContext<Veil | null>(null);

export const useVeil = () => useContext(VeilContext);
