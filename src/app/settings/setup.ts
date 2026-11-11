import { refOf, sameModelRef, type ModelRef, type Role } from '../../connectors/assignment';
import { entryName } from '../../connectors/types';
import { FEATURE_LABS, type Feature } from '../../model/features';
import type { Stored } from '../../model/kinds';
import type { Route, RouteFailure, RolePick } from '../../runtime/models/assignment';
import type { Overview, TaskRun } from '../../runtime/tasks/overview';
import {
  describeIllustrateFailure,
  describeMascotFailure,
  describeMemoryFailure,
  describePrereadFailure,
  describeRoleFailure,
  describeTranslateFailure,
  describeTurnFailure,
} from '../common/failure';
import { taskRuns, type TaskRuns } from '../common/taskRuns';
import { EMPTY_VALUE, FEATURE_NAMES, FEATURES_TITLE, follows, IDLE_MODELS, LAB, MODEL_PINNED, MODEL_ROLES, NOT_PICKED, NOT_STARRED, onOff, PAGES, promptName, SCOPE, STARRED } from '../common/words';
import type { FlowColumn, FlowEdge, FlowKind, FlowNode } from '../ui';

// 내 구성: the map and what needs fixing, both read off one Overview (runtime/tasks/overview).

export const ROLES_TITLE = '역할';
export const LEGEND: Partial<Record<FlowKind, string>> = { follow: '기본 모델 사용', own: '직접 지정', gap: EMPTY_VALUE, off: '꺼진 기능' };

const nodeOf = {
  connection: (id: string) => `c:${id}`,
  model: (ref: ModelRef) => `m:${ref.connection}/${ref.model}`,
  role: (role: Role) => `r:${role}`,
  feature: (feature: Feature | 'talk') => `f:${feature}`,
};
const routeNode = (route: Route) => nodeOf.model(refOf(route.connection.id, route.model));

export type Finding = { node: string; title: string; why: string };
// What a node stands for, which its detail opens.
export type Target = { kind: 'connection'; connection: Stored<'connection'> } | { kind: 'model'; ref: ModelRef; name: string } | { kind: 'role'; role: Role } | { kind: 'talk'; pins: Overview['talk']['pins'] } | { kind: 'task'; task: TaskRun };

export function saidOf(task: TaskRun): TaskRuns {
  switch (task.feature) {
    case 'translate':
      return taskRuns(task.runs, describeTranslateFailure);
    case 'illustrate':
      return taskRuns(task.runs, describeIllustrateFailure);
    case 'memory':
      return taskRuns(task.runs, describeMemoryFailure);
    case 'mascot':
      return taskRuns(task.runs, describeMascotFailure);
    case 'preread':
      return taskRuns(task.runs, describePrereadFailure);
  }
}

// Why a task cannot run now: on the model that writes for it, and 삽화 on the one that draws.
function whyNot(task: TaskRun) {
  const runs = saidOf(task);
  return { writes: 'why' in runs ? runs.why : undefined, draws: task.feature === 'illustrate' && 'kind' in task.draws ? describeIllustrateFailure(task.draws) : undefined };
}
// 장기 기억 kept by a plugin runs on no model of the chat's.
const running = (task: TaskRun, available: readonly Feature[]) => available.includes(task.feature) && task.on && !(task.feature === 'memory' && task.by !== null);
const promptWhy = ({ prompt }: Overview['talk']) => (prompt.kind === 'missing' ? describeTurnFailure({ kind: 'prompt-missing', own: prompt.own }) : undefined);

// 대화 and each feature that is on and cannot run now, with why, whatever the cause: what a list of them marks beside 켬.
export function failingOf({ roles, talk, tasks }: Overview, available: readonly Feature[]): Partial<Record<Feature | 'chat', string>> {
  const failing: Partial<Record<Feature | 'chat', string>> = {};
  const chat = 'kind' in roles.main.runs ? describeRoleFailure('main', roles.main.runs) : promptWhy(talk);
  if (chat) failing.chat = chat;
  for (const task of tasks) {
    const { writes, draws } = whyNot(task);
    const why = writes ?? draws;
    if (running(task, available) && why) failing[task.feature] = why;
  }
  return failing;
}

