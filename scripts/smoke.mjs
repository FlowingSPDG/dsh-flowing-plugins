// Load every built browser bundle the way DSH's client module system does:
// evaluate the classic script, capture the `window.__ModuleLoader__` entry, and
// run its `apply` against a recording stub of the Client context. This catches
// a bundle that evaluates but crashes before it can register its slots — the
// failure mode a page reload would otherwise reveal only in the browser.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))

const PACKAGES = [
  '@local/provider-visibility',
  '@local/ollama-offpeak',
  '@local/model-favorites',
  '@local/ollama-quota',
  '@local/opencode-go-quota',
]

/** Minimal document surface the stylesheet effects touch. */
function fakeDocument() {
  const head = { children: [], appendChild(node) { this.children.push(node) } }
  return {
    head,
    body: { appendChild() {} },
    createElement() {
      return {
        dataset: {},
        style: {},
        textContent: '',
        remove() {},
        setAttribute() {},
        appendChild() {},
        addEventListener() {},
      }
    },
    addEventListener() {},
    removeEventListener() {},
  }
}

/** A context that records slot registrations and runs effects once. */
function recordingContext(registrations, effects) {
  const slots = {
    inject(key, callback) {
      registrations.push([key, 'inject'])
      return callback()
    },
    register(options, component) {
      registrations.push([options.name, 'register'])
      return () => {}
    },
  }
  const locale = {
    register: () => () => {},
    resolveText: (text) => String(text),
    bind: () => (key) => key,
  }
  const ctx = {
    effect(execute, label) {
      effects.push(label ?? 'effect')
      const dispose = execute()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    inject(_services, callback) {
      return callback(ctx)
    },
    on: () => () => {},
    get: () => undefined,
    slots,
    locale,
  }
  return ctx
}

const modules = {
  react: require('react'),
  'react-dom': require('react-dom'),
  'react/jsx-runtime': require('react/jsx-runtime'),
  'react/jsx-dev-runtime': require('react/jsx-dev-runtime'),
}

let failures = 0
for (const name of PACKAGES) {
  const dir = name.replace('@local/', '')
  const path = join(root, dir, 'dist', 'client.js')
  const code = await readFile(path, 'utf8')
  const registrations = []
  const effects = []
  const loaded = []
  const window = { __ModuleLoader__: { load: (entry) => loaded.push(entry) } }
  const context = vm.createContext({
    window,
    document: fakeDocument(),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  })
  try {
    vm.runInContext(code, context, { filename: path })
    assert.equal(loaded.length, 1, 'exactly one registration')
    const entry = loaded[0]
    assert.equal(entry.id, name, 'registration id equals the package name')
    const exportsOf = entry.factory((specifier) => {
      assert.ok(specifier in modules, `unexpected require("${specifier}")`)
      return modules[specifier]
    })
    assert.equal(typeof exportsOf.apply, 'function', 'exports.apply')
    assert.ok(Array.isArray(exportsOf.inject), 'exports.inject is an array')
    exportsOf.apply(recordingContext(registrations, effects))
    const slotCalls = registrations.filter(([, kind]) => kind === 'register')
    assert.ok(slotCalls.length > 0, 'registers at least one slot')
    console.log(
      `ok   ${name}  -> ${slotCalls.map(([slot]) => slot).join(', ')} (${effects.length} effects)`,
    )
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failures > 0) {
  process.exitCode = 1
} else {
  console.log(`\n${PACKAGES.length} browser bundles load and register cleanly.`)
}
