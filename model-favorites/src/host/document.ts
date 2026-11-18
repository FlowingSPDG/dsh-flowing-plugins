/**
 * The one durable favorites document and the store that owns its file.
 *
 * The document lives beside the other Host state under
 * `$DSH_HOME/storages/model-favorites/state.json` (or `~/.dsh/...` when the
 * variable is unset) so favorites follow the profile across browsers, devices,
 * and restarts. Writes are serialized and land through a temporary file plus
 * rename, so a crash mid-write leaves the previous document intact rather than a
 * truncated one.
 *
 * A file that exists but does not parse is never reported as an empty document:
 * that would let the next browser write replace the user's favorites with
 * nothing. The unreadable file is moved aside to `state.corrupt-<stamp>.json`
 * and the read fails, so the route answers 500 and the browser — which only
 * writes after a successful read — leaves the document alone.
 *
 * @module @local/model-favorites/host/document
 */

import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  rename as fsRename,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/** The two string lists the browser half owns. */
export interface FavoritesDocument {
  providers: string[]
  models: string[]
}

/** The document's fields, in the order every walk visits them. */
export const FIELDS = ['providers', 'models'] as const

/** One document field name. */
export type FavoritesField = (typeof FIELDS)[number]

/** Most entries one list may hold; well above a realistic catalog. */
export const MAX_ENTRIES = 500

/** Longest accepted provider or model key. */
export const MAX_KEY_LENGTH = 200

/** Directory path segments below the DSH home. */
const STATE_SEGMENTS = ['storages', 'model-favorites'] as const

/** The document's file name. */
const STATE_FILE = 'state.json'

/** The empty document, also the answer when no file exists yet. */
export function emptyDocument(): FavoritesDocument {
  return { providers: [], models: [] }
}

/**
 * The favorites file this Host owns.
 * @param env - environment supplying `DSH_HOME`; defaults to the process one.
 * @returns absolute path of `state.json`.
 */
export function statePath(env: NodeJS.ProcessEnv = process.env): string {
  const home = typeof env['DSH_HOME'] === 'string' && env['DSH_HOME'] !== ''
    ? env['DSH_HOME']
    : join(homedir(), '.dsh')
  return join(home, ...STATE_SEGMENTS, STATE_FILE)
}

/**
 * Keep only well-formed, bounded, de-duplicated string lists.
 *
 * Non-object input, a non-array field, a non-string entry, a blank entry, an
 * over-long key, and a repeat all drop out; the first {@link MAX_ENTRIES} keys
 * of each field are kept.
 *
 * @param value - parsed request body or stored document.
 * @returns the normalized document.
 */
export function normalizeDocument(value: unknown): FavoritesDocument {
  const document = emptyDocument()
  if (typeof value !== 'object' || value === null) return document
  const record = value as Record<string, unknown>
  for (const field of FIELDS) {
    const list = record[field]
    if (!Array.isArray(list)) continue
    const seen = new Set<string>()
    const target = document[field]
    for (const entry of list as unknown[]) {
      if (typeof entry !== 'string') continue
      const key = entry.trim()
      if (key === '' || key.length > MAX_KEY_LENGTH) continue
      if (seen.has(key)) continue
      seen.add(key)
      target.push(key)
      if (target.length >= MAX_ENTRIES) break
    }
  }
  return document
}

/**
 * The file-system calls the store makes.
 *
 * Each member mirrors the `node:fs/promises` function of the same name, so the
 * default set is the real module and a test can substitute one member without a
 * mock library.
 */
export interface FavoritesFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
}

/** The favorites document store for one profile. */
export interface FavoritesStore {
  /** Absolute path of the document file. */
  readonly path: string
  /** Read the saved document; a missing file reads as empty. */
  read(): Promise<FavoritesDocument>
  /** Replace the saved document atomically, after every earlier write. */
  write(document: FavoritesDocument): Promise<void>
  /** Release the store; later writes fail, an in-flight write still settles. */
  dispose(): void
}

/** Store construction options; every member has a production default. */
export interface FavoritesStoreOptions {
  /** Document path; defaults to {@link statePath}. */
  path?: string
  /** File-system members to substitute; omitted members keep the real module. */
  fs?: Partial<FavoritesFs>
  /** Attempts at the final rename before surfacing the error. */
  renameAttempts?: number
  /** Base delay between rename attempts, multiplied by the attempt number. */
  renameDelayMs?: number
  /** Clock used for a quarantine name; defaults to `Date.now`. */
  now?: () => number
}

/** Rename attempts before the error surfaces (Windows EPERM/EBUSY are transient). */
const DEFAULT_RENAME_ATTEMPTS = 5