const NO_EMBED = `${MODEL_ROLES.embed}이 지정되지 않아서 ${FEATURE_NAMES.memory}이 비슷한 기록을 찾아 넣지 않아요.`;

// What fails now, truthfully: each said once, where it starts. A task that follows a 보조 모델 which fails is that
// role's finding, not its own.
export function findingsOf({ roles, talk, tasks }: Overview, available: readonly Feature[]): Finding[] {
  const found: Finding[] = [];
  const role = (each: Role, runs: RouteFailure) => found.push({ node: nodeOf.role(each), title: MODEL_ROLES[each], why: describeRoleFailure(each, runs) });
  if ('kind' in roles.main.runs) role('main', roles.main.runs);
  if ('kind' in roles.aux.runs && roles.aux.from?.role === 'aux') role('aux', roles.aux.runs);
  const prompt = promptWhy(talk);
  if (prompt) found.push({ node: nodeOf.feature('talk'), title: PAGES.chat, why: prompt });
  for (const task of tasks) {
    if (!running(task, available)) continue;
    const at = { node: nodeOf.feature(task.feature), title: FEATURE_NAMES[task.feature] };
    const { writes, draws } = whyNot(task);
    if (writes && (task.own !== undefined || !('kind' in roles.aux.runs))) found.push({ ...at, why: writes });
    if (draws) found.push({ ...at, why: draws });
    if (task.feature === 'memory' && 'kind' in roles.embed.runs) {
      const runs = roles.embed.runs;
      found.push({ node: nodeOf.role('embed'), title: MODEL_ROLES.embed, why: runs.kind === 'no-model' ? NO_EMBED : describeRoleFailure('embed', runs) });
    }
  }
  return found;
}

const SHORT: Record<RouteFailure['kind'], string> = { 'no-model': NOT_PICKED, 'model-gone': NOT_STARRED, 'image-only': '이미지만 만드는 모델' };
const NEEDS_LOOK = '확인 필요';
const APART = SCOPE.character;
const LAYERS = { chat: SCOPE.chat, prompt: MODEL_PINNED, settings: undefined };

function roleNode(role: Role, { runs, from }: RolePick): Omit<FlowNode, 'id'> {
  if ('kind' in runs) return { lead: MODEL_ROLES[role], title: SHORT[runs.kind] };
  return { lead: MODEL_ROLES[role], title: entryName(runs.model), note: from && from.role !== role ? follows(MODEL_ROLES[from.role]) : from ? LAYERS[from.layer] : undefined };
}

function taskNode(task: TaskRun): Omit<FlowNode, 'id' | 'tone'> {
  const badge = !task.on ? onOff(false) : task.apart ? APART : FEATURE_LABS[task.feature] ? LAB : undefined;
  const note = task.feature === 'memory' && task.by !== null ? `플러그인 · ${task.by}` : 'route' in task.runs ? (task.own ? entryName(task.runs.route.model) : follows(MODEL_ROLES.aux)) : NEEDS_LOOK;
  return { title: FEATURE_NAMES[task.feature], badge, note };
}

