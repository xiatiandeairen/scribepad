/**
 * services/document — read/write markdown source.
 *
 * Foundation skeleton: real fs IO; pure functions, no domain logic.
 */
import { readFile, writeFile } from 'node:fs/promises'
import type { DocumentFile } from '../../types/document.js'

export async function readDocument(path: string): Promise<DocumentFile> {
  const content = await readFile(path, 'utf8')
  return { path, content }
}

export async function saveDocument(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8')
}
