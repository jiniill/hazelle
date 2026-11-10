import type { PriceTable } from '../../connectors/models-dev';
import { api } from '../api';

export const readPriceTable = (signal?: AbortSignal) => api<PriceTable>('GET', 'models-dev/table', undefined, signal);
