---
name: tracks
description: The rules for work done in a git worktree of Hazelle (워크트리) - readying one, what runs inside it, merging its branch and removing it. Use whenever work happens in a worktree.
---

# Worktrees

The base branch is the one the main checkout is on, `master`.

1. Ready it. First command inside a fresh worktree: `scripts/worktree.sh`. A worktree is often cut from an old master; the script resets it to the base branch (or the branch given as its argument), refusing if the worktree already has commits or changes of its own, and links `node_modules`, so no install runs. Then `/usr/bin/git log --oneline -1` must show the base branch's head.
2. Run git as `/usr/bin/git`. The rtk hook rewrites a plain `git` to `rtk git`, and the worktree guard refuses that.
3. `CLAUDE.md` and `docs/` are not files in a worktree. When one must be read, read it from the main checkout by absolute path.
4. Worktrees that run at once each own a set of files and do not edit the others'. A shared piece, such as a new type or a common helper, goes in on the base branch before they start.
5. Validate inside it with the steps of `npm run check` with four test workers, and one focused test per changed behavior. No browser runs inside a worktree.
6. Commit on its branch with the repo's commit format. Do not push from a worktree.
7. Merge each branch into the base branch (`git merge --no-ff <branch>`) and fix conflicts.
8. Then run `npm run check` once, `npm run e2e` once if stored shapes or the core flow changed, and the shots skill for anything visible. Push, then remove the worktrees.
