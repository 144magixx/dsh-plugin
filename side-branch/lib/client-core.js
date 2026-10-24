/**
 * Node ESM test adapter for the exact shipped classic-script Client factory.
 * No React component is rendered or DOM emulated. Keeping the tested helpers
 * inside client.js avoids a second, drifting browser implementation or build step.
 */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

let registration
const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
runInNewContext(source, {
  window: { __ModuleLoader__: { load(value) { registration = value } } },
  URL, URLSearchParams, AbortController, console,
}, { filename: 'dsh-side-branch/client.js', timeout: 1000 })
if (registration?.id !== 'dsh-side-branch') throw new Error('Unexpected Client module registration')
export const client = registration.factory((id) => {
  if (id !== 'react') throw new Error(`Unexpected browser import: ${id}`)
  return Object.freeze({})
})
export const {
  branchAddress, parseBranchAddress, retryBranchAddress, nativeCapabilities, requiresNewRequest, createApi, nativeTurnState, eligible, preview,
  createRuntime, branchResourceProvider, ZH, EN, CSS, STORAGE_KEY,
} = client
