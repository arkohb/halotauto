# Git history cleanup plan (decision D3)

**Status: prepared and dry-run tested on a throwaway clone — NOT executed on your repository.** Nothing below runs until you explicitly authorise it.
Rewriting history removes copies of the secrets from this repository. It does **not** make a leaked secret safe — every exposed credential must be revoked or rotated regardless (step 0).

## 1. What is affected (checked 2 November 2026)

| Item | Finding |
|---|---|
| Branches | `main`, `feature/halo-edge-firebase-cloudflare`, `feature/scanner-bot-holographic-art` |
| Remotes | **none** — the repository has never been pushed |
| Tags / stashes | none |
| Commits (all branches) | 85 — every one will get a new ID |
| iCloud Desktop & Documents sync | off (no automatic cloud copy of this folder) |
| Working tree | not clean: 167 uncommitted deletions under `skills/` (pre-existing, not from this work) — must be committed or restored first |

### Sensitive material in history

| Path / content | Commits | What it exposes |
|---|---|---|
| `.env` | 10 | `METAAPI_TOKEN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DATABASE_URL` |
| `db/custom.db` | 68 | user accounts (scrypt password hashes), session hashes, licences, **broker credentials in plain JSON** (OANDA/MetaApi), TradingView webhook secret, Telegram bot token, SMTP settings, trade book |
| `src/lib/brokers/metaapi-core.ts` | 2 | hard-coded MetaApi token (`BAKED_METAAPI_TOKEN`) |
| `tool-results/` (96 files tracked) | — | saved tool output from earlier sessions; at least one file contains a full copy of the old `metaapi-core.ts` **including the token** |
| `skills/design/design-templates/*` | — | JWT-shaped and `AKIA…`-shaped strings inside HTML templates; no evidence they are real keys (template samples). Removed by the JWT pattern anyway |

Pattern scan of all history found **no** Paystack/Flutterwave live or test keys, no Anthropic keys, no private keys, no Telegram bot tokens in plain text form. `HALO_LICENSE_SECRET` only appears as a placeholder in docs.

## 2. Step 0 — revoke and rotate (do this first, independent of the rewrite)

1. **MetaApi:** app.metaapi.cloud → API access → revoke the old token; create a new one; put it in `.env` as `METAAPI_TOKEN` (and later in Firebase Secret Manager).
2. **Super Admin password:** change it (it was in `.env` history): `bun scripts/admin-credentials.ts` (or `npx tsx scripts/admin-credentials.ts`) prints a new one once.
3. **TradingView webhook secret:** Settings → EA attach → regenerate; re-copy the Pine EA.
4. **Broker credentials stored in the database:** change the OANDA API token and any MT passwords that were connected; reconnect them in Brokers & MT5.
5. **Telegram bot token / SMTP password** (if real ones were ever saved): rotate at the provider.
6. **Sessions:** sign everyone out (delete rows from `Session`) after the rewrite.

## 3. Execution steps (after your authorisation)

```bash
# 3.1 install the standard tool (done on 2 Nov 2026 — installed at ~/Library/Python/3.9/bin/git-filter-repo)
pip3 install --user git-filter-repo
```

```bash
# 3.2 make the working tree clean (choose ONE)
git add -A skills && git commit -m "Remove bundled skills folder"   # keep the deletion
# or: git restore skills                                            # undo the deletion
```

```bash
# 3.3 recoverable backup of EVERYTHING (contains the secrets — keep it offline, delete after the retention period)
git bundle create ~/HALO-pre-rewrite-$(date +%Y%m%d).bundle --all
git bundle verify ~/HALO-pre-rewrite-$(date +%Y%m%d).bundle
cp -R "/Users/ant/Documents/Halo-Edge Autotrader/.git" ~/HALO-pre-rewrite-git-$(date +%Y%m%d)
```

