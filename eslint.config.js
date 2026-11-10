import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import boundaries from './eslint/boundaries.js';

const CSS_IMPORT = { regex: '\\.css$', message: 'Only src/app/ui imports CSS (src/app/ui/README.md).' };
const ACT_ICONS = {
  name: 'lucide-react',
  importNames: ['Plus', 'Import', 'Download', 'Upload', 'FileUp', 'FileDown', 'Trash', 'Trash2', 'Copy', 'CopyPlus', 'Pencil', 'RefreshCw', 'RotateCcw', 'RotateCw', 'MoreHorizontal', 'Ellipsis', 'MessageSquarePlus', 'Flag'],
  message: 'An act reads one way on every screen: take its icon from src/app/common/acts.ts (ACTS), a ⋯ from MoreMenu.',
};
const HEX_COLOR = {
  selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}){1,2}$/]',
  message: 'Colors live in src/app/ui/foundation/tokens.css.',
};
// Wordings replaced by src/app/common/words.ts; one concept reads one way on every screen.
const RETIRED = '/복제|전체 기본값|채팅 기본값|본 대화|없어졌어요|고치기|다 했어요|처음대로|AI에게|[와과] 같게|찾기|새로 받기|노트가 없을 때 쓰는 글|노트 기본 글|CBS 태그|기본 페르소나|지우기|지웠어요|지워졌|지울 수|답장|별표|그림|되살리|처음 값|고르기|골라 주세요|갈라지|떠오른|금고|열쇠|닿지 못|프로바이더|‘|불러오기|내려받기|내려받음|사용처 없음|지원하지 않는 백업|이미지 자리|(?<!자주 )쓰는 설정|만들어 둔 설정|설정 묶음/';
const RETIRED_COPY = {
  selector: `:matches(Literal[value=${RETIRED}], TemplateElement[value.raw=${RETIRED}], JSXText[value=${RETIRED}])`,
  message: 'A retired wording: say it the way src/app/common/words.ts does.',
};
// Every stored file a page reads or sends takes a slot of runtime/files/files' transfers, which this keeps from being passed by.
const RAW_TRANSFER = {
  selector: 'CallExpression[callee.property.name=/^(readFile|putFile)$/]',
  message: 'Read and send stored files through runtime/files/files (Files, or transfers.run), which holds the page to one transfer policy.',
};
const STYLE_PROPS = {
  selector: 'JSXAttribute[name.name=/^(className|style)$/]',
  message: 'Only src/app/ui styles elements (src/app/ui/README.md).',
};

export default defineConfig([
  globalIgnores(['dist/', '.wrangler/', '.claude/', '.data/', '**/*.module.d.css.ts', 'shots/', 'docs/', 'selfhost/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**'],
    plugins: { local: { rules: { boundaries } } },
    rules: { 'local/boundaries': 'error' },
  },
  {
    files: ['src/runtime/**'],
    ignores: ['src/runtime/files/files.ts', 'src/runtime/account/guest-transfer.ts', 'src/runtime/**/*.test.ts'],
    rules: { 'no-restricted-syntax': ['error', RAW_TRANSFER] },
  },
  {
    files: ['src/app/**'],
    rules: { 'no-restricted-syntax': ['error', HEX_COLOR, RETIRED_COPY] },
  },
  {
    files: ['src/app/**'],
    ignores: ['src/app/ui/**', 'src/app/main.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: [CSS_IMPORT], paths: [ACT_ICONS] }], 'no-restricted-syntax': ['error', HEX_COLOR, STYLE_PROPS, RETIRED_COPY] },
  },
  {
    files: ['src/app/common/acts.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [CSS_IMPORT] }] },
  },
]);
