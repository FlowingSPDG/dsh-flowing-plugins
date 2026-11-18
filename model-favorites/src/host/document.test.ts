import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MAX_ENTRIES,
  MAX_KEY_LENGTH,
  createStore,
  emptyDocument,
  normalizeDocument,
  statePath,
} from './document.ts'

/** A fresh directory per test, removed on exit. */
async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'model-favorites-doc-'))
  return directory
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

test('normalizeDocument keeps only well-formed, bounded, de-duplicated keys', () => {
  assert.deepEqual(normalizeDocument(undefined), emptyDocument())
  assert.deepEqual(normalizeDocument('nope'), emptyDocument())
  assert.deepEqual(normalizeDocument(null), emptyDocument())
  assert.deepEqual(normalizeDocument({ providers: 'x', models: 7 }), emptyDocument())
  assert.deepEqual(
    normalizeDocument({
      providers: ['  a  ', 'a', '', '   ', 3, null, 'b'],
      models: ['m/n', 'm/n', '  m/n  ', 'x'.repeat(MAX_KEY_LENGTH + 1), 'ok'],
    }),
    { providers: ['a', 'b'], models: ['m/n', 'ok'] },
  )
})

test('normalizeDocument caps each list at MAX_ENTRIES', () => {
  const many = Array.from({ length: MAX_ENTRIES + 25 }, (_, index) => `p${String(index)}`)
  const document = normalizeDocument({ providers: many, models: many })
  assert.equal(document.providers.length, MAX_ENTRIES)
  assert.equal(document.models.length, MAX_ENTRIES)
  assert.equal(document.providers[0], 'p0')
  assert.equal(document.providers[MAX_ENTRIES - 1], `p${String(MAX_ENTRIES - 1)}`)
})

test('statePath follows DSH_HOME and falls back to the home directory', () => {
  const env: NodeJS.ProcessEnv = { DSH_HOME: join(tmpdir(), 'dsh-home') }
  assert.equal(statePath(env), join(tmpdir(), 'dsh-home', 'storages', 'model-favorites', 'state.json'))
  assert.match(statePath({}), /storages[\\/]model-favorites[\\/]state\.json$/u)
})

test('read of a missing document is empty, not a failure', async () => {
  const directory = await scratch()
  try {
    const store = createStore({ path: join(directory, 'state.json') })
    assert.deepEqual(await store.read(), emptyDocument())
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('write lands through a temporary file plus rename', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    let temporary = ''
    let existedAtRename = false
    const store = createStore({
      path,
      fs: {
        writeFile: async (file, data, encoding) => {
          temporary = file
          await writeFile(file, data, encoding)
        },
        rename: async (from, to) => {
          existedAtRename = await exists(from)
          await rename(from, to)
        },
      },
    })
    await store.write({ providers: ['p'], models: ['p/m'] })
    assert.match(temporary, /state\.json\.[0-9]+\.[0-9a-z]+[0-9a-z]+\.tmp$/u)
    assert.equal(existedAtRename, true)
    assert.equal(await exists(path), true)
    const saved: unknown = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(saved, { providers: ['p'], models: ['p/m'] })
    const leftovers = (await readdir(directory)).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(leftovers, [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a failed write leaves no temporary file and keeps the previous document', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    await writeFile(path, '{"providers":["old"],"models":[]}\n', 'utf8')
    const store = createStore({
      path,
      renameAttempts: 1,
      fs: {
        rename: async () => {
          const error = new Error('rename refused') as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        },
      },
    })
    await assert.rejects(store.write({ providers: ['new'], models: [] }), /rename refused/u)
    const leftovers = (await readdir(directory)).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(leftovers, [])
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { providers: ['old'], models: [] })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a transient EPERM rename is retried, and a failure does not poison the next write', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    let renames = 0
    let failures = 1
    const store = createStore({
      path,
      renameAttempts: 3,
      renameDelayMs: 0,
      fs: {
        rename: async (from, to) => {
          renames += 1
          if (failures > 0) {
            failures -= 1
            const error = new Error('busy') as NodeJS.ErrnoException
            error.code = 'EPERM'
            throw error
          }
          await rename(from, to)
        },
      },
    })

    await store.write({ providers: ['one'], models: [] })
    assert.equal(renames, 2)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { providers: ['one'], models: [] })

    // A hard failure, then a success: the queue starts clean after the failure.
    failures = 3
    await assert.rejects(store.write({ providers: ['two'], models: [] }), /busy/u)
    await store.write({ providers: ['three'], models: [] })
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { providers: ['three'], models: [] })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('writes run in call order', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    const store = createStore({ path })
    await Promise.all([
      store.write({ providers: ['first'], models: [] }),
      store.write({ providers: ['second'], models: [] }),
      store.write({ providers: ['third'], models: [] }),
    ])
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { providers: ['third'], models: [] })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a corrupt document is moved aside and the read fails instead of reading as empty', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    await writeFile(path, '{"providers": [', 'utf8')
    const store = createStore({
      path,
      now: () => Date.parse('2026-11-18T12:30:00.123Z'),
    })
    await assert.rejects(store.read(), /not valid JSON/u)
    assert.equal(await exists(path), false)
    const names = (await readdir(directory)).filter((name) => name.includes('.corrupt-'))
    assert.deepEqual(names, ['state.corrupt-2026-11-18T12-30-00-123Z.json'])
    assert.equal(await readFile(join(directory, names[0] ?? ''), 'utf8'), '{"providers": [')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a corrupt document keeps distinct quarantine names on repeated reads', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    const store = createStore({ path, now: () => Date.parse('2026-11-18T12:30:00.123Z') })
    for (const attempt of [1, 2]) {
      await writeFile(path, `not json ${String(attempt)}`, 'utf8')
      await assert.rejects(store.read(), /not valid JSON/u)
    }
    const names = (await readdir(directory)).filter((name) => name.includes('.corrupt-'))
    assert.equal(names.length, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a disposed store refuses further writes', async () => {
  const directory = await scratch()
  try {
    const store = createStore({ path: join(directory, 'state.json') })
    store.dispose()
    await assert.rejects(store.write({ providers: [], models: [] }), /disposed/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