// Lines run from a connection to its models, from a model to the role or feature that picked it, and from a role to
// what follows it; a line to a feature that is off is drawn as off.
export function mapOf(overview: Overview, connections: readonly Stored<'connection'>[], available: readonly Feature[], findings: readonly Finding[]): { columns: FlowColumn[]; edges: FlowEdge[]; targets: Map<string, Target> } {
  const { roles, talk } = overview;
  const tasks = overview.tasks.filter(({ feature }) => available.includes(feature));
  const tone = (id: string, on = true): FlowNode['tone'] => (findings.some(({ node }) => node === id) ? 'warn' : on ? 'plain' : 'off');
  const role = (each: Role): FlowNode => ({ id: nodeOf.role(each), ...roleNode(each, roles[each]), tone: tone(nodeOf.role(each)) });
  const starred = connections.flatMap((connection) => connection.value.starred.map((model) => ({ ref: refOf(connection.id, model), model, connection })));
  const columns: FlowColumn[] = [
    { title: PAGES.connections, nodes: connections.map(({ id, value }) => ({ id: nodeOf.connection(id), title: value.label, note: `모델 ${value.starred.length}개` })) },
    { title: STARRED, idle: IDLE_MODELS, nodes: starred.map(({ ref, model, connection }) => ({ id: nodeOf.model(ref), title: entryName(model), note: connection.value.label, tone: tone(nodeOf.model(ref), overview.used.some((each) => sameModelRef(each, ref))) })) },
    { title: ROLES_TITLE, nodes: [role('main'), role('aux'), role('embed')] },
    {
      title: FEATURES_TITLE,
      nodes: [
        { id: nodeOf.feature('talk'), title: PAGES.chat, note: talk.prompt.kind === 'prompt' ? promptName(talk.prompt.prompt.value.name) : NEEDS_LOOK, badge: talk.pins.length ? `${MODEL_PINNED} ${talk.pins.length}` : undefined, tone: tone(nodeOf.feature('talk')) },
        ...tasks.map((task) => ({ id: nodeOf.feature(task.feature), ...taskNode(task), tone: tone(nodeOf.feature(task.feature), task.on) })),
      ],
    },
  ];

  const edges: FlowEdge[] = starred.map(({ ref, connection }) => ({ from: nodeOf.connection(connection.id), to: nodeOf.model(ref), kind: 'follow' }));
  for (const each of ['main', 'aux', 'embed'] as const) {
    const { runs, from } = roles[each];
    if (!('kind' in runs)) edges.push({ from: routeNode(runs), to: nodeOf.role(each), kind: from?.layer === 'settings' || from?.role !== each ? 'follow' : 'own', label: from?.layer === 'prompt' ? MODEL_PINNED : undefined });
  }
  edges.push({ from: nodeOf.role('main'), to: nodeOf.feature('talk'), kind: 'follow' });
  for (const { ref } of talk.pins) edges.push({ from: nodeOf.model(ref), to: nodeOf.feature('talk'), kind: 'own', label: MODEL_PINNED });
  for (const task of tasks) {
    const to = nodeOf.feature(task.feature);
    const off = (kind: FlowKind): FlowKind => (task.on ? kind : 'off');
    if (task.feature === 'memory' && task.by !== null) continue;
    if (task.own === undefined) edges.push({ from: nodeOf.role('aux'), to, kind: off('follow') });
    else if ('route' in task.runs) edges.push({ from: routeNode(task.runs.route), to, kind: off('own') });
    if (task.feature === 'illustrate' && !('kind' in task.draws)) edges.push({ from: routeNode(task.draws), to, kind: off('follow'), label: '이미지' });
    if (task.feature === 'memory') edges.push({ from: nodeOf.role('embed'), to, kind: off('kind' in roles.embed.runs ? 'gap' : 'follow') });
  }
  const targets = new Map<string, Target>([
    ...connections.map((connection) => [nodeOf.connection(connection.id), { kind: 'connection', connection }] as const),
    ...starred.map(({ ref, model }) => [nodeOf.model(ref), { kind: 'model', ref, name: entryName(model) }] as const),
    ...(['main', 'aux', 'embed'] as const).map((each) => [nodeOf.role(each), { kind: 'role', role: each }] as const),
    [nodeOf.feature('talk'), { kind: 'talk', pins: talk.pins }] as const,
    ...tasks.map((task) => [nodeOf.feature(task.feature), { kind: 'task', task }] as const),
  ]);
  return { columns, edges: edges.filter(({ from, to }) => targets.has(from) && targets.has(to)), targets };
}
