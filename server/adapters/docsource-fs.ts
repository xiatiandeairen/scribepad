/**
 * adapters/docsource-fs — filesystem-backed DocSource.
 *
 * Adapts fs.readFile / fs.writeFile to the DocSource interface. docId is the
 * absolute file path. Never throws — all errors return Err.
 */
import { readFile, writeFile } from 'node:fs/promises'
import type { DocContent, DocError, DocSource } from '../../types/ports.js'
import type { Result } from '../../types/result.js'
import { ok, err } from '../../core/result.js'

export function createFsDocSource(): DocSource {
  return {
    read,
    write,
  }
}

async function read(docId: string): Promise<Result<DocContent, DocError>> {
  try {
    const content = await readFile(docId, 'utf8')
    return ok({ docId, content })
  } catch (e) {
    const error = e as NodeJS.ErrnoException
    if (error.code === 'ENOENT') {
      return err({
        kind: 'not-found',
        message: `Document not found: ${docId}`,
      })
    }
    return err({
      kind: 'read',
      message: `Failed to read document: ${error.message}`,
    })
  }
}

async function write(docId: string, content: string): Promise<Result<void, DocError>> {
  try {
    await writeFile(docId, content, 'utf8')
    return ok(undefined)
  } catch (e) {
    const error = e as NodeJS.ErrnoException
    return err({
      kind: 'write',
      message: `Failed to write document: ${error.message}`,
    })
  }
}
