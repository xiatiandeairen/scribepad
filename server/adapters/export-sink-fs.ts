/**
 * adapters/export-sink-fs — filesystem-backed ExportSink.
 *
 * Writes the export artifact to `outputPath`, creating parent directories first.
 * This is the behaviour session-manager.done() used to inline (mkdir -p +
 * writeFile); moving it behind the port keeps SessionManager free of direct
 * node:fs access so every export routes through an injected adapter. docId-style
 * path semantics are the caller's (exportPathFor); this adapter only persists.
 * Never throws — all errors return Err.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ExportError, ExportSink } from '../../types/ports.js'
import type { Result } from '../../types/result.js'
import { ok, err } from '../../core/result.js'

export function createFsExportSink(): ExportSink {
  return { export: writeExport }
}

async function writeExport(
  outputPath: string,
  content: string,
): Promise<Result<void, ExportError>> {
  try {
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, content, 'utf8')
    return ok(undefined)
  } catch (e) {
    const error = e as NodeJS.ErrnoException
    return err({
      kind: 'write',
      message: `Failed to write export: ${error.message}`,
    })
  }
}
