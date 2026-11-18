// Remove every package's build output before a full rebuild. The generated
// bundles are committed, so this only ever deletes directories that tsdown
// recreates in the same run.
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packages = [
  'provider-visibility',
  'ollama-offpeak',
  'ollama-quota',
  'opencode-go-quota',
  'model-favorites',
]

for (const name of packages) {
  await rm(join(root, name, 'dist'), { recursive: true, force: true })
}
