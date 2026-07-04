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
import type { PlanItemState } from '../../types/plan.js'
import type { Result } from '../../types/result.js'
import { err, ok } from '../../core/result.js'
import { docRelativePath, documentStatePath, legacySidecarPath } from '../paths.js'

export interface SidecarStoreOptions {
  repoRoot: string
  env?: NodeJS.ProcessEnv
}

interface SidecarIo {
  readSidecar(docPath: string): Promise<Sidecar>
  writeSidecar(docPath: string, data: Sidecar): Promise<void>
}

/**
 * Shared sidecar file IO: XDG-path resolution, legacy migration, metadata
 * stamping. Both the ReviewStore and the legacy plan-state shim read/write
 * through this one accessor so their saves spread the same on-disk record and
 * never clobber each other's fields.
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
        // Spread `existing` first so fields this port does not own — the legacy
        // `planState` written by the shim, plus any unknown / retired field
        // (e.g. a stale `confirmStates`) — survive byte-for-byte; the known
        // user-state fields are then written together and never clobber each
        // other (round-trip preservation invariant, G5).
        const existing = await readSidecar(docId)
        const data: Sidecar = {
          ...existing,
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

/**
 * HACK(delete with old-path retirement, see plan-frontend-integration Q3):
 * legacy lock persistence kept behind an explicit shim so the retiring old
 * frontend's lock-after-refresh behavior (G4) is unchanged. `planState` was
 * dropped from the ReviewState port (it has no place in the new model), but the
 * old `/api/plan-state` route still needs to read/write it against the same
 * sidecar file until the old frontend is gone.
 */
export interface PlanStateShim {
  loadPlanState(docId: string): Promise<PlanItemState[]>
  savePlanState(docId: string, planState: PlanItemState[]): Promise<void>
}

/** Build the legacy plan-state accessor over the same sidecar file as the store. */
export function createPlanStateShim(opts: SidecarStoreOptions): PlanStateShim {
  const { readSidecar, writeSidecar } = createSidecarIo(opts)

  return {
    async loadPlanState(docId: string): Promise<PlanItemState[]> {
      const data = await readSidecar(docId)
      return data.planState ?? []
    },

    async savePlanState(docId: string, planState: PlanItemState[]): Promise<void> {
      // Spread existing so annotations / signoffs / unknown fields owned by the
      // ReviewStore survive this write untouched.
      const existing = await readSidecar(docId)
      await writeSidecar(docId, { ...existing, version: 4, planState })
    },
  }
}
