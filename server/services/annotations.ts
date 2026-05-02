/**
 * services/annotations — sidecar JSON CRUD.
 *
 * Foundation skeleton: reads/writes `.{filename}.annotations.json` next to the doc.
 * v0.2 will add: state machine validation, audit trail append, defended writes.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import type { Annotation, Sidecar } from '../../types/annotation.js'

export function sidecarPath(docPath: string): string {
  return join(dirname(docPath), '.' + basename(docPath) + '.annotations.json')
}

export async function readAnnotations(docPath: string): Promise<Annotation[]> {
  const p = sidecarPath(docPath)
  if (!existsSync(p)) return []
  const raw = await readFile(p, 'utf8')
  const data = JSON.parse(raw) as Sidecar
  return data.annotations ?? []
}

export async function writeAnnotations(docPath: string, annotations: Annotation[]): Promise<void> {
  const data: Sidecar = { version: 2, annotations }
  await writeFile(sidecarPath(docPath), JSON.stringify(data, null, 2), 'utf8')
}
