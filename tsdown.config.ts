// Build configuration for every plugin package.
//
// Host halves become plain ESM (`dist/index.js`) that the DSH Loader imports.
// Browser halves become the single classic script the client module system
// expects: a `window.__ModuleLoader__.load({ id, factory })` registration whose
// id is the package name (see @deepseek-ai/dsh-client-modules). The generated
// bundles are committed so `dsh plugin add github:…` needs no build step.
import { defineConfig, type UserConfig } from 'tsdown'

interface PackageSpec {
  dir: string
  name: string
}

const PACKAGES: PackageSpec[] = [
  { dir: 'provider-visibility', name: '@local/provider-visibility' },
  { dir: 'ollama-offpeak', name: '@local/ollama-offpeak' },
  { dir: 'model-favorites', name: '@local/model-favorites' },
  { dir: 'ollama-quota', name: '@local/ollama-quota' },
  { dir: 'opencode-go-quota', name: '@local/opencode-go-quota' },
]

/** Modules the browser module table already provides (baseline singletons). */
const CLIENT_BASELINE = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
]

function host({ dir }: PackageSpec): UserConfig {
  return {
    entry: { index: `${dir}/src/index.ts` },
    format: 'esm',
    platform: 'node',
    sourcemap: true,
    dts: false,
    clean: false,
    outDir: `${dir}/dist`,
    deps: { neverBundle: [/^node:/, /^@deepseek-ai\//] },
    outputOptions: { entryFileNames: 'index.js' },
  }
}

function client({ dir, name }: PackageSpec): UserConfig {
  return {
    entry: { client: `${dir}/src/client.tsx` },
    format: 'cjs',
    inputOptions: { platform: 'browser' },
    sourcemap: true,
    dts: false,
    clean: false,
    outDir: `${dir}/dist`,
    deps: { neverBundle: CLIENT_BASELINE },
    outputOptions: {
      entryFileNames: 'client.js',
      banner:
        'window.__ModuleLoader__.load({id:`' +
        name +
        '`,factory:require=>{var module={exports:{}};var exports=module.exports;',
      footer: 'return module.exports}});',
    },
  }
}

export default defineConfig(
  ((): PackageSpec[] => {
    // TSDOWN_ONLY=dir[,dir] narrows a build while porting one package.
    const only = (process.env['TSDOWN_ONLY'] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
    return only.length === 0 ? PACKAGES : PACKAGES.filter((spec) => only.includes(spec.dir))
  })().flatMap((spec) => [host(spec), client(spec)]),
)
