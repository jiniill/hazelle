import { expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { unpack } from '../src/engine/import/risum';

export const FAKE_MODEL = 'fake-model';
export const FAKE_EMBED = 'fake-embed';
export const DESCRIPTION = 'Mira keeps the lantern inn at the edge of the marsh.';

export const CARD = {
  name: 'mira.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Mira',
        description: DESCRIPTION,
        first_mes: "Welcome to the inn. Tonight's omen is {{random::amber::birch}}.",
        character_book: { entries: [{ keys: ['lantern'], content: 'The lantern never goes out.', enabled: true, insertion_order: 1 }] },
        extensions: { risuai: { customScripts: [{ comment: 'bow', in: '\\[\\[bow\\]\\]', out: '(bows)', type: 'editdisplay' }] } },
      },
    }),
  ),
};

// A 1x1 PNG.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// A bot's HTML at its worst: nothing in it may run, post, load from outside or cover the app (design §6.4).
export const HOSTILE = {
  name: 'hostile.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Hostile',
        description: '',
        first_mes: [
          '<div id="cover" style="position: fixed; inset: 0; background: rgb(200, 0, 0)">cover</div>',
          '<img id="outside" src="https://example.com/a.png" onerror="window.ran = 1"><script>window.ran = 1</script>',
          '<form action="https://example.com/post"><input id="field"></form>',
          '<a id="out" href="https://example.com">out</a> <a id="js" href="javascript:window.ran = 1">js</a>',
          '<div id="tone" class="x-risu-tone" style="background: url(https://example.com/b.png)">tone</div>',
          '{{button::누르기::go}}',
          '',
          '*nods* "hello"',
          '',
          '<div id="pic">{{img::smile}}</div><div id="backdrop" style="background-image: url( &quot;{{raw::smile}}&quot; )">backdrop</div>',
        ].join('\n'),
        assets: [{ type: 'x-risu-asset', uri: `data:image/png;base64,${PIXEL}`, name: 'smile', ext: 'png' }],
        extensions: { risuai: { backgroundHTML: '<style>.tone { color: rgb(0, 128, 0) }</style>' } },
      },
    }),
  ),
};

// A bot whose Lua answers a button, speaks, rewrites what is shown and edits a reply once it is saved (design §6.8).
export const SCRIPTED = {
  name: 'scripted.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Scripted',
        description: '',
        first_mes: 'The door is shut. {{button::문 열기::open}}',
        extensions: {
          risuai: {
            triggerscript: [
              {
                comment: 'main',
                type: 'start',
                conditions: [],
                effect: [
                  {
                    type: 'triggerlua',
                    code: [
                      "function open(id) setChatVar(id, 'door', 'open') alertNormal(id, '문이 열렸어요') end",
                      "listenEdit('editDisplay', function(id, value) return value .. ' [door:' .. getChatVar(id, 'door') .. ']' end)",
                      "function onOutput(id) setChat(id, -1, getChat(id, -1).data .. ' (seen)') end",
                    ].join('\n'),
                  },
                ],
              },
            ],
          },
        },
      },
    }),
  ),
};

// Use the self-host local-provider allowlist for the in-process plain-HTTP fake.
// Retain chat bodies and embedding requests separately for assertions.
export const FAKE_PROVIDER = '127.0.0.1:4419';
export const FAKE_ADDRESS = `http://${FAKE_PROVIDER}/v1`;

const REPLY = ['{{char}} smiles. ', '[[bow]]'];
export type FakeChatRequest = { model: string; messages: { role: string; content: string }[]; stream?: boolean; tools?: unknown[] };
// A part of a reply: text, or a tool call, which streams its arguments in two pieces.
export type FakePart = string | { call: string; arguments: string };
let reply: (request: FakeChatRequest) => readonly FakePart[] = () => REPLY;
let heard: unknown[] = [];
export type FakeEmbedRequest = { model: string; input: string[] };
export const embedded: FakeEmbedRequest[] = [];

// Hashed word counts in 64 dimensions, normalized: texts sharing words are the nearest.
function vectorOf(text: string): number[] {
  const vector = Array.from({ length: 64 }, () => 0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
    vector[hash % 64]! += 1;
  }
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}
let listening: Promise<void> | null = null;

