import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import boundaries from './boundaries.js';

RuleTester.describe = describe;
RuleTester.it = it;

const at = (file) => path.join(import.meta.dirname, '..', file);
const ok = (name, file, code) => ({ name, filename: at(file), code });
const fails = (name, file, code, error) => ({ name, filename: at(file), code, errors: [error] });

new RuleTester({ languageOptions: { parser: tseslint.parser } }).run('boundaries', boundaries, {
  valid: [
    ok('the kit imports the change signal without importing runtime', 'src/app/ui/overlays/Menu.tsx', "import { ChangeSignal } from '../../../change-signal';"),
    ok('the server imports wire contracts', 'src/server/files.ts', "import { FILE_ID } from '../contracts/files';"),
    ok('the runtime imports wire contracts', 'src/runtime/api.ts', "import { ACCOUNT_USAGE_HEADERS } from '../contracts/http';"),
    ok('a feature imports wire contracts directly', 'src/app/admin/RestoresDialog.tsx', "import type { RestorePhase } from '../../contracts/admin';"),
    ok('the runtime imports the model', 'src/runtime/chat/turn.ts', "import { fold } from '../../model/chat';"),
    ok('the model takes types from connectors', 'src/model/kinds.ts', "import type { Connection } from '../connectors/types';"),
    ok('the model takes types through import()', 'src/model/chat.ts', "type U = import('../connectors/types').Usage;"),
    ok('the engine takes types from the model', 'src/engine/pipeline.ts', "import type { Card } from '../model/library';"),
    ok('a feature takes the router from the shell at any depth', 'src/app/library/gallery/deep/Grid.tsx', "import { navigate } from '../../../shell/router';"),
    ok('a feature reads the root modules, common and the kit', 'src/app/chat/useChat.ts', "import { useToast } from '../toast';\nimport { Missing } from '../common/Missing';\nimport { Button } from '../ui';"),
    ok('the shell composes features', 'src/app/shell/Page.tsx', "import { ChatScreen } from '../chat/ChatScreen';"),
    ok('main composes the shell', 'src/app/main.tsx', "import { Workspace } from './shell/Workspace';"),
    ok('the kit imports itself at any depth', 'src/app/ui/controls/deep/er/Thing.tsx', "import { Icon } from '../../../foundation/Icon';"),
    ok('a test belongs to the area of its module', 'src/app/shortcuts.test.ts', "import { SHORTCUTS } from './shortcuts';"),
    ok('a runtime test uses the harness', 'src/runtime/chat/talk.test.ts', "import { testSession } from '../testing';"),
    ok('the harness runs the server', 'src/runtime/testing.ts', "import { testApp } from '../server/testing';"),
    ok('packages are not areas', 'src/app/ui/controls/Button.tsx', "import { useState } from 'react';"),
  ],
  invalid: [
    fails('the change signal imports no runtime', 'src/change-signal.ts', "import { api } from './runtime/api';", /^changeSignal may not import runtime:/),
    fails('contracts import no server implementation', 'src/contracts/admin.ts', "import type { Db } from '../server/db/service-db';", /^contracts may not import server:/),
    fails('contracts import no client domain', 'src/contracts/admin.ts', "import type { Chat } from '../model/chat';", /^contracts may not import model:/),
    fails('contracts import no runtime', 'src/contracts/http.ts', "import { api } from '../runtime/api';", /^contracts may not import runtime:/),
    fails('the kit imports no feature', 'src/app/ui/controls/Button.tsx', "import { useChat } from '../../chat/useChat';", /^ui may not import chat:/),
    fails('the kit imports no root module at any depth', 'src/app/ui/controls/deep/er/Thing.tsx', "import { useSession } from '../../../../session';", /^ui may not import root:/),
    fails('the kit imports no layer below the app', 'src/app/ui/story/Prose.tsx', "import type { Chat } from '../../../model/chat';", /^ui may not import model:/),
    fails('a feature imports no other feature', 'src/app/library/HomeScreen.tsx', "import { ChatScreen } from '../chat/ChatScreen';", /^library may not import chat:/),
    fails('a feature nested past the old per-depth blocks imports no other feature', 'src/app/library/gallery/deep/Grid.tsx', "import { ChatScreen } from '../../../chat/ChatScreen';", /^library may not import chat:/),
    fails('a feature takes nothing else from the shell', 'src/app/chat/ChatHeader.tsx', "import { Page } from '../shell/Page';", /^chat may not import shell:/),
    fails('common imports no feature', 'src/app/common/Missing.tsx', "import { HomeScreen } from '../library/HomeScreen';", /^common may not import library:/),
    fails('the root modules compose no feature', 'src/app/toast.tsx', "import { useChat } from './chat/useChat';", /^root may not import chat:/),
    fails('the app reaches the server over HTTP only', 'src/app/shell/Workspace.tsx', "import { app } from '../../server/worker';", /^shell may not import server:/),
    fails('the model imports no runtime', 'src/model/chat.ts', "import { api } from '../runtime/api';", /^model may not import runtime:/),
    fails('the model takes only types from connectors', 'src/model/chat.ts', "import { resolveRole } from '../connectors/assignment';", /^model takes only types from connectors,/),
    fails('an inline type import still loads the module', 'src/model/chat.ts', "import { type Usage } from '../connectors/types';", /^model takes only types from connectors,/),
    fails('the engine takes only types from the model', 'src/engine/pipeline.ts', "import { fold } from '../model/chat';", /^engine takes only types from model,/),
    fails('connectors import no other layer', 'src/connectors/registry.ts', "import type { Card } from '../engine/import/types';", /^connectors may not import engine:/),
    fails('the vault imports no other layer', 'src/vault/keys.ts', "import { ConnectorError } from '../connectors/types';", /^vault may not import connectors:/),
    fails('the server imports no client layer', 'src/server/objects.ts', "import type { Kind } from '../model/kinds';", /^server may not import model:/),
    fails('the runtime imports no UI', 'src/runtime/session.ts', "import { useSession } from '../app/session';", /^runtime may not import root:/),
    fails('the runtime reaches the server over HTTP only', 'src/runtime/api.ts', "import { app } from '../server/worker';", /^runtime may not import server:/),
    fails('only runtime tests use the harness', 'src/runtime/chat/talk.ts', "import { testSession } from '../testing';", /^runtime may not import harness:/),
    fails('a lazy import is an edge', 'src/app/library/HomeScreen.tsx', "const chat = import('../chat/ChatScreen');", /^library may not import chat:/),
    fails('a re-export is an edge', 'src/app/ui/index.ts', "export * from '../chat/useChat';", /^ui may not import chat:/),
    fails('a module in no area', 'src/app/usage/UsageScreen.tsx', "import { Screen } from '../ui';", /^src\/app\/usage\/UsageScreen is in no area/),
    fails('an import of a module in no area', 'src/app/chat/ChatHeader.tsx', "import { x } from '../usage/x';", /^src\/app\/usage\/x is in no area/),
  ],
});
