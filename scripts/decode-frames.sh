#!/usr/bin/env bash
# Decodes 자동 진단 bundle frames (file:line:column) to source lines, by building the release tag with hidden source maps
# in a throwaway worktree:
#   scripts/decode-frames.sh v0.6.11 session-DC9f_h6G.js:13:30368 Workspace-BK9cl4Pr.js:2:40590
# The chunk hashes match the release only when this checkout's node_modules matches the tag's lockfile and the build
# gets the tag as VITE_HAZELLE_VERSION, as the Dockerfile passes it.
set -euo pipefail
tag=$1; shift
root=$(git rev-parse --show-toplevel)
git -C "$root" diff --quiet "$tag" HEAD -- package-lock.json || echo "decode-frames: package-lock.json differs from $tag; hashes may not match" >&2
dir=$(mktemp -d)
trap 'rm -f "$dir/tree/node_modules"; git -C "$root" worktree remove --force "$dir/tree"; rm -rf "$dir"' EXIT
git -C "$root" worktree add -q --detach "$dir/tree" "$tag"
ln -s "$root/node_modules" "$dir/tree/node_modules"
(cd "$dir/tree" && npm run -s css-types >/dev/null && VITE_HAZELLE_VERSION=$tag ./node_modules/.bin/vite build --sourcemap hidden --logLevel error >/dev/null)
node --input-type=module - "$dir/tree/dist/client/assets" "$root/node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs" "$@" <<'EOF'
import { existsSync, readFileSync } from 'node:fs';
const [assets, mapping, ...frames] = process.argv.slice(2);
const { TraceMap, originalPositionFor } = await import(mapping);
for (const frame of frames) {
  const [file, line, column] = frame.split(':');
  const map = `${assets}/${file}.map`;
  if (!existsSync(map)) { console.log(`${frame} → no such chunk in this build`); continue; }
  const at = originalPositionFor(new TraceMap(readFileSync(map, 'utf8')), { line: Number(line), column: Number(column) - 1 });
  console.log(`${frame} → ${at.source?.replace(/^(\.\.\/)+/, '')}:${at.line}:${at.column}${at.name ? ` ${at.name}` : ''}`);
}
EOF
