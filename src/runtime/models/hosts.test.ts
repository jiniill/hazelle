import { expect, it } from 'vitest';
import type { Connection } from '../../connectors/types';
import openRouterEndpoints from '../../connectors/fixtures/openrouter-endpoints.json';
import { loadHosts } from './hosts';
import { stubRelay, testServer, upstream } from '../testing';

const server = testServer();

it('lists the hosts the gateway names, says when its answer is not a list, and passes a refusal on', () =>
  server.withSession(async () => {
    const openRouter: Connection = { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'k' }], turns: null, starred: [] };
    const answers = [upstream(200, openRouterEndpoints), upstream(200, { data: {} }), upstream(404, { error: { message: 'Model not found', code: 404 } })];
    stubRelay(() => answers.shift()!);
    expect(await loadHosts(openRouter, 'google/gemini-4-carbon')).toMatchObject({ ok: true, hosts: [{ id: 'google-vertex/global' }, { id: 'google-ai-studio', discount: true }] });
    expect(await loadHosts(openRouter, 'google/gemini-4-carbon')).toEqual({ ok: false, failure: { kind: 'not-hosts' } });
    expect(await loadHosts(openRouter, 'gone')).toMatchObject({ ok: false, failure: { kind: 'provider', status: 404 } });
    expect(loadHosts({ ...openRouter, type: 'openai' }, 'gpt')).toBeNull();
  }));
