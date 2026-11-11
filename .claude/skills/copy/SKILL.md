---
name: copy
description: Have Gemini (agy) review and write Hazelle's Korean UI copy in one batch (문구). Use before every deploy, when the user asks for 문구 or copy review, or when any user-facing text (labels, notices, errors, 새 소식) must be written.
---

# Copy through agy

Every word a user reads (labels, buttons, notices, errors, empty states, ⓘ help, toasts, 새 소식) is Gemini's, not Claude's. While building, Claude writes a plain placeholder that follows `src/app/common/words.ts` and `src/app/ui/README.md`'s Patterns; the final wording comes from this batch, run once before each deploy, never per change.

## Running agy

Read-only, from the repo root, flags before `-p`:

```
agy --mode plan --model gemini-4-carbon-high --settings '{"permissions":{"allow":["command(git)"]}}' -p "<brief>"
```

`--mode plan` keeps it from editing. Print mode cannot ask for a permission, so without the `--settings` allow-rule its first `git diff` or `git log` is denied and it exits with "no output produced"; `command(git)` is the one syntax that works (`command(git *)` and `command(git:*)` do not), and it covers a plain `git …` only: say in the brief to run one git command at a time, since `git log … && echo …` or a pipe is denied too. Tell it to answer in full in the one response: left to itself it may close with "확인하겠습니다" and nothing else. Afterwards `git status` must show nothing new; if it does, discard what agy wrote. Brief it with the goal, the readers and where to look, never with a Claude draft of the wording: it copies a draft.

## The batch

1. **Scope.** The running tag is the newest one deployed (`git tag --sort=-v:refname | head -1`). The changed strings are the added lines with Hangul in `git diff <running tag>..HEAD -U0 -- src`, and every line of a new screen or component. Nothing changed → skip the batch.
2. **Brief.** Ask agy to review those strings in place, reading each in its component so it sees where it stands. Give it:
   - the readers: Korean users of a character-chat app, from first-time guests to people with thousands of chats;
   - the voice: short 해요체, the way Toss writes (`docs/design/2-screens-and-rules.md`, Copy voice; survey in `docs/research/copy-voice-survey-2026-10-06.md`);
   - the fixed terms in `src/app/common/words.ts` and `src/app/common/acts.ts`, and the Patterns in `src/app/ui/README.md` (새 X / X 추가, 가져오기 / 내보내기, 다시 시도, 멈추기; explanations behind ⓘ, no help that restates its label);
   - the answer format: one row per string, `file:line`, current text, proposed text (or `유지`), one-line reason; then any string used twice that should come from `words.ts`.
3. **Apply.** Claude edits the code with agy's wording as given. Claude changes a proposal only where the code contradicts it (a feature that does not exist, a wrong place, an internal word such as 토스트 or 엔드포인트), and never rewords for style. A wording repeated across files goes into `words.ts`, not into each file.
4. **Show the user** the table of changes and each correction Claude made to agy's proposals, then `npm run check`, then commit as `fix: 문구 다듬기` with a numbered body when several screens changed.

The 새 소식 entry in the `deploy` skill is written by agy the same way, after this batch.