function upstream(): Promise<void> {
  listening ??= new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      if (request.url === '/v1/models') return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: FAKE_MODEL }, { id: FAKE_EMBED }] }));
      if (request.url === '/v1/embeddings') {
        const asked = JSON.parse(Buffer.concat(chunks).toString()) as FakeEmbedRequest;
        embedded.push(asked);
        const data = asked.input.map((text, index) => ({ object: 'embedding', index, embedding: vectorOf(text) }));
        return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data, model: asked.model, usage: { prompt_tokens: asked.input.length, total_tokens: asked.input.length } }));
      }
      if (request.url !== '/v1/chat/completions') return response.writeHead(404).end();
      const body = JSON.parse(Buffer.concat(chunks).toString()) as FakeChatRequest;
      heard.push(body);
      const parts = reply(body);
      const texts = parts.filter((part) => typeof part === 'string');
      const calls = parts.flatMap((part) => (typeof part === 'string' ? [] : [part])).map((part, index) => ({ index, id: `call_${index}`, type: 'function', function: { name: part.call, arguments: part.arguments } }));
      const finish = calls.length ? 'tool_calls' : 'stop';
      if (body.stream === false) return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: texts.join(''), ...(calls.length && { tool_calls: calls }) }, finish_reason: finish }] }));
      const half = (text: string) => [text.slice(0, text.length >> 1), text.slice(text.length >> 1)];
      const called = calls.flatMap(({ index, id, type, function: { name, arguments: text } }) => half(text).map((piece, at) => ({ choices: [{ delta: { tool_calls: [at ? { index, function: { arguments: piece } } : { index, id, type, function: { name, arguments: piece } }] } }] })));
      const events = [...texts.map((content) => ({ choices: [{ delta: { content } }] })), ...called, { choices: [{ delta: {}, finish_reason: finish }] }];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end([...events.map((event) => JSON.stringify(event)), '[DONE]'].map((data) => `data: ${data}\n\n`).join(''));
    });
    const [host, port] = FAKE_PROVIDER.split(':');
    server.on('error', reject).listen(Number(port), host, () => resolve());
    server.unref();
  });
  return listening;
}

export async function fakeProvider(answer: (request: FakeChatRequest) => readonly FakePart[] = () => REPLY): Promise<unknown[]> {
  await upstream();
  heard = [];
  embedded.length = 0;
  reply = answer;
  return heard;
}

// A module file as Risu writes one (src/engine/import/risum.ts), encoded with the inverse of the decode table.
function risum(module: unknown): Buffer {
  const encode = new Uint8Array(256);
  unpack(Uint8Array.from({ length: 256 }, (_, byte) => byte)).forEach((plain, packed) => (encode[plain] = packed));
  const main = Buffer.from(JSON.stringify({ type: 'risuModule', module })).map((byte) => encode[byte]!);
  return Buffer.concat([Buffer.from([111, 0]), Buffer.from(new Uint32Array([main.length]).buffer), main, Buffer.from([0])]);
}

// A module whose display script draws a state and a button under every message, and whose block trigger answers the
// button (design §6.5): its operand is CBS, which the run evaluates in its worker.
export const MODULE = {
  name: 'bell.risum',
  mimeType: 'application/octet-stream',
  buffer: risum({
    name: 'Bell',
    description: '',
    id: 'e2e-bell',
    regex: [{ comment: 'bell', in: '$', out: ' [bell:{{getvar::bell}}] {{button::벨 울리기::ring}}', type: 'editdisplay' }],
    trigger: [
      {
        comment: 'ring',
        type: 'manual',
        conditions: [],
        effect: [
          { type: 'setvar', operator: '=', var: 'bell', value: '{{? 1+1}}' },
          { type: 'showAlert', alertType: 'normal', value: '따르릉' },
        ],
      },
    ],
  }),
};

const E2E_PASSWORD = 'e2e-password';

const saveRecoveryKey = async (page: Page) => {
  await page.getByRole('button', { name: '복구 키 파일 내보내기', exact: true }).click();
  await page.getByLabel('안전한 곳에 저장했어요', { exact: true }).check();
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
};

