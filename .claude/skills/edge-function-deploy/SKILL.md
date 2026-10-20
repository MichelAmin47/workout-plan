---
name: edge-function-deploy
description: Use for any change to supabase/functions/ (coach-chat, close-day-cron, morning-checkin, _shared/) that will be deployed, any change to a coach behaviour rule, and any verification run against the live database.
---

# Edge Function deploy & verification

The voeding-app runs on three Supabase Edge Functions. Deploying them has gone
wrong in five distinct ways in this project, every one of them silent: no
crash, no error, just wrong behaviour discovered hours or days later. This
skill is the full procedure. Every step exists because its absence caused a
real incident; the incidents are named so the steps don't read as
bureaucracy.

Source of the rules: `voeding-app-afspraken.md` §3, §4, §5, §12 in the
claude.ai project "Fitness & Voeding". If the user pastes a newer version of
those rules, the newer version wins.

## Fixed facts

- Supabase project ref: `nhcgepdrbrvfukxpbhmi`.
- Functions: `coach-chat`, `close-day-cron`, `morning-checkin`. All three have
  `verify_jwt: true` — keep it that way on every deploy.
- **The only deploy route is the `deploy_edge_function` MCP tool.** There is no
  `supabase/config.toml`, no CI, no authenticated Supabase CLI. The tool's
  `files` parameter takes literal file content, not paths.
- Deployed file naming (this project's own convention, which
  `verify-edge-function-bundles.ts` relies on): a function's own files are
  `source/<basename>`, shared files are `_shared/<basename>`. Entrypoint
  `source/index.ts`. Different names → phantom MISSING/STALE reports.

### Which function bundles which shared file

Derived from the import graph on 13 October 2026; `isoWeek.ts` added 20 October 2026. **The script is the source
of truth, not this table** — re-derive whenever imports change:

```bash
grep -rn "from '\.\./_shared\|from '\./" supabase/functions --include=*.ts | grep -v test
```

| Shared file | coach-chat | close-day-cron | morning-checkin |
|---|---|---|---|
| `_shared/supabaseClient.ts` | ✓ | ✓ | ✓ |
| `_shared/today.ts` | ✓ | ✓ | ✓ |
| `_shared/anthropic.ts` | ✓ | ✓ (via summary.ts) | ✓ |
| `_shared/summary.ts` | ✓ (via tools.ts) | ✓ | — |
| `_shared/isoWeek.ts` | ✓ | ✓ (via today.ts) | ✓ (via today.ts) |

So: a change to any `_shared/` file except `summary.ts` means **all three**
functions are redeployed. `supabase/scripts/print-deploy-payload.ts <slug>` prints a
function's exact bundle from disk (names, sizes, SHA-256; `--json` for the
`files` array). A change to `summary.ts` means coach-chat and
close-day-cron.

### Three separate prompts

The coach's behaviour lives in three prompts that do **not** inherit from each
other:

| Model | Prompt location |
|---|---|
| Conversation | `coach-chat/prompt.ts` (`PERSONA_PROMPT`) |
| Day-close | `_shared/summary.ts` |
| Morning card | `morning-checkin/index.ts` |

## The procedure

Start in plan mode. The plan names: the files that change, every function that
bundles them (from the import graph), and which of the three prompts are
touched.

### 1. Git parity — before anything is deployed

Every file that will be bundled must be committed: `git status --porcelain`
clean for those paths. If not: **STOP and report**. Don't deploy first and
commit later, and don't commit silently as a side effect.

*Why:* on 12 September two fixes were found live in production but missing
from git, one of them for twelve days. The byte-diff compares disk to
production, never disk to git; a later deploy from a clean checkout would have
reverted both while every check reported success.

### 2. Behaviour rules go into every prompt they apply to

A rule like "the coach never mentions X" or "always says Y" goes into each of
the three prompts where that model could produce X. Default assumption: all
three. Leaving one out needs a stated reason.

*Why:* "never mention weight" was added to coach-chat only; the day-close
model put a weigh-in into the next day's aandachtspunt. (§5)

### 3. Compose the payload — patch, don't regenerate

The payload is composed by you, token by token. That is regeneration, not
copying: it is unreliable for any file of real size. Therefore:

- Fetch the **currently deployed** content with `get_edge_function` and patch
  your change into it. Never retype a whole file, and never re-derive it from
  memory on a retry. Error probability must scale with the size of the change,
  not the size of the file.
- Include every bundled file of the function, also the unchanged ones — the
  tool replaces the whole bundle.
- Use the `source/` / `_shared/` naming above.

*Why:* seven corruptions caught so far, all in unrelated text — "on" became
"op" in a comment, "caseiïne" and "díje" in prompt text, an escaped
apostrophe in `tools.ts`, a stubbed `summary.ts` that silently stopped writing
day-closes. (§3, fifth failure mode: rule 1 of the original agreement was
never executable.)

