import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createStore, type FavoritesStore } from './document.ts'
import {
  MAX_BODY_BYTES,
  ROUTE,
  createStateRoute,
  type RouteRequest,
  type RouteResponse,
} from './route.ts'

/** A request whose body the test delivers once the handler has subscribed. */
class MockRequest implements RouteRequest {
  readonly method: string
  private readonly chunks: string[]
  private readonly dataListeners: Array<(chunk: Uint8Array | string) => void> = []
  private readonly endListeners: Array<() => void> = []
  private readonly errorListeners: Array<(error: unknown) => void> = []

  constructor(method: string, body?: string) {
    this.method = method
    this.chunks = body === undefined ? [] : [body]
  }

  on(event: 'data', listener: (chunk: Uint8Array | string) => void): void
  on(event: 'end', listener: () => void): void
  on(event: 'error', listener: (error: unknown) => void): void
  on(
    event: string,
    listener: ((chunk: Uint8Array | string) => void) | (() => void) | ((error: unknown) => void),
  ): void {
    if (event === 'data') this.dataListeners.push(listener as (chunk: Uint8Array | string) => void)
    else if (event === 'end') this.endListeners.push(listener as () => void)
    else if (event === 'error') this.errorListeners.push(listener as (error: unknown) => void)
  }

  /** Emit the body and the end marker, after the handler's listeners exist. */
  deliver(): void {
    queueMicrotask(() => {
      for (const chunk of this.chunks) {
        for (const listener of this.dataListeners) listener(chunk)
      }
      for (const listener of this.endListeners) listener()
    })
  }
}

/** A response recording what the handler wrote. */
class MockResponse implements RouteResponse {
  status: number | undefined
  headers: Record<string, string | number> | undefined
  body = ''

  writeHead(status: number, headers?: Record<string, string | number>): void {
    this.status = status
    this.headers = headers
  }

  end(body?: string): void {
    this.body = body ?? ''
  }
}

interface ExchangeOptions {
  readonly method: string
  readonly store: FavoritesStore
  readonly body?: string
  readonly reject?: (req: RouteRequest) => number | undefined
}

/** Run one request through a fresh handler. */
async function exchange(options: ExchangeOptions): Promise<MockResponse> {
  const req = new MockRequest(options.method, options.body)
  const res = new MockResponse()
  const handler = createStateRoute(
    options.reject === undefined
      ? { store: options.store }
      : { store: options.store, reject: options.reject },
  )
  const done = handler(req, res)
  req.deliver()
  await done
  return res
}

/** A fresh directory per test. */
async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'model-favorites-route-'))
}

/** JSON body of one response. */
function payload(res: MockResponse): unknown {
  return JSON.parse(res.body)
}

test('the route path is the one the browser posts to', () => {
  assert.equal(ROUTE, '/model-favorites/state')
})

test('GET answers the saved document with no-store caching', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    await writeFile(path, '{"providers":["p"],"models":["p/m"]}\n', 'utf8')
    const store = createStore({ path })
    const res = await exchange({ method: 'GET', store })
    assert.equal(res.status, 200)
    assert.deepEqual(payload(res), { providers: ['p'], models: ['p/m'] })
    assert.equal(res.headers?.['content-type'], 'application/json; charset=utf-8')
    assert.equal(res.headers?.['cache-control'], 'no-store')
    assert.equal(res.headers?.['content-length'], Buffer.byteLength(res.body))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('GET of a corrupt document answers 500 and quarantines the file', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    await writeFile(path, '{"providers": [', 'utf8')
    const res = await exchange({ method: 'GET', store: createStore({ path }) })
    assert.equal(res.status, 500)
    assert.match(String((payload(res) as { error: string }).error), /not valid JSON/u)
    const quarantined = (await readdir(directory)).filter((name) => name.includes('.corrupt-'))
    assert.equal(quarantined.length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('HEAD answers like GET', async () => {
  const directory = await scratch()
  try {
    const res = await exchange({ method: 'HEAD', store: createStore({ path: join(directory, 'state.json') }) })
    assert.equal(res.status, 200)
    assert.deepEqual(payload(res), { providers: [], models: [] })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('POST replaces the document with the normalized one', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    const res = await exchange({
      method: 'POST',
      store: createStore({ path }),
      body: '{"providers":["  p  ","p",""],"models":["p/m",null]}',
    })
    assert.equal(res.status, 200)
    assert.deepEqual(payload(res), { providers: ['p'], models: ['p/m'] })
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { providers: ['p'], models: ['p/m'] })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('POST of an empty body is 400 and changes nothing', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    await writeFile(path, '{"providers":["keep"],"models":[]}\n', 'utf8')
    const res = await exchange({ method: 'POST', store: createStore({ path }), body: '   \n' })
    assert.equal(res.status, 400)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { providers: ['keep'], models: [] })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('POST of invalid JSON is 400 and changes nothing', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    const res = await exchange({ method: 'POST', store: createStore({ path }), body: '{"providers":[' })
    assert.equal(res.status, 400)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('POST beyond the body cap is 413', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    const body = `{"providers":["${'x'.repeat(MAX_BODY_BYTES)}"]}`
    const res = await exchange({ method: 'POST', store: createStore({ path }), body })
    assert.equal(res.status, 413)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('any other method is 405 with the allowed set', async () => {
  const directory = await scratch()
  try {
    const res = await exchange({ method: 'PUT', store: createStore({ path: join(directory, 'state.json') }), body: '{}' })
    assert.equal(res.status, 405)
    assert.equal(res.headers?.['allow'], 'GET, HEAD, POST')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a refused request never reaches the document', async () => {
  const directory = await scratch()
  try {
    const path = join(directory, 'state.json')
    await writeFile(path, '{"providers":["keep"],"models":[]}\n', 'utf8')
    const res = await exchange({
      method: 'POST',
      store: createStore({ path }),
      body: '{"providers":[],"models":[]}',
      reject: () => 403,
    })
    assert.equal(res.status, 403)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { providers: ['keep'], models: [] })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a write failure is answered 500', async () => {
  const directory = await scratch()
  try {
    const store = createStore({
      path: join(directory, 'state.json'),
      renameAttempts: 1,
      fs: {
        rename: async () => {
          const error = new Error('rename refused') as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        },
      },
    })
    const res = await exchange({ method: 'POST', store, body: '{"providers":["p"],"models":[]}' })
    assert.equal(res.status, 500)
    assert.match(String((payload(res) as { error: string }).error), /rename refused/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