/** First pause between rename attempts. */
const DEFAULT_RENAME_DELAY_MS = 20

/** File-system error codes worth another rename attempt. */
const RETRYABLE_RENAME = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])

/** The real `node:fs/promises` members the store uses by default. */
const NODE_FS: FavoritesFs = {
  readFile: (path, encoding) => fsReadFile(path, encoding),
  writeFile: (path, data, encoding) => fsWriteFile(path, data, encoding),
  rename: (from, to) => fsRename(from, to),
  unlink: (path) => fsUnlink(path),
  mkdir: (path, options) => fsMkdir(path, options),
}

/** Error code carried by a file-system failure. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** Human-readable failure text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Pause for one rename retry. */
function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

/**
 * Quarantine name beside the document, for example
 * `state.corrupt-2026-11-18T12-30-00-123Z.json`.
 */
function quarantineName(path: string, stamp: number, index: number): string {
  const suffix = index === 1 ? '' : `-${String(index)}`
  const iso = new Date(stamp).toISOString().replace(/[:.]/g, '-')
  const base = basename(path).endsWith('.json')
    ? basename(path).slice(0, -'.json'.length)
    : basename(path)
  return join(dirname(path), `${base}.corrupt-${iso}${suffix}.json`)
}

/**
 * Create the document store.
 *
 * The returned store serializes writes: one write runs at a time, in call
 * order, and one failed write starts no queued chain of its own — the next
 * write begins from a repaired queue instead of inheriting the failure.
 *
 * @param options - path, file-system substitutions, and retry tuning.
 * @returns the store.
 */
export function createStore(options: FavoritesStoreOptions = {}): FavoritesStore {
  const path = options.path ?? statePath()
  const fs: FavoritesFs = { ...NODE_FS, ...options.fs }
  const renameAttempts = Math.max(1, options.renameAttempts ?? DEFAULT_RENAME_ATTEMPTS)
  const renameDelayMs = Math.max(0, options.renameDelayMs ?? DEFAULT_RENAME_DELAY_MS)
  const now = options.now ?? Date.now

  let tail: Promise<void> = Promise.resolve()
  let disposed = false

  /** The first quarantine name beside the document that is not taken yet. */
  async function freeQuarantineName(stamp: number): Promise<string> {
    for (let index = 1; index <= 6; index += 1) {
      const candidate = quarantineName(path, stamp, index)
      try {
        await fs.readFile(candidate, 'utf8')
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return candidate
      }
    }
    return quarantineName(path, stamp, 7)
  }

  /**
   * Move an unreadable document aside; returns where it landed.
   *
   * The move keeps the original bytes exactly (rename), so a reader can still
   * recover the document; when the platform refuses the move, the bytes are
   * copied beside it and the unreadable original is dropped.
   *
   * @param text - the bytes just read from the document.
   */
  async function quarantine(text: string): Promise<string> {
    const target = await freeQuarantineName(now())
    try {
      await fs.rename(path, target)
      return target
    } catch {
      await fs.writeFile(target, text, 'utf8')
      await fs.unlink(path).catch(() => {})
      return target
    }
  }

  async function read(): Promise<FavoritesDocument> {
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return emptyDocument()
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      let moved: string | undefined
      try {
        moved = await quarantine(text)
      } catch {
        moved = undefined
      }
      throw new Error(
        `model-favorites: ${path} is not valid JSON (${messageOf(error)})`
          + (moved === undefined ? '' : ` — moved aside to ${moved}`),
      )
    }
    return normalizeDocument(parsed)
  }

  /** Rename, retrying the transient failures Windows raises under load. */
  async function renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 1; attempt <= renameAttempts; attempt += 1) {
      try {
        await fs.rename(from, to)
        return
      } catch (error) {
        const code = errorCode(error)
        const retryable = code !== undefined && RETRYABLE_RENAME.has(code)
        if (!retryable || attempt === renameAttempts) throw error
        if (renameDelayMs > 0) await pause(renameDelayMs * attempt)
      }
    }
  }

  /** One atomic replace: write beside the target, then rename over it. */
  async function writeOnce(document: FavoritesDocument): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${String(process.pid)}.${now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    try {
      await renameWithRetry(temporary, path)
    } catch (error) {
      await fs.unlink(temporary).catch(() => {})
      throw error
    }
  }

  function write(document: FavoritesDocument): Promise<void> {
    if (disposed) return Promise.reject(new Error('model-favorites: the favorites store is disposed'))
    const attempt = tail.then(() => writeOnce(document))
    tail = attempt.catch(() => {})
    return attempt
  }

  function dispose(): void {
    disposed = true
    tail = Promise.resolve()
  }

  return { path, read, write, dispose }
}
