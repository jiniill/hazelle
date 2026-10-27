import path from 'node:path';

// Assign modules to their longest matching repo-relative area; tests inherit their subject's area.
// Allow imports/types/tests edges explicitly; unknown areas fail lint until assigned.
const RUNTIME_IMPORTS = ['toolApi', 'changeSignal', 'contracts', 'model', 'engine', 'connectors', 'modelsDev', 'vault'];
const BELOW_APP = ['runtime', ...RUNTIME_IMPORTS];
const FEATURES = ['account', 'admin', 'library', 'chat', 'connections', 'models', 'prompts', 'personas', 'modules', 'settings', 'share', 'pulse', 'tools', 'board'];
const FEATURE = {
  imports: ['ui', 'routes', 'common', 'root', ...BELOW_APP],
  why: 'a feature folder imports no other feature folder and nothing from the shell but routes and router (only the shell and main.tsx compose features), and reaches the server over HTTP only.',
};
const AREAS = {
  toolApi: { paths: ['src/tool-api'], why: 'the public tool contract imports no application code.' },
  sandbox: { paths: ['src/sandbox'], imports: ['toolApi'], why: 'the sandbox reaches only the public tool contract.' },
  changeSignal: { paths: ['src/change-signal'], why: 'argument-free change notifications import no application or environment code.' },
  contracts: { paths: ['src/contracts'], why: 'wire values shared by the server and client import no other layer.' },
  connectors: {
    paths: ['src/connectors'],
    imports: ['modelsDev', 'destination'],
    why: 'connectors are the provider contract the engine and the model build on, so they import no other layer, and touch no DOM, network or storage so their golden tests run in node.',
  },
  modelsDev: { paths: ['src/connectors/models-dev'], why: 'which models.dev list a connection type reads, the words it uses for inputs and outputs, and its shape, is data and types only, shared by the connectors and the server.' },
  destination: { paths: ['src/connectors/destination'], why: 'how an address is matched against the operator\'s local providers is shared by 직접 연결 and the server\'s outbound policy, so it imports nothing.' },
  engine: {
    paths: ['src/engine'],
    imports: ['connectors', 'toolApi'],
    types: ['model'],
    why: 'the engine stays free of UI, network, storage and server code so its golden tests run in node, and takes only types from the model; the tool contract imports no application code, so its values keep the engine node-pure.',
  },
  model: {
    paths: ['src/model'],
    types: ['toolApi', 'connectors', 'engine', 'vault'],
    why: 'the model is pure domain, saved values and what is computed from them with no I/O, and takes only types from connectors, the engine and the vault (a stored file\'s reference).',
  },
  vault: { paths: ['src/vault'], why: 'the vault is crypto and device storage only; it never reaches the network.' },
  server: {
    paths: ['src/server'],
    imports: ['contracts', 'modelsDev', 'destination'],
    why: 'the server knows nothing about the client or providers, but their wire contracts, which models.dev lists to keep (connectors/models-dev) and how a local provider\'s address is matched (connectors/destination).',
  },
  runtime: {
    paths: ['src/runtime'],
    imports: RUNTIME_IMPORTS,
    tests: ['harness'],
    why: 'the runtime is below the UI and reaches the server over HTTP only; only its tests run the server, through the harness.',
  },
  harness: { paths: ['src/runtime/testing'], imports: ['runtime', 'server', 'sandbox', ...RUNTIME_IMPORTS], why: 'the runtime tests\' harness is below the UI.' },
  ui: { paths: ['src/app/ui'], imports: ['changeSignal'], why: 'the kit imports only the argument-free change signal outside src/app/ui, so a component never reaches the session, router, toasts, a screen or the layers below.' },
  routes: { paths: ['src/app/shell/routes', 'src/app/shell/router'], imports: BELOW_APP, why: 'the route table and router are what features take from the shell, so they compose nothing.' },
  shell: {
    paths: ['src/app/shell'],
    imports: ['ui', 'routes', 'common', 'root', ...FEATURES, ...BELOW_APP],
    why: 'the shell composes the features and reaches the server over HTTP only.',
  },
  ...Object.fromEntries(FEATURES.map((name) => [name, { paths: [`src/app/${name}`], ...FEATURE }])),
  common: { paths: ['src/app/common'], ...FEATURE },
  root: {
    paths: ['src/app/session', 'src/app/display', 'src/app/toast', 'src/app/shortcuts'],
    imports: ['ui', 'common', ...BELOW_APP],
    why: 'session, display, toast and shortcuts are read by every feature, so they compose no feature and take nothing from the shell.',
  },
  main: { paths: ['src/app/main'], imports: ['ui', 'shell', 'routes', 'common', 'root', ...FEATURES, ...BELOW_APP], why: 'main.tsx reaches the server over HTTP only.' },
};

const REPO = path.dirname(import.meta.dirname);
const BY_LENGTH = Object.entries(AREAS)
  .flatMap(([name, { paths }]) => paths.map((at) => ({ at, name })))
  .sort((a, b) => b.at.length - a.at.length);
const modulePath = (file) => path.relative(REPO, file).replace(/(\.test)?\.[jt]sx?$/, '');
const areaOf = (module) => BY_LENGTH.find(({ at }) => module === at || module.startsWith(`${at}/`))?.name;

export default {
  meta: {
    messages: {
      forbidden: '{{from}} may not import {{to}}: {{why}} (eslint/boundaries.js)',
      typesOnly: '{{from}} takes only types from {{to}}, with `import type`: {{why}} (eslint/boundaries.js)',
      unmapped: '{{module}} is in no area of the import table in eslint/boundaries.js.',
    },
  },
  create(context) {
    const from = areaOf(modulePath(context.filename));
    if (!from) return { Program: (node) => context.report({ node, messageId: 'unmapped', data: { module: modulePath(context.filename) } }) };
    const { imports = [], types = [], tests = [], why } = AREAS[from];
    const isTest = /\.test\.[jt]sx?$/.test(context.filename);
    // Only `import type` and `export type` are types: under verbatimModuleSyntax, `import { type X }` still loads the module.
    const check = ({ source }, typeOnly) => {
      if (typeof source?.value !== 'string' || !/^\.\.?(\/|$)/.test(source.value)) return;
      const target = modulePath(path.resolve(path.dirname(context.filename), source.value.replace(/\?.*$/, '')));
      const to = areaOf(target);
      if (!to) return context.report({ node: source, messageId: 'unmapped', data: { module: target } });
      if (to === from || imports.includes(to) || (typeOnly && types.includes(to)) || (isTest && tests.includes(to))) return;
      context.report({ node: source, messageId: types.includes(to) ? 'typesOnly' : 'forbidden', data: { from, to, why } });
    };
    return {
      ImportDeclaration: (node) => check(node, node.importKind === 'type'),
      ExportNamedDeclaration: (node) => check(node, node.exportKind === 'type'),
      ExportAllDeclaration: (node) => check(node, node.exportKind === 'type'),
      ImportExpression: (node) => check(node, false),
      TSImportType: (node) => check(node, true),
    };
  },
};
