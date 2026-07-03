/**
 * adapters/store-sidecar — the standalone ReviewStore, backed by the sidecar JSON
 * under XDG state home.
 *
 * The ReviewStore port keys documents by an opaque `docId`; for the standalone fs
 * backend the docId is the document's absolute path. The sidecar location also
 * needs `repoRoot` (and, for tests, an `env` override), which the port does not
 * carry — so those are injected once via `createSidecarStore` and closed over,
 * keeping the port's `load(docId)` / `save(docId, state)` shape intact.
 *
 * This is a fresh IO adapter, not a wrapper over services/annotations.ts: the
 * old service stays untouched during the Strangler migration (P3a).
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Sidecar } from '../../types/annotation.js'
import type { ReviewState, ReviewStore, StoreError } from '../../types/ports.js'
import type { Result } from '../../types/result.js'
import { err, ok } from '../../core/result.js'
import { docRelativePath, documentStatePath, legacySidecarPath } from '../paths.js'

export interface SidecarStoreOptions {
  repoRoot: string
  env?: NodeJS.ProcessEnv
}

/**
 * Build a ReviewStore over the sidecar JSON. `repoRoot` and `env` are captured
 * here; every `load` / `save` uses the passed `docId` as the document path.
 */
export function createSidecarStore(opts: SidecarStoreOptions): ReviewStore {
  const { repoRoot } = opts
  const env = opts.env ?? process.env

  function sidecarPath(docPath: string): string {
    return documentStatePath(repoRoot, docPath, env)
  }

  function withDocumentMeta(data: Sidecar, docPath: string): Sidecar {
    return {
      ...data,
      version: 4,
      docPath,
      docRelativePath: docRelativePath(repoRoot, docPath),
      annotations: data.annotations ?? [],
    }
  }

  async function writeSidecar(docPath: string, data: Sidecar): Promise<void> {
    const p = sidecarPath(docPath)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, JSON.stringify(withDocumentMeta(data, docPath), null, 2), 'utf8')
  }

  // Reads the sidecar, migrating a legacy in-repo sidecar to the XDG path on
  // first touch. A missing file yields an empty (but metadata-stamped) sidecar.
  async function readSidecar(docPath: string): Promise<Sidecar> {
    const p = sidecarPath(docPath)
    if (!existsSync(p)) {
      const legacy = legacySidecarPath(docPath)
      if (existsSync(legacy)) {
        const raw = await readFile(legacy, 'utf8')
        const migrated = withDocumentMeta(JSON.parse(raw) as Sidecar, docPath)
        await writeSidecar(docPath, migrated)
        return migrated
      }
      return withDocumentMeta({ version: 4, annotations: [] }, docPath)
    }
    const raw = await readFile(p, 'utf8')
    return withDocumentMeta(JSON.parse(raw) as Sidecar, docPath)
  }

  return {
    async load(docId: string): Promise<Result<ReviewState, StoreError>> {
      try {
        const data = await readSidecar(docId)
        return ok({
          annotations: data.annotations ?? [],
          planState: data.planState ?? [],
          confirmStates: data.confirmStates ?? [],
        })
      } catch (e) {
        // A malformed JSON body is a corruption; anything else is a read fault.
        const kind = e instanceof SyntaxError ? 'corrupt' : 'read'
        return err({ kind, message: e instanceof Error ? e.message : String(e) })
      }
    },

    async save(docId: string, state: ReviewState): Promise<Result<void, StoreError>> {
      try {
        // Spread `existing` first so unknown / future sidecar fields survive; the
        // three user-state fields are then written together and never clobber
        // each other (round-trip preservation invariant).
        const existing = await readSidecar(docId)
        const data: Sidecar = withDocumentMeta(
          {
            ...existing,
            version: 4,
            annotations: state.annotations,
            planState: state.planState,
            confirmStates: state.confirmStates,
          },
          docId,
        )
        await writeSidecar(docId, data)
        return ok(undefined)
      } catch (e) {
        return err({ kind: 'write', message: e instanceof Error ? e.message : String(e) })
      }
    },
  }
}
