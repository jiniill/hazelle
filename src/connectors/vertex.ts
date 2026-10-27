import { bareModel, embedUsage } from './chat-completions';
import { embedContent } from './gemini';
import { ConnectorError, type ConnectionType, type Endpoint } from './types';
import { count, isRecord, vector } from './values';

// Service-account JWT buys a one-hour token. Gemini calls require the project at the global location;
// model listing requires project-free v1beta1 (live-verified 2026-10-13).

// keyId is absent from a key typed as separate values; the token endpoint finds the key by the account without it.
type ServiceAccount = { projectId: string; keyId?: string; privateKey: string; clientEmail: string; tokenUri: string };

const TOKEN_URI = 'https://oauth2.googleapis.com/token';

function serviceAccount(secret: string): ServiceAccount | null {
  let raw: unknown;
  try {
    raw = JSON.parse(secret);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.type !== 'service_account') return null;
  const account = { projectId: raw.project_id, privateKey: raw.private_key, clientEmail: raw.client_email, tokenUri: raw.token_uri };
  if (!Object.values(account).every((field) => typeof field === 'string' && field)) return null;
  return { ...(account as ServiceAccount), ...(typeof raw.private_key_id === 'string' && raw.private_key_id && { keyId: raw.private_key_id }) };
}

// A tool that hands the fields out one by one may write the key's line breaks as the two letters \n.
function joinedAccount(values: Record<string, string>): string {
  const email = values.email!.trim();
  const privateKey = values.key!.trim().replace(/\\n/g, '\n');
  const project = values.project!.trim() || /@([^@.]+)\.iam\.gserviceaccount\.com$/.exec(email)?.[1];
  if (!email || !privateKey || !project) return '';
  return JSON.stringify({ type: 'service_account', project_id: project, private_key: privateKey, client_email: email, token_uri: TOKEN_URI });
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encoded = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

// A key file whose private key is cut short or edited is refused here, before anything is sent.
async function signingKey(pem: string): Promise<CryptoKey> {
  try {
    const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), (char) => char.charCodeAt(0));
    return await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new ConnectorError('unreadable-key');
  }
}

async function signed(account: ServiceAccount, now: number): Promise<string> {
  const key = await signingKey(account.privateKey);
  const iat = Math.floor(now / 1000);
  const body = `${encoded({ alg: 'RS256', typ: 'JWT', ...(account.keyId && { kid: account.keyId }) })}.${encoded({ iss: account.clientEmail, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: account.tokenUri, iat, exp: iat + 3600 })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

export const vertex: ConnectionType = {
  browser: {},
  id: 'vertex',
  label: 'Vertex AI',
  group: 'maker',
  description: '서비스 계정 키(JSON)로 Vertex AI의 Gemini를 써요.',
  keyPage: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
  keyForm: {
    label: '서비스 계정 키',
    lines: 6,
    placeholder: '{ "type": "service_account", … }',
    accept: '.json,application/json',
    parts: {
      label: '프로젝트 ID, 이메일, 키 직접 입력',
      fields: [
        { id: 'project', label: '프로젝트 ID', placeholder: 'my-project', help: '비워 두면 클라이언트 이메일에서 읽어요.' },
        { id: 'email', label: '클라이언트 이메일', placeholder: 'name@my-project.iam.gserviceaccount.com' },
        { id: 'key', label: '프라이빗 키', lines: 4, placeholder: '-----BEGIN PRIVATE KEY-----' },
      ],
      join: joinedAccount,
    },
  },
  detect: { key: /^\{[\s\S]*"type"\s*:\s*"service_account"[\s\S]*\}$/, host: 'aiplatform.googleapis.com' },
  endpointFor(secret): Endpoint | null {
    const account = serviceAccount(secret);
    return account && { baseUrl: `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/locations/global/publishers/google`, protocol: 'gemini' };
  },
  // Asked only of a secret endpointFor read, so it is a service-account key.
  exchange: {
    async request(secret) {
      const account = serviceAccount(secret)!;
      const assertion = await signed(account, Date.now());
      return {
        url: account.tokenUri,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      };
    },
    parse(payload) {
      if (!isRecord(payload) || typeof payload.access_token !== 'string' || !payload.access_token) return null;
      const lasts = payload.expires_in;
      if (typeof lasts !== 'number' || !Number.isFinite(lasts)) return null;
      return { value: payload.access_token, expiresAt: Date.now() + lasts * 1000 };
    },
  },
  headers: (token) => ({ authorization: `Bearer ${token}` }),
  // 300 is the most a page holds (a larger size is refused with 400); a later page (nextPageToken) is not asked for.
  listModels: () => ({ url: 'https://aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=300', method: 'GET', headers: {}, body: null }),
  // The list names models and nothing of what they take or give; models.dev's google-vertex list fills what it knows.
  parseModels(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.publisherModels)) return null;
    return payload.publisherModels.flatMap((raw) => {
      const id = isRecord(raw) && typeof raw.name === 'string' ? raw.name.split('/').at(-1) : '';
      return id ? [bareModel(id)] : [];
    });
  },
  usagePage: 'https://console.cloud.google.com/billing',
  // Gemini Embedding 2 requires global :embedContent, one input per request; no batchEmbedContents or :predict.
  // Older :predict-only models fail upstream (REST reference/client reports, 2026-10-20; not live-verified).
  embeds: {
    perRequest: 1,
    request: (endpoint, model, [text], as, fields) => ({
      url: `${endpoint.baseUrl}/models/${model.id}:embedContent`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...embedContent(model, text!, as), ...fields }),
    }),
    parse(payload) {
      if (!isRecord(payload) || !isRecord(payload.embedding) || !vector(payload.embedding.values)) return null;
      const usage = isRecord(payload.usageMetadata) ? payload.usageMetadata : {};
      return { vectors: [payload.embedding.values], usage: embedUsage(count(usage.promptTokenCount)), raw: usage };
    },
  },
  // Flex PayGo needs both headers on the global endpoint; one alone permits Provisioned Throughput first.
  // Half input/output; unspecified cache discounts stay full-price. Eligibility remains unknown.
  // Do not classify 429 RESOURCE_EXHAUSTED as Flex capacity: ordinary project quota uses it too
  // (docs.cloud.google.com/vertex-ai/generative-ai/docs/flex-paygo, 2026-10-14; no live refusal verified).
  discount: {
    lane: 'tier',
    headers: { 'x-vertex-ai-llm-request-type': 'shared', 'x-vertex-ai-llm-shared-request-type': 'flex' },
    served: 'ON_DEMAND_FLEX',
    busy: () => false,
    accepted: null,
    rates: { input: 0.5, output: 0.5, cacheRead: 1, cacheWrite: 1 },
  },
};
