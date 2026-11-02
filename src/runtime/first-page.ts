import type { FirstPageStep } from '../contracts/admin';
import { discardBody, fetchApi } from './api';

// Carries the step alone: the server counts it once per address a day (server/visits.ts).
export const countFirstPage = (step: FirstPageStep) =>
  void fetchApi('visits/first-page', { method: 'POST', anonymous: true, keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step }) }).then((response) => discardBody(response.body)).catch(() => {
    // A missing count must not touch the visitor's page.
  });
