//@api 1
//@name recall
//@author hazelle
//@display-name 회상 기억
//@version 1.0.0
//@description 대화를 묶음으로 요약하고 비슷한 기억을 찾아 넣어요
//@uses model
//@uses embed
//@uses memory
//@action redo 다시 정리
//@composer 회상
//@input loud 크게 쓰기
//@setting {"key":"chunk","type":"number","label":"요약 단위","default":4,"composer":true}

/* global hazelle */

// One node per closed chunk: the messages it covers, its summary and the summary's vector.
const nodesOf = async (chat) => (await chat.data.get('nodes')) ?? [];

const cosine = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);

async function index(chat) {
  const { chunk } = await hazelle.settings();
  const messages = await chat.messages();
  const nodes = await nodesOf(chat);
  const covered = new Set(nodes.flatMap((node) => node.covers));
  const open = messages.filter((message) => !covered.has(message.id));
  let changed = false;
  // The last message always stays raw, so a chunk closes only with a message after it.
  while (open.length > chunk) {
    const part = open.splice(0, chunk);
    const answer = await chat.model('aux', [
      { role: 'system', content: 'RECALL_SUMMARY' },
      ...part.map(({ role, text }) => ({ role: role === 'user' ? 'user' : 'assistant', content: text })),
    ]);
    if (!answer.ok) return chat.say(`요약하지 못했어요: ${answer.reason}`, 'error');
    const embedded = await chat.embed([answer.text], 'document');
    if (!embedded.ok) return chat.say(`임베딩하지 못했어요: ${embedded.reason}`, 'error');
    nodes.push({ covers: part.map(({ id }) => id), text: answer.text, vector: embedded.vectors[0], model: embedded.model, stale: false });
    chat.badge(part.at(-1).index, '요약됨');
    changed = true;
  }
  if (changed) chat.data.set('nodes', nodes);
}

hazelle.on('reply', index);

hazelle.on('prompt', async (chat, turn) => {
  const nodes = await nodesOf(chat);
  // Memory stands for the messages from the first on, so it stops at the first stale node.
  const kept = [];
  for (const node of nodes) {
    if (node.stale) break;
    kept.push(node);
  }
  const memory = turn.memory && kept.length ? { text: kept.map(({ text }) => text).join('\n'), through: kept.at(-1).covers.at(-1) } : undefined;
  const asked = (await chat.messages()).filter(({ role }) => role === 'user').at(-1);
  if (!asked || !kept.length) return { memory };
  const query = await chat.embed([asked.text], 'query');
  if (!query.ok) return { memory };
  const best = kept.filter(({ model }) => model === query.model).sort((a, b) => cosine(b.vector, query.vectors[0]) - cosine(a.vector, query.vectors[0]))[0];
  return { memory, tool: best ? `RECALL: ${best.text}` : null };
});

hazelle.on('change', async (chat, change) => {
  if (change.kind !== 'edit' && change.kind !== 'delete') return;
  const nodes = await nodesOf(chat);
  const hit = nodes.find((node) => node.covers.includes(change.id));
  if (!hit) return;
  hit.stale = true;
  chat.data.set('nodes', nodes);
});

hazelle.on('branch', async (chat, from) => {
  const nodes = await nodesOf(chat);
  chat.data.set('nodes', nodes.map((node) => ({ ...node, covers: node.covers.map((id) => from.messages[id] ?? id) })));
});

hazelle.on('input', (chat, item, text) => (item === 'loud' ? text.toUpperCase() : undefined));

hazelle.on('action', async (chat, item, message) => {
  if (item !== 'redo') return;
  const sure = await chat.ask({ kind: 'confirm', text: '이 부분을 다시 정리할까요?' });
  if (sure !== 'yes') return;
  const nodes = await nodesOf(chat);
  chat.data.set('nodes', nodes.filter((node) => !node.covers.includes(message.id)));
});
