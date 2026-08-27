#!/usr/bin/env -S deno run --allow-read
// supabase/scripts/verify-edge-function-bundles.ts
//
// Bundle-derived deploy verification for this repo's Supabase Edge
// Functions.
//
// Deploys here go exclusively through the deploy_edge_function MCP tool
// with a hand-built `files` array — there is no supabase/config.toml, no
// CI, no `supabase functions deploy`. The standing byte-diff-after-deploy
// habit catches a corrupted or retyped file, but it only ever compares
// files that were actually included in a deploy call. It cannot catch a
// shared file changing while some function that also bundles it never
// gets redeployed — that function just keeps running stale code,
// silently. This script closes that gap: it derives each function's
// *expected* bundle from its own relative-import graph (nobody's memory
// of "which functions share which files" is trusted) and diffs every
// function against its live deployment, unconditionally, every run.
//
// ── The one manual step: supabase/scripts/.live-snapshots/live.json ──
//
// This script has no credentials and never calls Supabase itself — it
// only reads a pre-fetched snapshot. Investigated and deliberately
// rejected: a standalone fetch via the Management API's
// `.../functions/{slug}/body` endpoint returns a compiled eszip bundle
// (confirmed via the Supabase CLI's own `functions download` debug
// output: "Eszip extracted successfully"), not per-file JSON — decoding
// that correctly would need an eszip parser and an empirically unverified
// specifier-to-path mapping. Rather than guess at that, this script takes
// the live bundle data from whatever already reads it correctly in this
// project: an assistant session with the Supabase `get_edge_function` /
// `list_edge_functions` MCP tools.
//
// To (re)generate the snapshot this script reads:
//   1. Call list_edge_functions once, to get every deployed function slug.
//   2. Call get_edge_function for each returned slug.
//   3. Write supabase/scripts/.live-snapshots/live.json shaped exactly as:
//        {
//          "generated_at": "<ISO 8601 UTC, e.g. new Date().toISOString()>",
//          "project_ref": "<the Supabase project ref used above>",
//          "functions": { "<slug>": <get_edge_function's own JSON result>, ... }
//        }
//      including every slug list_edge_functions returned, even ones with
//      no matching local supabase/functions/<slug> directory.
//
// generated_at and project_ref are REQUIRED. This script refuses to run
// (non-zero exit, nothing else printed) if either is missing, or if
// generated_at is more than 15 minutes old (see checkSnapshotFreshness
// below) — checked BEFORE anything else runs, specifically so a stale
// snapshot never gets to print a wall of green verdicts above the eventual
// refusal. Deploy verification is something you do right after deploying;
// there is no legitimate case for diffing against an hours-old production
// snapshot, and comparing disk against it would report a confident PASS
// against a state that may no longer be true — the same false-confidence
// failure this whole script exists to prevent, just moved one step
// upstream, and one this script cannot detect from the JSON's *content*
// alone. Hence the explicit, mandatory timestamp contract.
//
// ── The source/ + _shared/ naming convention ──
//
// A function's own files are named "source/<basename>" in a deployed
// files array; anything under supabase/functions/_shared/ keeps a
// "_shared/<basename>" name (flattened, not "../_shared/<basename>").
// THIS IS THIS PROJECT'S OWN established manual convention for
// hand-building a deploy_edge_function payload — confirmed by reading live
// deploys, NOT a documented Supabase rule. If someone ever hand-builds a
// deploy payload with different names, this script will start reporting
// phantom MISSING FROM DEPLOYMENT / STALE IN DEPLOYMENT entries, and the
// reason will not be obvious from the report alone — it will be this
// convention silently no longer holding. See mapToDeployName() below.
//
// ── Known limitation: line-based import scanning, not a real TS parser ──
//
// extractImportSpecifiers() below is a targeted, line-based regex scan,
// not a full TypeScript parser. It is proportionate to (and verified
// against) this codebase's actual, consistently simple import style: every
// import is a top-level `import ... from '...'` / `import '...'`, or (for
// a multi-line destructured import) a closing `} from '...'` on its own
// line — confirmed by inspecting every import under supabase/functions.
// Comment-only lines (trimmed text starting with "//") are skipped before
// matching, specifically because two real lines in this codebase contain
// the literal token "from" followed by a quoted string inside a comment
// (coach-chat/tools.ts and morning-checkin/index.ts) and would otherwise
// false-positive as import specifiers. No block comments (/* */) exist
// anywhere in this tree (checked) and no dynamic/conditional imports exist
// either (checked: no `import(`, no `require(`, no template-literal import
// specifiers) — if either is ever introduced, this scan would under-report
// the bundle with no warning, since it has no way to detect what it isn't
// looking for.

