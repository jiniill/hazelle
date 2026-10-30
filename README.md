# Hazelle

A character chat app, written from scratch as an alternative to [RisuAI](https://github.com/kwaroran/RisuAI). It reads RisuAI's file formats and runs its bots, but shares none of its code.

What sets it apart:

- Data is stored per chat and per character instead of in one save file, so opening a chat loads only that chat.
- Everything is encrypted in the browser before upload. The server stores ciphertext and cannot read chats or API keys.
- One server, one Docker image. Run it on your own machine (Docker, a Windows folder, or Termux on Android), or use the hosted instance at [hazelle.app](https://hazelle.app).
- Replies keep streaming on the server after the tab closes; reopening the chat resumes them.

The project is in alpha. The UI is in Korean.

## Features

Chat
- Send, regenerate, continue and branch. Each reply version keeps its own continuation, so going back to an earlier version restores the conversation that followed it.
- A per-reply panel with the request that was sent, the lorebook entries that fired, token counts, cache hits and cost; a cache panel that predicts whether the next request will hit the prompt cache.
- Per-chat notes and switches, switching persona, prompt or model mid-chat, per-device reading settings, search inside a chat, bookmarks, and up to five extra characters in one chat.
- Translation, shared across chats unless a character keeps its own settings: replies shown in one language and the user's messages sent in another, while the model always reads the original. Each message switches between original and translation, and both can be edited.
- Long-term memory: summaries of older messages kept within a token budget, with past records found again by embeddings.
- Illustrations: pictures for a reply, drawn through NovelAI.
- Bot HTML and CSS, status panels, and bot scripts (Lua and block triggers) run in a sandboxed worker.
- Export a chat as an HTML log for posting elsewhere, or as a chat file that imports back.

Characters
- Drop a file anywhere to import it. A summary lists what came in and what was left out.
- Folders, a gallery view, a character editor, a trash for deleted characters, and export as a CCv3 charx.
- Share links: a character published as a link that anyone can open and import into their own account, with reporting and a hold on reported links.

Prompts, modules and tools
- A block-based prompt editor. RisuAI presets (`.risup`) import as prompts.
- Modules switched on always, per prompt, per character or per persona.
- Plugins: JavaScript files that run in an isolated frame, reach the network only through the relay and with the user's consent, and can take over long-term memory, add message actions and badges, and give the chat model tools to call. The [plugin guide](src/tool-api/README.md) holds the syntax, for writing one in the app's studio or with Claude Code or Codex.
- Personas, per-model setting profiles, prompt caching settings, and auxiliary model slots for translation, memory and other tasks.
- Agents (experimental): pre agents write notes the reply is written with, post agents rewrite the reply or add to it. Each agent call shows the request it sent and the answer it got.

Connections
- OpenRouter, Vercel AI Gateway, OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Moonshot, Upstage, Groq, Together, Cerebras, DeepInfra, Perplexity, NanoGPT, Chutes, Featherless, Friendli, Surplus, Ollama, and GitHub Copilot through GitHub sign-in. NovelAI for pictures and Voyage for embeddings.
- Any OpenAI-compatible or Anthropic-compatible endpoint, including local model servers on a self-hosted machine.
- Remaining balance and limits per connection, cost per reply, and a usage report by day, model, character and chat. Values a provider doesn't report are shown as unknown.
- A discount switch that sends replies through Anthropic Message Batches, OpenAI flex processing or Gemini batch mode.

Moving from RisuAI
- Drop a RisuAI full backup together with its partial backup. Characters, chats, lorebooks, regex scripts, modules, presets and pictures come over; a summary lists what did not.

Backup
- A full backup exports the whole account as one zip, which can be restored into a new, empty account.
- The server snapshots every account daily. An account can rewind itself from its settings to any point kept in the last week, up to three times a day.

Out of scope: group chat (several bots taking turns), TTS, card v1.

## Security model

One password both signs in and unlocks the vault. The browser derives two independent values from it: a login proof, which is all the server receives, and the key that decrypts the data, which never leaves the browser. Prompt assembly, CBS, lorebooks, regex and bot scripts run in the browser for the same reason.

A recovery key is downloaded at signup. It is the only way back in if the password is lost. If both are lost, nobody can recover the data, including the operator. A full backup is a separate safety net.

Model requests go through a relay on the server, which forwards the request and streams the response back without storing or logging bodies or keys. The streamed reply is sealed for the device that started it, so a reply kept on the server while the tab is closed is as unreadable to the server as stored data.

What the server can still see:
- Metadata: the kinds, counts, sizes and timestamps of stored items.
- Prompts in transit through the relay. Not logging them is a rule in the code, not a cryptographic guarantee.
- Which accounts hold the same picture. Pictures are encrypted with a key derived from their content, so the same picture has the same id in every account. Their contents stay private.

## RisuAI compatibility

Supported: character cards v2/v3 (PNG, charx, JSON), `.risum` modules (including the one inside a charx), lorebooks, regex scripts, CBS, `.risup` presets, bot HTML/CSS, Lua and block triggers.

RisuAI v3 plugins run through an adapter; older plugin files are refused.

Not imported: RisuAI's long-term memory data, and encrypted cards and backups. The import summary shows what was skipped.

RisuAI's bugs and quirks are deliberately not reproduced, even where existing bots rely on them.

## Self-hosting

Hazelle runs as one container with its data in one Docker volume. You need Docker with Compose v2.24 or newer. Without Docker, see [Without Docker](#without-docker). [README.ko.md](README.ko.md) walks through every way in Korean.

### Start

Nothing is built. Download `docker-compose.yml` from the newest [release](https://github.com/jiniill/hazelle/releases) into an empty folder and start it there:

```sh
curl -fLO https://github.com/jiniill/hazelle/releases/latest/download/docker-compose.yml
docker compose up -d
```

Open http://localhost:8080. The app listens on 127.0.0.1 only. The image is `ghcr.io/jiniill/hazelle` (amd64 and arm64); `latest` is the newest release. The source is in this repository, and every instance serves its own at `/source.tar.gz`.

`install-docker.sh` (macOS, Linux) and `install-docker.ps1` (Windows) in each release do the same in `~/hazelle-docker`, wait for the app and open it; run again, they update.

A fresh installation admits one account, which makes it one person's: the first visit sets a password, the account it makes is the operator, and every later sign-in asks for that password alone, with no username and no guest. To let others in, raise the signup limit on the admin screen; the guest home, signup and usernames come back. The operator account cannot be deleted while it is the only operator.

### Your own installation

`HAZELLE_SELF_HOST: 1` in `docker-compose.yml`, which the start without Docker sets too, marks the installation as someone's own rather than hazelle.app. Its relay has no daily limits (`HAZELLE_RELAY_DAILY_BYTES` and `HAZELLE_RELAY_DAILY_HOSTS` set some). 헤이젤 나우 and 게시판 open on hazelle.app, where release news and questions live. There are no share links: characters travel as files. The legal page lists what leaves the installation instead of hazelle.app's terms, and the admin screen keeps signups, storage caps, accounts and its log. An installation that admits one account has no storage caps. The server asks GitHub for the newest release every hour, and 앱 정보 says when there is a newer one. New connections list the model servers of the machine that answer at the allowed addresses, each connected in one tap.

### Without Docker

Each release also carries the image's app outside the image, run by Node instead of a container. It listens on 127.0.0.1:8080 (`PORT` changes the port), keeps its data in a `data` folder beside the app, and allows Ollama, LM Studio and koboldcpp at `localhost` (11434, 1234, 5001); a `HAZELLE_LOCAL_PROVIDERS` set before the start replaces that list.

- **Windows:** unzip `hazelle-windows-x64.zip`, which bundles Node, and run `start-hazelle.bat`. Each start checks for a newer release and, when there is one, shows both versions and asks; a yes replaces `node` and `app` before starting, and `data` and the batch file stay.
- **Termux, Linux, macOS:** `curl -fsSL https://github.com/jiniill/hazelle/releases/latest/download/install.sh | sh` installs into `~/hazelle` with Node 24 or newer (Termux installs it) and starts it; `sh ~/hazelle/start` starts it later. Run the installer again to update, with Hazelle stopped.

The daily snapshots and generations below are taken here too, inside `data`, from 00:00 UTC, so a machine that is on for part of the day takes one at its first start of each UTC day (`HAZELLE_SNAPSHOT_HOUR` moves it). To keep copies elsewhere, enter a folder on another disk or a synced folder as 백업 폴더 on the admin screen: each generation is copied there, in the layout the rclone copier gives a remote, and the folder keeps the same set. Restore one into an empty `data` with Hazelle stopped: `node app/dist/server/restore-cli.js <folder>/<generation> data` (Windows: `node\node.exe app\dist\server\restore-cli.js`), run from the folder holding `app`.

### Phones and other devices

Login and the encrypted vault need a secure context: the page must be served over HTTPS, or from `http://localhost` on the same machine. Opening `http://192.168.x.x:8080` from a phone can never work, whatever the settings. To reach Hazelle from another device, put HTTPS in front of port 8080, for example a Cloudflare tunnel with your own domain, or Tailscale Serve on your tailnet.

### Local models

The compose file allows three local model servers on the host machine: Ollama (11434), LM Studio (1234) and koboldcpp (5001). In Hazelle, enter the endpoint as `http://host.docker.internal:11434/v1` (or `:1234`, `:5001`), not `localhost`: inside the container, `localhost` is the container. The model server must listen beyond loopback: Ollama binds 127.0.0.1 unless started with `OLLAMA_HOST=0.0.0.0`; LM Studio has a "serve on local network" switch. Only the listed host:port pairs may be reached over plain http or at a private address; to add another, edit `HAZELLE_LOCAL_PROVIDERS` in `docker-compose.yml` (comma-separated `host:port`; a malformed entry stops the app from starting).

### Backups

Every day after 03:00 UTC (00:00 on your own installation) the app takes a snapshot of each account and writes a backup generation under `backup/` in its volume. Generations are kept for 7 days: the two newest and the newest of each day. To keep copies elsewhere, run the `backup` profile, which copies every complete generation to any rclone remote (S3, Backblaze, Google Drive, a second disk) with `rclone copy` (never `sync`), keeps the same set there, and marks each generation `copied` so the app knows it is safe:

1. Put the copier's script beside the compose file: `mkdir -p deploy && curl -fL -o deploy/rclone-backup.sh https://github.com/jiniill/hazelle/releases/latest/download/rclone-backup.sh`.
2. Create the remote's settings beside the compose file: `mkdir -p rclone && rclone config --config ./rclone/rclone.conf` (the copier reads `/config/rclone/rclone.conf`). The copier runs as uid 1000: `chown -R 1000 rclone && chmod 700 rclone && chmod 600 rclone/rclone.conf`. Remotes that refresh OAuth tokens (Google Drive, Dropbox) rewrite the file, which needs the directory to be writable by that uid as well.
3. Put the remote and path in `.env` beside the compose file, e.g. `HAZELLE_BACKUP_REMOTE=mydrive:hazelle-backup`.
4. `docker compose --profile backup up -d`

The copier checks every hour. `docker compose --profile backup exec backup /bin/sh /hazelle/rclone-backup.sh once` runs one pass now.

### Alerts

`/api/health` reports `backupAgeHours` (since the newest generation that was copied off-site) and `diskFreePercent`. The admin screen shows a banner when no copied generation is newer than 36 hours (on your own installation, only once something copies them: the backup profile or a backup folder), or the disk is less than 20 % free. Set `HAZELLE_ALERT_WEBHOOK` in `.env` to a Discord- or Slack-compatible webhook URL to get the same warnings, plus a failed daily backup job and a server falling behind (its event loop delayed over 0.25 s in three 10-second windows within an hour), at most once a day each.

### Restore

A restore fills a new, empty volume and leaves the current one alone; you switch to the new one only after it worked. Copy the generation folder and the `files/` folder beside it from your remote into one directory (e.g. `/path/to/backup/<generation>` and `/path/to/backup/files`), then:

```sh
docker compose --profile backup down
HAZELLE_VOLUME=hazelle_restored docker compose run --rm --no-deps -v /path/to/backup:/restore:ro --entrypoint /app/scripts/restore.sh app /restore/<generation> /data
```

The restore checks every file's hash and refuses an incomplete generation; if it fails, nothing was changed and `docker compose up -d` starts the old data again (remove the half-filled volume with `docker volume rm hazelle_restored` before another try). When it succeeds, add `HAZELLE_VOLUME=hazelle_restored` to `.env` beside the compose file and start:

```sh
docker compose up -d
```

Sign in and look. The old volume (`hazelle_data` unless you renamed it) stays on disk until you remove it yourself. Devices that were signed in are told to download their data again.

To undo changes to a single account, its owner can rewind it from the account settings instead.

### Update

```sh
docker compose pull
docker compose up -d
```

To hear of new versions, watch the repository on GitHub with "Custom › Releases"; each release lists its changes.

`pull` only downloads; `up -d` replaces the container. A stop lets requests and replies in flight finish for up to 60 seconds. An image never opens data written by a newer version; to go back, restore a generation taken before the update.

### Pictures in R2

Pictures are stored in the volume by default. To keep them in a Cloudflare R2 bucket instead, put the values in `.env` beside the compose file, which passes them to the app:

```sh
# .env
HAZELLE_FILES_BUCKET=r2
HAZELLE_FILES_R2_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
HAZELLE_FILES_R2_BUCKET=<bucket>
HAZELLE_FILES_R2_ACCESS_KEY_ID=<key id>
HAZELLE_FILES_R2_SECRET_ACCESS_KEY=<secret>
```

The app keeps a cache of what it reads in the volume, up to `HAZELLE_FILES_CACHE_BYTES` (20 GiB by default, `0` for none). A missing or malformed value stops the app from starting. Switching does not move the pictures already stored; [`infra/README.md`](infra/README.md) "Pictures in R2" describes how the hosted machine moved them with `scripts/move-pictures-to-r2.sh`. Backup generations taken with R2 restore only with the same settings.

### Other settings

Also under the app's `environment`: `HAZELLE_SNAPSHOT_HOUR` (the UTC hour of the daily snapshot, default 3) and `HAZELLE_DRAIN_SECONDS` (how long a stop waits for work in flight, default 60; keep `stop_grace_period` above it).

Behind a reverse proxy of your own, set `HAZELLE_TRUSTED_PROXIES` in `.env` to the address the app sees it connect from, or a CIDR range (comma-separated; in Docker, the network's gateway for a proxy on the host). The visitor that proxy names in `X-Forwarded-For` is then what the login, signup and share-link limits count. Left empty, the connection's peer is the visitor, and every visitor through one proxy shares one limit. A malformed entry stops the app from starting.

## Development

Requires Node 24.

```sh
npm install
npm run dev   # the server (data in .data/) and Vite together; Ctrl-C stops both
```

Local development needs no secrets.

| Command | What it runs |
|---|---|
| `npm run check` | Type checks, ESLint, stylelint and Vitest |
| `npm test` | Vitest only |
| `npm run e2e` | A build, then Playwright against the built server on a fresh data directory |
| `npm run build` | The client, server and worker bundles, and the source archive |

Styling rules are in [`src/app/ui/README.md`](src/app/ui/README.md): design values live only in `tokens.css`, and only `src/app/ui` styles elements. `eslint/boundaries.js` lists which layer may import which. The server's storage layout is in [`src/server/db/README.md`](src/server/db/README.md).

For slow loads, the `Server-Timing` header carries `static` (the file handler) and `api_wait` (the wait for the API's response headers), and the server logs `event loop delayed` when a 10-second sample holds a delay over 250 ms.

### Releases and the hosted instance

A `v*` tag runs the checks and, beside them, builds the image for amd64 and arm64 and pushes it to GHCR; once both pass, the GitHub release carries the source archive and the image digest. The hosted instance is one machine described in [`infra/`](infra/README.md) and updated with `scripts/deploy.sh <tag>`; `scripts/release.sh <tag>` tags, waits for the build and deploys in one command.

Design and technical documents are kept in a separate repository until launch.

## License

[AGPL-3.0-only](LICENSE)

No RisuAI code (GPL-3.0) is used. Compatibility is implemented from a behavioral specification written by observing RisuAI. The project is AGPL because reading `.risum` files and RisuAI-exported charx files requires RPack, which is licensed AGPL-3.0 to everyone except RisuAI itself. A running instance serves its own source at `/source.tar.gz`, linked from the legal notice.

The names 헤이젤 and Hazelle, the icons in `public/` and the `hazelle.app` domain identify this project and its hosted instance. They are not covered by the license: a fork or another instance built from this code chooses its own name and icons.

The project does not take code contributions at this time. Code defects and security issues are welcome as issues here; feedback on using the hosted app goes to its 게시판 inside the app.