### 4. Deploy → byte-diff → fix → re-diff

After each deploy, fetch the deployed files with `get_edge_function`, write
them to a temp directory and diff every file against disk:

```bash
diff -u supabase/functions/<fn>/index.ts /tmp/deployed/<fn>/source/index.ts
diff -u supabase/functions/_shared/today.ts /tmp/deployed/<fn>/_shared/today.ts
# … every bundled file, every deployed function
```

Zero differences is the only pass. **A mismatch on the first attempt is the
expected outcome, not an incident** — fix by patching the specific lines and
deploy again. This loop is the procedure.

### 5. Bundle verification script — exit code 0 required

Covers what the byte-diff cannot: a function that should have been redeployed
but wasn't (13 August: `summary.ts` fixed in close-day-cron, coach-chat
skipped, weight leaked through the manual day-close).

1. Produce a fresh `supabase/scripts/.live-snapshots/live.json`:
   `list_edge_functions` once, `get_edge_function` per returned slug, write
   `{ "generated_at": <ISO 8601 UTC, stamped at write time>, "project_ref":
   "nhcgepdrbrvfukxpbhmi", "functions": { "<slug>": <result>, … } }`.
2. Within 15 minutes run:
   `deno run --allow-read supabase/scripts/verify-edge-function-bundles.ts`
3. Report the exit code and the per-function verdicts.

The script refuses a snapshot older than 15 minutes. That refusal is the guard
working — regenerate and rerun, never work around it.

### 6. Test against the live database — and clean up in the same session

There is no staging database. Every test writes real rows that the 23:30
notification and the nightly day-close cron (01:00 UTC) can close over. Before testing, record
the state; afterwards restore it exactly:

- **Read every value fresh right before changing it; restore exactly that
  value.** A restore from memory has already put a wrong value back.
- **Deletes:** do not run DELETE through the Supabase connector — its approval
  prompt times out. Give the user ready-to-paste SQL with full ids, a guard on
  the identifying columns, `RETURNING id` and the expected row count. The user
  runs it in the dashboard SQL Editor; you verify with a fresh select.
- `nutrition_log`: note today's ids before testing; remove what you created;
  the day's SUM must match what was actually eaten (and `coach_sessions` if the
  day is closed). Since 5 Oct the trigger recomputes row totals from
  `componenten` — never write totals on a row with components.
- `nutrition_product`: no test products left behind unless the user confirms.
- `coach_memory`: deactivate facts stored during testing; never touch real
  facts without confirmation.
- `coach_sessions`: a test day-close for today makes the app clear its thread
  on next open — tell the user before and after, so the app stays closed in
  between. Restore the row exactly, including `vraag_voor_morgen`.
- `coach_checkin_card`: first write wins — a test row for today *becomes*
  today's card. Remove it. Same for `checkin_diag` test rows.
- `step_log`: must be untouched.

When comparing times: `created_at` is UTC (`timestamptz`), `tijdstip` is
Europe/Amsterdam local. Convert with `created_at AT TIME ZONE
'Europe/Amsterdam'` before comparing. (§12 — a "2-hour gap" once turned out to
be a timezone mix-up.)

Behaviour rule changed? Test it in conversation **and** with a day-close (and
a morning card if morning-checkin was touched).

### 7. Merge so main equals production

Commit on a branch, open a PR, merge. After merging, `main` must contain
exactly the deployed bytes for every function. Code that is live but only on a
branch or in a local commit is the same exposure as step 1.

### 8. Report

The report always contains:

- **Payload provenance**, one line per deploy: "patched onto last verified
  deploy" or "hand-composed". Never let "verified" suggest the payload arrived
  by a safer route.
- Version per function before → after, and the version of every function that
  was **not** redeployed (proves it was left alone).
- Byte-diff result per file, number of deploy attempts.
- Bundle script exit code and verdicts.
- Before/after state per table and date touched during testing.
- What the user should record in `voeding-app-v2.md` (the deploy table and the
  section of the change). Those docs live in the claude.ai project, not in this
  repo — you can't update them yourself.

## Rollback

There is no one-click rollback. Rolling back is a deploy of the previous
content (`git show <commit>:<path>`) through this same procedure, including
the byte-diff and the bundle script. Check first whether the database still
works with the old version (e.g. after a migration).

## Not without the user's explicit go-ahead

- Changing `verify_jwt`, the model, or `maxTokens` as a side effect.
- Installing or authenticating the Supabase CLI (open question: token scope
  and whether it survives the session — see §3 "De CLI-route").
- Deploying a function that the change doesn't touch "to be safe".
- Any DELETE on production data.
