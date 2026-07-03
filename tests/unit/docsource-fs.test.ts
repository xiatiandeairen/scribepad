import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFsDocSource } from '../../server/adapters/docsource-fs.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('docsource-fs', () => {
  let tmpDir: string
  const source = createFsDocSource()

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'docsource-test-'))
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('writes and reads document with matching content', async () => {
    const docId = join(tmpDir, 'test.md')
    const content = '# Test\n\nThis is a test document.'

    // Write (fs DocSource always provides write; the port marks it optional)
    if (!source.write) throw new Error('fs DocSource must support write')
    const writeResult = await source.write(docId, content)
    expect(writeResult.ok).toBe(true)

    // Read
    const readResult = await source.read(docId)
    expect(readResult.ok).toBe(true)
    if (readResult.ok) {
      expect(readResult.value.docId).toBe(docId)
      expect(readResult.value.content).toBe(content)
    }
  })

  it('returns not-found error for missing document', async () => {
    const docId = join(tmpDir, 'nonexistent.md')
    const result = await source.read(docId)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('not-found')
      expect(result.error.message).toContain('not found')
    }
  })
})
