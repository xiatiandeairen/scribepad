/**
 * Characterization tests for server/services/document.ts.
 *
 * Locks the current fs round-trip behaviour of readDocument / saveDocument
 * as a regression net for upcoming refactors.
 *
 * Tests use temporary directories so they never touch project files.
 */
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { readDocument, saveDocument } from '../../server/services/document.js'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'scribepad-doc-char-'))
}

// ---------------------------------------------------------------------------
// readDocument
// ---------------------------------------------------------------------------

describe('readDocument', () => {
  it('returns the file content and path for an existing file', async () => {
    const dir = await tempDir()
    const filePath = join(dir, 'notes.md')
    await saveDocument(filePath, '# Notes\n\nHello world.\n')

    const result = await readDocument(filePath)
    expect(result.path).toBe(filePath)
    expect(result.content).toBe('# Notes\n\nHello world.\n')
  })

  it('rejects with an error when the file does not exist', async () => {
    const dir = await tempDir()
    const missing = join(dir, 'nonexistent.md')

    await expect(readDocument(missing)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// saveDocument
// ---------------------------------------------------------------------------

describe('saveDocument', () => {
  it('creates the file with the given content', async () => {
    const dir = await tempDir()
    const filePath = join(dir, 'new.md')

    await saveDocument(filePath, '# New\n')

    const result = await readDocument(filePath)
    expect(result.content).toBe('# New\n')
  })

  it('overwrites existing content on subsequent save', async () => {
    const dir = await tempDir()
    const filePath = join(dir, 'overwrite.md')

    await saveDocument(filePath, 'first version\n')
    await saveDocument(filePath, 'second version\n')

    const result = await readDocument(filePath)
    expect(result.content).toBe('second version\n')
  })
})

// ---------------------------------------------------------------------------
// round-trip
// ---------------------------------------------------------------------------

describe('saveDocument / readDocument round-trip', () => {
  it('preserves multiline markdown content exactly', async () => {
    const dir = await tempDir()
    const filePath = join(dir, 'doc.md')
    const content = [
      '# Title',
      '',
      '## Section 1',
      '',
      'Paragraph with **bold** and _italic_.',
      '',
      '- item one',
      '- item two',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
    ].join('\n')

    await saveDocument(filePath, content)
    const result = await readDocument(filePath)
    expect(result.content).toBe(content)
  })

  it('preserves content with unicode characters', async () => {
    const dir = await tempDir()
    const filePath = join(dir, 'unicode.md')
    const content = '# 中文标题\n\n测试内容 🚀\n'

    await saveDocument(filePath, content)
    const result = await readDocument(filePath)
    expect(result.content).toBe(content)
  })

  it('preserves empty string content', async () => {
    const dir = await tempDir()
    const filePath = join(dir, 'empty.md')

    await saveDocument(filePath, '')
    const result = await readDocument(filePath)
    expect(result.content).toBe('')
  })

  it('result path matches the path passed to saveDocument', async () => {
    const dir = await tempDir()
    const filePath = join(dir, 'check-path.md')

    await saveDocument(filePath, 'content\n')
    const result = await readDocument(filePath)
    expect(result.path).toBe(filePath)
  })
})