```bash
# 3.4 replacement rules: every JWT-shaped token in any historical file becomes a marker
printf 'regex:eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}==>***REMOVED-JWT***\n' > ~/halo-replacements.txt
```

```bash
# 3.5 rewrite all branches: drop the sensitive files entirely and scrub the token text everywhere else
python3 ~/Library/Python/3.9/bin/git-filter-repo --force \
  --invert-paths --path .env --path db/custom.db --path tool-results/ \
  --replace-text ~/halo-replacements.txt
```

```bash
# 3.6 make sure no old objects survive locally
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

`tool-results/` will also be added to `.gitignore` so it is never tracked again (it is session output, not application code).

## 4. Verification (all must pass)

```bash
git log --all --format=%h -G 'eyJ[A-Za-z0-9_-]{40,}' | wc -l          # expect 0
git log --all --format=%h -- .env db/custom.db tool-results | wc -l    # expect 0
git rev-list --all --objects | grep -E '(^| )(\.env|db/custom\.db)$'   # expect nothing
git cat-file -e <old blob id of .env> && echo STILL PRESENT            # expect error (object gone)
```

Plus: the app still builds and the regression tests still pass on the rewritten branch.

## 5. Impact

- **Commit IDs:** all 85 change on all three branches. Anything that refers to an old ID (notes, the audit report's commit references, bookmarks) will point at nothing.
- **Force-push:** not needed today — there is no remote. The first push to GitHub after the rewrite is an ordinary push of clean history. **Never push the pre-rewrite history**; if a remote is added before the rewrite, the rewrite must be followed by `git push --force-with-lease --all` and every collaborator must re-clone.
- **Collaborators:** none known (no remote). Any other copy of this folder — a zip, a USB copy, a backup drive, another machine — still contains the secrets and must be deleted or treated as compromised.
- **Deployments:** none exist yet (Firebase is not connected). Connect Firebase App Hosting to GitHub only after the rewrite.
- **Local files:** `.env` and `db/custom.db` on disk are **not** touched by the rewrite; they are already ignored.
- **The bundle/backup** still holds the secrets: store it offline and delete it once you're satisfied (suggested: 30 days).

## 6. Recovery (if anything goes wrong)

```bash
# restore the complete pre-rewrite repository from the bundle
git clone ~/HALO-pre-rewrite-YYYYMMDD.bundle "/Users/ant/Documents/Halo-Edge Autotrader-restored"
cd "/Users/ant/Documents/Halo-Edge Autotrader-restored"
git branch -a        # all three branches are back with their original IDs
```

Or replace the `.git` folder with the `~/HALO-pre-rewrite-git-YYYYMMDD` copy.

## 7. The `skills/` deletions (to decide before execution)

| Fact | Evidence |
|---|---|
| What it is | 167 files of AI-assistant "skills" from the platform the project was first built on (pdf 38, docx 35, xlsx 21, skill-creator 18, pptx 14, charts 12, image/TTS/ASR/VLM helpers) |
| When added | commit `dbf988d`, 31 Oct 2026 |
| Used by the app? | **No** — nothing in `src/`, `scripts/`, `package.json`, `next.config.ts`, `tsconfig.json` or `.zscripts/` references it |
| Current state | the **whole folder** is gone from disk (167 of 167 files) — consistent with a deliberate removal |
| Effect of keeping the deletion | none on the app; also removes one TypeScript error that lives inside `skills/image-edit` |

**Recommendation:** commit the deletion (step 3.2, first option). Only you can confirm it was intentional.

## 8. Dry-run results (2 Nov 2026, throwaway clone — your repository untouched)

| Check | Before | After |
|---|---|---|
| Branches | 3 | 3 (same names) |
| Commits (all branches) | 87 | 83 (commits that only touched removed files become empty and are dropped) |
| Commits touching `.env`, `db/custom.db`, `tool-results/` | 71 | **0** |
| Complete JWTs in any stored object | present | **0** |
| Looser `eyJ…` pattern matches | 6 commits | 2 commits — random base64 inside images embedded in `skills/` templates (decoded: binary noise, not tokens) |
| Current source tree vs original | — | identical except the 96 `tool-results/` files |
| Type-check `src/` | — | 0 errors (the only error is inside `skills/`, removed by step 3.2) |
| `next build` | — | ✅ compiles |
| Engine / EDGE / journal tests | — | ✅ all pass |

The clone was deleted after the test.

## 9. Final execution checklist (for your approval)

1. You have revoked the old MetaApi token and changed the Super Admin password (step 0).
2. You confirm the `skills/` deletion is intentional → commit it (3.2).
3. Backup bundle + `.git` copy created and verified (3.3).
4. Rewrite (3.4–3.6) on all three branches.
5. Verification commands (§4) all pass; build + tests pass on the rewritten branch.
6. `tool-results/` added to `.gitignore`.
7. Backups kept offline; deleted after your retention period.

## 10. Pre-execution verification (Phase 4, 2 Nov 2026)

| Check | Result |
|---|---|
| `skills/` deletion | confirmed unused (only historical notes mention it) → committed separately as `64f614f`; step 3.2 is done |
| Working tree | only the uncommitted Phase 4 work remains; it will be committed before execution so the tree is clean |
| Branches and heads | `main` 860622a · `feature/scanner-bot-holographic-art` e330af6 · `feature/halo-edge-firebase-cloudflare` 64f614f (moves forward with Phase 4 commits) — 90 commits in total |
| Remotes / tags / stashes | none / none / none |
| Secrets to remove | MetaApi token (in `.env`, `src/lib/brokers/metaapi-core.ts`, `tool-results/`), Super Admin email + password (`.env`), everything in `db/custom.db` history (password hashes, sessions, broker credentials, webhook secret, alert settings) |
| Backup procedure | **rehearsed**: `git bundle create --all` → `git bundle verify` OK (176 MB) → clone from the bundle reproduced all 3 branch heads exactly and all 90 commits; the scratch restore was deleted |
| Backup location | `~/HALO-backups/` (owner-only permissions, outside the project). The rehearsal bundle stays there; a **fresh** bundle is created immediately before execution |
| Dry run | §8 — secrets removed, app builds, tests pass |

**Waiting for:** your explicit authorisation of §9, after the old MetaApi token is revoked and the admin password changed.

## 11. Final execution checklist (prepared in Phase 5 — not executed)

Run only after you say "authorise the history rewrite". Old credentials are not reproduced here.

| # | Step | Check |
|---|---|---|
| 1 | You revoked the old MetaApi token and changed the Super Admin password | confirmed by you |
| 2 | All Phase 5 work committed; `git status` shows nothing | clean tree |
| 3 | `git bundle create ~/HALO-backups/HALO-pre-rewrite-<date>.bundle --all` → `git bundle verify` | "is okay" |
| 4 | `cp -R .git ~/HALO-backups/HALO-pre-rewrite-git-<date>` | copy exists |
| 5 | `python3 ~/Library/Python/3.9/bin/git-filter-repo --force --invert-paths --path .env --path db/custom.db --path tool-results/ --replace-text ~/halo-replacements.txt` (JWT regex rule, §3.4) | completes |
| 6 | `git reflog expire --expire=now --all && git gc --prune=now --aggressive` | done |
| 7 | Verify: no JWT in any object; no commit touches `.env`, `db/custom.db`, `tool-results/`; same 3 branches | all zero / 3 |
| 8 | `npm install && npx tsc --noEmit && next build` + engine, EDGE, journal, price-guard, secret-box tests | all pass |
| 9 | Add `tool-results/` to `.gitignore`, commit | done |
| 10 | Keep the bundle offline for your retention period, then delete it | your decision |

Recovery at any point: `git clone ~/HALO-backups/HALO-pre-rewrite-<date>.bundle <new folder>` (rehearsed: all branches and commits restored exactly).