// An installation that admits more than one account opens as a guest (design F1); its home card holds both doors, and
// 계정 만들기 turns that guest into an account.
export async function signUpAsGuest(page: Page, username: string, password: string) {
  await page.getByRole('button', { name: '계정 만들기', exact: true }).click();
  await page.getByLabel('아이디', { exact: true }).fill(username);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByLabel('비밀번호 확인', { exact: true }).fill(password);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await saveRecoveryKey(page);
}

// The suite's servers keep the default cap of one, which makes them one person's: the first visit sets the password, and
// every later sign-in asks for it alone.
const settingUp = (page: Page) => page.getByRole('heading', { name: '비밀번호 설정', exact: true });
export async function setUp(page: Page, password: string) {
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByLabel('비밀번호 확인', { exact: true }).fill(password);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await saveRecoveryKey(page);
}

// true when it set the installation up.
export async function enter(page: Page, password = E2E_PASSWORD): Promise<boolean> {
  await page.goto('/');
  const signin = page.getByRole('button', { name: '로그인', exact: true });
  await expect(settingUp(page).or(signin)).toBeVisible();
  // flow.spec.ts sets the suite's server up; a spec run alone sets up its own fresh server.
  if (await signin.isVisible()) {
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await signin.click();
    await expect(signin).toBeHidden();
    return false;
  }
  await setUp(page, password);
  await expect(page.getByRole('heading', { name: '비어 있어요', exact: true })).toBeVisible();
  return true;
}

// 봇 가져오기 sits in the rail's + menu on wide screens.
export async function pickBot(page: Page) {
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('menuitem', { name: '봇 가져오기', exact: true }).click();
}

// button: a button's name, or what opens the file picker, such as pickBot.
export async function importFile(page: Page, button: string | ((page: Page) => Promise<void>), file: string | typeof CARD) {
  const chooser = page.waitForEvent('filechooser');
  if (typeof button === 'string') await page.getByRole('button', { name: button, exact: true }).first().click();
  else await button(page);
  const notice = page.getByRole('button', { name: '확인했어요', exact: true });
  if (await notice.isVisible()) await notice.click();
  await (await chooser).setFiles(file);
  return confirmImport(page);
}

// Files picked or dropped show what they hold first; 가져오기 saves them and the same dialog becomes their report.
export async function confirmImport(page: Page) {
  await page.getByRole('dialog', { name: '가져올까요?', exact: true }).getByRole('button', { name: '가져오기', exact: true }).click();
  const report = page.getByRole('dialog', { name: '가져왔어요', exact: true });
  await expect(report).toBeVisible();
  return report;
}

// A write shows at once and reaches the server after; a navigation before it lands loses it.
export const saving = (page: Page) => page.waitForResponse((response) => response.url().includes('/api/objects/batch') && response.request().method() === 'POST');

// A settings page from the settings sidebar, whose rows read their label then what the page holds (모델 2개).
export const settingsPage = (page: Page, label: string) =>
  page.getByRole('navigation', { name: '설정' }).getByRole('button', { name: new RegExp(`^${label}( |$)`) }).click();

// Start a separate built server/port/data directory for destructive lifecycle or open-signup specs.
// Keep the suite's same fake-provider allowlist.
export async function startServer(port: number, data: string, fresh = false, env: Record<string, string> = {}): Promise<ChildProcess> {
  const health = () => fetch(`http://localhost:${port}/api/health`).then((response) => response.status, () => 0);
  // A server an earlier run left on the port would answer for this one; its data directory is checked for only after.
  expect(await health()).toBe(0);
  if (fresh) rmSync(data, { recursive: true, force: true });
  const server = spawn(process.execPath, ['dist/server/node.js'], {
    env: { ...process.env, HAZELLE_DATA: data, HAZELLE_CLIENT: 'dist/client', PORT: String(port), HAZELLE_LOCAL_PROVIDERS: FAKE_PROVIDER, ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await expect.poll(health, { timeout: 30_000 }).toBe(200);
  return server;
}

// SIGTERM drains and closes the databases; SIGKILL is a crash, with whatever the WAL holds.
export async function stopServer(server: ChildProcess, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') {
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill(signal);
  await exited;
}
