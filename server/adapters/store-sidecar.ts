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
 * The adapter owns the single persisted ReviewState shape.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Sidecar } from '../../types/annotation.js'
import type { ReviewState, ReviewStore, StoreError } from '../../types/ports.js'
import type { Result } from '../../types/result.js'
import { err, ok } from '../../core/result.js'
import { docRelativePath, documentStatePath } from '../paths.js'

export interface SidecarStoreOptions {
  repoRoot: string
  env?: NodeJS.ProcessEnv
}

interface SidecarIo {
  readSidecar(docPath: string): Promise<Sidecar>
  writeSidecar(docPath: string, data: Sidecar): Promise<void>
}

/**
 * Shared state-file IO: XDG-path resolution and metadata stamping.
 */
function createSidecarIo(opts: SidecarStoreOptions): SidecarIo {
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

  // A missing state file yields an empty, metadata-stamped record.
  async function readSidecar(docPath: string): Promise<Sidecar> {
    const p = sidecarPath(docPath)
    try {
      const raw = await readFile(p, 'utf8')
      return withDocumentMeta(JSON.parse(raw) as Sidecar, docPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return withDocumentMeta({ version: 4, annotations: [] }, docPath)
    }
  }

  return { readSidecar, writeSidecar }
}

/**
 * Build a ReviewStore over the sidecar JSON. `repoRoot` and `env` are captured
 * here; every `load` / `save` uses the passed `docId` as the document path.
 */
export function createSidecarStore(opts: SidecarStoreOptions): ReviewStore {
  const { readSidecar, writeSidecar } = createSidecarIo(opts)

  return {
    async load(docId: string): Promise<Result<ReviewState, StoreError>> {
      try {
        const data = await readSidecar(docId)
        return ok({
          annotations: data.annotations ?? [],
          signoffs: data.signoffs ?? [],
        })
      } catch (e) {
        // A malformed JSON body is a corruption; anything else is a read fault.
        const kind = e instanceof SyntaxError ? 'corrupt' : 'read'
        return err({ kind, message: e instanceof Error ? e.message : String(e) })
      }
    },

    async save(docId: string, state: ReviewState): Promise<Result<void, StoreError>> {
      try {
        const data: Sidecar = {
          version: 4,
          annotations: state.annotations,
          signoffs: state.signoffs,
        }
        await writeSidecar(docId, data)
        return ok(undefined)
      } catch (e) {
        return err({ kind: 'write', message: e instanceof Error ? e.message : String(e) })
      }
    },
  }
}
