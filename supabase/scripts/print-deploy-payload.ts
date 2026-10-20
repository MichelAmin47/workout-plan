#!/usr/bin/env -S deno run --allow-read
// supabase/scripts/print-deploy-payload.ts
//
// Prints, from disk, the exact `files` array a deploy_edge_function call
// needs for one function: every file reachable from <function>/index.ts
// through relative imports, named with this project's convention
// (`source/<basename>` for the function's own files, `_shared/<basename>`
// for shared ones), plus each file's byte length and SHA-256.
//
//   deno run --allow-read supabase/scripts/print-deploy-payload.ts <slug>          # summary
//   deno run --allow-read supabase/scripts/print-deploy-payload.ts <slug> --json   # [{ name, content }]
//
// The import walk and the naming are the same rules as
// verify-edge-function-bundles.ts (kept as a separate copy so the verify
// script stays untouched). The MCP tool still takes literal content, so
// the payload still passes through the assistant: the byte-diff after
// deploy and the verify script remain the proof, this only removes
// guesswork about which files and which names.

const functionsDirUrl = new URL('../functions/', import.meta.url)
const sharedDirUrl = new URL('_shared/', functionsDirUrl)

const COMMENT_LINE = /^\s*\/\//
const FROM_SPECIFIER = /from\s+(['"])((?:(?!\1).)+)\1/
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

function deployName(fileUrl: URL, functionDirUrl: URL): string {
  if (fileUrl.href.startsWith(functionDirUrl.href)) return `source/${fileUrl.href.slice(functionDirUrl.href.length)}`
  if (fileUrl.href.startsWith(sharedDirUrl.href)) return `_shared/${fileUrl.href.slice(sharedDirUrl.href.length)}`
  throw new Error(`Import resolved outside supabase/functions/_shared/: ${fileUrl.href}`)
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const [slug, flag] = Deno.args
if (!slug) {
  console.error('usage: print-deploy-payload.ts <function-slug> [--json]')
  Deno.exit(2)
}
const functionDirUrl = new URL(`${slug}/`, functionsDirUrl)
const entryUrl = new URL('index.ts', functionDirUrl)
const queue: URL[] = [entryUrl]
const seen = new Set<string>([entryUrl.href])
const files: { name: string; content: string; bytes: number; sha256: string }[] = []
while (queue.length > 0) {
  const url = queue.shift()!
  const bytes = await Deno.readFile(url)
  const content = new TextDecoder().decode(bytes)
  files.push({ name: deployName(url, functionDirUrl), content, bytes: bytes.length, sha256: await sha256(bytes) })
  for (const specifier of extractImportSpecifiers(content)) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
    const resolved = new URL(specifier, url)
    if (!seen.has(resolved.href)) {
      seen.add(resolved.href)
      queue.push(resolved)
    }
  }
}
files.sort((a, b) => (a.name === 'source/index.ts' ? -1 : b.name === 'source/index.ts' ? 1 : a.name.localeCompare(b.name)))

if (flag === '--json') {
  console.log(JSON.stringify(files.map(({ name, content }) => ({ name, content })), null, 2))
} else {
  console.log(`${slug}: entrypoint source/index.ts, ${files.length} files`)
  for (const f of files) console.log(`  ${f.name.padEnd(28)} ${String(f.bytes).padStart(7)} B  sha256 ${f.sha256}`)
}
