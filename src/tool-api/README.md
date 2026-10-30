# Writing a Hazelle plugin

A Hazelle plugin is one JavaScript file that the Hazelle chat app runs. It is not a RisuAI plugin, and RisuAI's API does not exist here.

This file holds the header syntax and the rules. [`hazelle.d.ts`](hazelle.d.ts) holds the API, with its rules as comments. Use only what it declares. The app's plugin studio gives its own AI these same two files.

API version 1 may still change in place until plugins can be published. These files follow `master`, which can be ahead of hazelle.app.

## With Claude Code or Codex

Open an empty folder and paste this, with what you want in place of the brackets:

```text
헤이젤 플러그인을 만들어 줘: [만들 것]
아래 두 파일을 요약하는 웹 도구로 읽지 말고 이 폴더에 그대로 받아서 읽어 줘.
https://raw.githubusercontent.com/jiniill/hazelle/master/src/tool-api/README.md
https://raw.githubusercontent.com/jiniill/hazelle/master/src/tool-api/hazelle.d.ts
```

## The header

The file starts with its header: `//@` lines, one per line, before any code. Blank lines between them are fine. The first other line ends the header, so a comment goes after it. Any other `//@` key makes the file unreadable.

Identity lines:
- `//@api 1`: required, as written.
- `//@name <name>` and `//@author <author>`: required. Letters, numbers, `_`, `.` or `-`. Together they are the plugin's identity: importing a file with the same pair updates that plugin.
- `//@version <version>`, `//@display-name <name>`, `//@description <one sentence>`: optional.

Code lines:
- `//@uses model | embed | memory | network`: one line for each ability the code calls. model: `chat.model` or `chat.send`. embed: `chat.embed`. memory: a prompt answer with memory. network: `chat.fetch`.
- `//@setting {"key":"…","label":"…","type":"text"|"number"|"switch"|"choice","options":["…"],"default":…,"composer":true}`: one field on the plugin's page, as JSON on one line. options only for choice. default must fit the type. composer: true also shows the field from the chat input's button, which needs `//@composer`.
- `//@composer <label>`: that button beside the chat input, at most 8 characters.
- `//@input <id> <label>`: an item of that button, at most 3 of them, labels at most 16 characters, which needs `//@composer`. Pressing it sends the `input` event with the id and the text typed, and a text answered replaces the input's text. A button with one item and no composer field or page runs it on a press, with no menu. Use it to rewrite, translate or draft what the user is about to send.
- `//@menu <id> <label>`: an item in the chat's ⋯ menu. Pressing it sends the `menu` event with the id.
- `//@action <id> <label>`: an item in each message's ⋯, at most 3 of them, labels at most 16 characters. Pressing it sends the `action` event with the id.
- `//@tool {"name":"…","description":"…","parameters":{…}}`: a tool the chat model may call while it writes a reply, as JSON on one line. name: letters, numbers, `_` or `-`, starting with a letter, at most 40 characters. description: when the model should call it, in English. parameters: a JSON Schema object, left out when it takes none. A call sends the `tool` event with the name and the arguments, and the text answered goes back to the model. Use it for what the model should look up or roll itself: dice, an inventory, a stat.
- `//@page <label>`: the plugin's own page.

Ids use letters, numbers, `_`, `.` or `-`, and are unique within their kind. Every label the user reads is Korean.

Every kind of line together:

```js
//@api 1
//@name lookup
//@author me
//@version 1.0.0
//@display-name 찾아보기
//@description 대화 중에 자료를 찾아 줘요
//@uses model
//@uses network
//@setting {"key":"tone","label":"말투","type":"choice","options":["짧게","자세히"],"default":"짧게","composer":true}
//@composer 찾아보기
//@input draft 초안 쓰기
//@menu digest 지금까지 요약
//@action cite 출처 달기
//@tool {"name":"search","description":"Searches the user's notes for a phrase.","parameters":{"type":"object","properties":{"phrase":{"type":"string"}},"required":["phrase"]}}
//@page 자료 열기
```

## The code

The file runs in a sandboxed iframe with no access to the app's page. Register handlers with `hazelle.on` at the top level. The browser's `fetch` and `XMLHttpRequest` are blocked; use `chat.fetch` with `//@uses network`.

- `hazelle.context` is `'background'` in a worker with no `document`. With `//@page`, the same file also runs on the plugin's page, with `hazelle.context === 'page'` and the page's own document. The two sides talk through `hazelle.post` and the `message` event. A page cannot load outside scripts; outside pictures, fonts and stylesheets load only once the user has allowed the network.
- Each `//@uses` line is asked of the user: model and embed once, memory and network each on their own. A call without its line answers `not-declared`, and one the user refused answers `not-allowed`. An update that adds a use asks for it again.
- Tool data writes are limited to 30 a minute per plugin; past that a write throws `too-many-writes`. The other limits and each event's deadline are in `hazelle.d.ts`.

Example:

```js
//@api 1
//@name char-count
//@author me
//@version 1.0.0
//@display-name 글자 수
//@setting {"key":"unit","label":"단위","type":"text","default":"자"}

hazelle.on('reply', async (chat, reply) => {
  const [message] = await chat.messages(reply.index, reply.index + 1);
  const { unit } = await hazelle.settings();
  if (message) chat.badge(reply.index, `${message.text.replace(/\s/g, '').length}${unit}`);
});
```

More working files, each run by the app's browser tests: [`memory.js`](../../e2e/fixtures/tools/memory.js) (a model call and a menu item), [`notepad.js`](../../e2e/fixtures/tools/notepad.js) (a page and its background), [`recall.js`](../../e2e/fixtures/tools/recall.js) (embeddings, a message action and the composer button).

## Checking and installing

1. Check the code against the API from the folder holding the file and `hazelle.d.ts`: `npx -p typescript tsc --noEmit --allowJs --checkJs --target es2022 --lib es2022,dom hazelle.d.ts plugin.js`. This proves the calls match the types. Only the import reads the header.
2. Import the file: 설정 → 플러그인 → 플러그인 가져오기, or drop the `.js` file anywhere in the app. A file is at most 8 MB. A refused file says why, and names the line when one line is at fault. Importing the same name and author again replaces the code and keeps the plugin's settings and data.
3. Run it in the app: the plugin's page → ⋯ → 코드 편집 → 테스트 runs a moment of the header, such as a menu item or a `tool` call, on a test chat, and neither the chat nor the plugin's data changes. Model calls are real only with its 모델 호출 switch on; network and embeddings are not called there. 코드 편집 holds up to 512 KB.

코드 편집 opens the plugin's one draft, and an import does not change a draft that already exists. After importing a new file, delete the old draft (초안 삭제) before testing, or the test runs the old code. 적용 on an old draft also replaces the imported code with it.