const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000

const scriptDirUrl = new URL('.', import.meta.url)
const functionsDirUrl = new URL('../functions/', scriptDirUrl)
const sharedDirUrl = new URL('_shared/', functionsDirUrl)
const snapshotUrl = new URL('.live-snapshots/live.json', scriptDirUrl)

interface LiveFile {
  name: string
  content: string
}

interface LiveFunctionResult {
  files: LiveFile[]
  [key: string]: unknown
}

interface LiveSnapshot {
  generated_at?: unknown
  project_ref?: unknown
  functions?: Record<string, LiveFunctionResult>
}

function fail(message: string): never {
  console.error(message)
  Deno.exit(1)
}

async function loadSnapshot(): Promise<LiveSnapshot> {
  let raw: string
  try {
    raw = await Deno.readTextFile(snapshotUrl)
  } catch (err) {
    return fail(
      `Could not read live snapshot at ${snapshotUrl.pathname}: ${err instanceof Error ? err.message : String(err)}\n` +
        `Generate it first — see this script's header comment.`,
    )
  }
  try {
    return JSON.parse(raw) as LiveSnapshot
  } catch (err) {
    return fail(`Live snapshot at ${snapshotUrl.pathname} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Checked before anything else runs (see header comment) — this is what
// keeps a stale snapshot from ever reaching the comparison logic, rather
// than merely being flagged after a wall of per-function output.
function checkSnapshotFreshness(snapshot: LiveSnapshot): { generatedAt: string; projectRef: string } {
  if (typeof snapshot.generated_at !== 'string' || snapshot.generated_at.length === 0) {
    fail(
      'live.json is missing the required "generated_at" field (ISO 8601 UTC timestamp). ' +
        "Refusing to run against a snapshot of unknown age — see this script's header comment for how to regenerate it.",
    )
  }
  if (typeof snapshot.project_ref !== 'string' || snapshot.project_ref.length === 0) {
    fail('live.json is missing the required "project_ref" field. Refusing to run against an unidentified snapshot — see this script\'s header comment.')
  }
  const generatedAtMs = Date.parse(snapshot.generated_at)
  if (Number.isNaN(generatedAtMs)) {
    fail(`live.json's "generated_at" ("${snapshot.generated_at}") is not a parseable timestamp.`)
  }
  const ageMs = Date.now() - generatedAtMs
  if (ageMs > SNAPSHOT_MAX_AGE_MS) {
    const ageMin = (ageMs / 60000).toFixed(1)
    fail(
      `live.json is ${ageMin} minutes old (generated_at: ${snapshot.generated_at}) — older than the ${SNAPSHOT_MAX_AGE_MS / 60000}-minute limit. ` +
        "Regenerate it right before running this script; see the header comment.",
    )
  }
  return { generatedAt: snapshot.generated_at, projectRef: snapshot.project_ref }
}

const COMMENT_LINE = /^\s*\/\//
// `from '...'`/`from "..."` anywhere on a (non-comment) line — covers
// `import { x } from '...'`, `import x from '...'`, and the closing
// `} from '...'` line of a multi-line destructured import.
const FROM_SPECIFIER = /from\s+(['"])((?:(?!\1).)+)\1/
// A bare, from-less side-effect import: `import '...'`.
const BARE_IMPORT_SPECIFIER = /^\s*import\s+(['"])((?:(?!\1).)+)\1/

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  for (const line of source.split('\n')) {
    if (COMMENT_LINE.test(line)) continue
    const fromMatch = FROM_SPECIFIER.exec(line)
    if (fromMatch) {
      specifiers.push(fromMatch[2])
      continue
    }
    const bareMatch = BARE_IMPORT_SPECIFIER.exec(line)
    if (bareMatch) specifiers.push(bareMatch[2])
  }
  return specifiers
}

// See "The source/ + _shared/ naming convention" in the header comment —
// this mapping is a hand-observed project convention, not a Supabase rule.
function mapToDeployName(fileUrl: URL): string {
  if (fileUrl.href.startsWith(sharedDirUrl.href)) {
    return `_shared/${fileUrl.href.slice(sharedDirUrl.href.length)}`
  }
  throw new Error(`Import resolved outside supabase/functions/_shared/: ${fileUrl.href}`)
}

function mapOwnFileToDeployName(fileUrl: URL, functionDirUrl: URL): string {
  if (fileUrl.href.startsWith(functionDirUrl.href)) {
    return `source/${fileUrl.href.slice(functionDirUrl.href.length)}`
  }
  return mapToDeployName(fileUrl)
}

interface DerivedBundle {
  files: Map<string, URL> // deployName -> resolved local file URL
  external: Set<string> // non-relative specifiers seen (npm:, jsr:, https:, ...), never bundled
}

// Walks the relative-import graph starting at <function>/index.ts. Forward
// only — nothing scans the directory for files that happen to exist; a
// file is only ever included because something reachable from index.ts
// actually imports it. This is precisely why a colocated test file (e.g.
// morning-checkin/validateAntwoordOpties.test.ts, which imports index.ts,
// not the other way around) never appears in the derived bundle.
async function deriveBundle(functionDirUrl: URL): Promise<DerivedBundle> {
  const entryUrl = new URL('index.ts', functionDirUrl)
  const visited = new Map<string, URL>()
  const external = new Set<string>()
  const queue: URL[] = [entryUrl]
  const seen = new Set<string>([entryUrl.href])

  while (queue.length > 0) {
    const currentUrl = queue.shift()!
    const source = await Deno.readTextFile(currentUrl)
    visited.set(currentUrl.href, currentUrl)

    for (const specifier of extractImportSpecifiers(source)) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        external.add(specifier)
        continue
      }
      const resolved = new URL(specifier, currentUrl)
      if (!seen.has(resolved.href)) {
        seen.add(resolved.href)
        queue.push(resolved)
      }
    }
  }

  const files = new Map<string, URL>()
  for (const url of visited.values()) {
    files.set(mapOwnFileToDeployName(url, functionDirUrl), url)
  }
  return { files, external }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// Not a diff algorithm — just enough to locate the divergence: byte
// lengths, the first differing offset, and a short surrounding snippet
// from each side.
function describeMismatch(localBytes: Uint8Array, liveBytes: Uint8Array): string {
  const shorter = Math.min(localBytes.length, liveBytes.length)
  let firstDiff = shorter
  for (let i = 0; i < shorter; i++) {
    if (localBytes[i] !== liveBytes[i]) {
      firstDiff = i
      break
    }
  }
  const decoder = new TextDecoder()
  const snippet = (bytes: Uint8Array) => {
    const start = Math.max(0, firstDiff - 20)
    const end = Math.min(bytes.length, firstDiff + 20)
    return decoder.decode(bytes.slice(start, end))
  }
  return (
    `local ${localBytes.length} bytes, live ${liveBytes.length} bytes, first differing byte at offset ${firstDiff}\n` +
    `      local: ...${JSON.stringify(snippet(localBytes))}...\n` +
    `      live:  ...${JSON.stringify(snippet(liveBytes))}...`
  )
}

type Verdict =
  | { deployName: string; status: 'ok' }
  | { deployName: string; status: 'mismatch'; detail: string }
  | { deployName: string; status: 'missing-from-deployment' }
  | { deployName: string; status: 'stale-in-deployment' }

async function compareFunction(derived: DerivedBundle, live: LiveFunctionResult | undefined): Promise<{ verdicts: Verdict[]; neverDeployed: boolean }> {
  if (!live) return { verdicts: [], neverDeployed: true }

  const liveFilesByName = new Map(live.files.map((f) => [f.name, f.content]))
  const verdicts: Verdict[] = []

  for (const [deployName, url] of derived.files) {
    const localBytes = await Deno.readFile(url)
    const liveContent = liveFilesByName.get(deployName)
    if (liveContent === undefined) {
      verdicts.push({ deployName, status: 'missing-from-deployment' })
      continue
    }
    const liveBytes = new TextEncoder().encode(liveContent)
    if (bytesEqual(localBytes, liveBytes)) {
      verdicts.push({ deployName, status: 'ok' })
    } else {
      verdicts.push({ deployName, status: 'mismatch', detail: describeMismatch(localBytes, liveBytes) })
    }
  }

  for (const name of liveFilesByName.keys()) {
    if (!derived.files.has(name)) {
      verdicts.push({ deployName: name, status: 'stale-in-deployment' })
    }
  }

  return { verdicts, neverDeployed: false }
}

async function discoverFunctionSlugs(): Promise<string[]> {
  const slugs: string[] = []
  for await (const entry of Deno.readDir(functionsDirUrl)) {
    if (entry.isDirectory && entry.name !== '_shared') slugs.push(entry.name)
  }
  slugs.sort()
  return slugs
}

async function main() {
  const snapshot = await loadSnapshot()
  const { generatedAt, projectRef } = checkSnapshotFreshness(snapshot)

  // Nothing above this line prints anything other than a refusal — see
  // the header comment on why the freshness check runs, and can fail,
  // before any per-function output exists to bury it.
  console.log(`live.json generated_at: ${generatedAt}`)
  console.log(`project_ref: ${projectRef}`)
  console.log('')

  const slugs = await discoverFunctionSlugs()
  let overallOk = true

  for (const slug of slugs) {
    const functionDirUrl = new URL(`${slug}/`, functionsDirUrl)
    const derived = await deriveBundle(functionDirUrl)
    const live = snapshot.functions?.[slug]
    const { verdicts, neverDeployed } = await compareFunction(derived, live)

    console.log(`== ${slug} ==`)

    if (neverDeployed) {
      console.log('  NEVER DEPLOYED — no entry for this function in live.json')
      console.log('  FAIL')
      console.log('')
      overallOk = false
      continue
    }

    let functionOk = true
    for (const v of verdicts) {
      switch (v.status) {
        case 'ok':
          console.log(`  OK                       ${v.deployName}`)
          break
        case 'mismatch':
          console.log(`  MISMATCH                 ${v.deployName}`)
          console.log(`      ${v.detail}`)
          functionOk = false
          break
        case 'missing-from-deployment':
          console.log(`  MISSING FROM DEPLOYMENT  ${v.deployName}`)
          functionOk = false
          break
        case 'stale-in-deployment':
          console.log(`  STALE IN DEPLOYMENT      ${v.deployName}`)
          functionOk = false
          break
      }
    }
    if (derived.external.size > 0) {
      console.log(`  (external, not bundled: ${[...derived.external].sort().join(', ')})`)
    }
    console.log(functionOk ? '  PASS' : '  FAIL')
    console.log('')
    if (!functionOk) overallOk = false
  }

  console.log(overallOk ? 'All functions match their derived bundles.' : 'One or more functions do not match their derived bundles.')
  Deno.exit(overallOk ? 0 : 1)
}

main().catch((err) => {
  console.error('verify-edge-function-bundles crashed unexpectedly:', err)
  Deno.exit(1)
})
