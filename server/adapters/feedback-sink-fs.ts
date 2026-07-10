/**
 * adapters/feedback-sink-fs — filesystem-backed FeedbackSink.
 *
 * Appends each report as one JSON line to `$XDG_STATE_HOME/scribepad/feedback/
 * inbox.jsonl` and, when given a non-empty attachment, writes a same-id bundle
 * under `attachments/<id>/`. Reuses the same XDG state root the ReviewStore /
 * ExportSink adapters use (server/paths.ts), but feedback is repo-independent
 * (a triager reads across repos), so unlike those adapters this one does not
 * key its path off `repoId`. Never throws — all errors return Err.
 */
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { FeedbackAttachment, FeedbackEntry, FeedbackSink } from '../../types/ports.js'
import { ok, err } from '../../core/result.js'
import { xdgStateHome } from '../paths.js'

export interface FeedbackSinkFsOptions {
  env?: NodeJS.ProcessEnv
  now?: () => Date
}

export function createFsFeedbackSink(options: FeedbackSinkFsOptions = {}): FeedbackSink {
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date())
  const feedbackDir = join(xdgStateHome(env), 'scribepad', 'feedback')

  return {
    async submit(entry, attachment) {
      const id = makeFeedbackId(now())
      const attachmentsDir = hasAnyField(attachment)
        ? join(feedbackDir, 'attachments', id)
        : undefined

      const fullEntry: FeedbackEntry = {
        ...entry,
        id,
        ts: now().toISOString(),
        ...(attachmentsDir ? { attachmentsDir } : {}),
      }

      try {
        await mkdir(feedbackDir, { recursive: true })
        // Write attachments first and the inbox line last: the inbox line is
        // the durable "this report exists" signal, so it must never land
        // while its attachments bundle is only partially written.
        if (attachmentsDir) {
          await writeAttachments(attachmentsDir, attachment!)
        }
        await appendFile(join(feedbackDir, 'inbox.jsonl'), JSON.stringify(fullEntry) + '\n', 'utf8')
        return ok({ id })
      } catch (e) {
        const error = e as NodeJS.ErrnoException
        return err({ kind: 'write', message: `Failed to write feedback: ${error.message}` })
      }
    },
  }
}

async function writeAttachments(dir: string, attachment: FeedbackAttachment): Promise<void> {
  await mkdir(dir, { recursive: true })
  const files: Array<[string, string | undefined]> = [
    ['doc.md', attachment.docSnapshot],
    ['review-state.json', attachment.reviewState],
    ['dom.html', attachment.domSnapshot],
  ]
  for (const [name, content] of files) {
    if (content === undefined) continue
    await writeFile(join(dir, name), content, 'utf8')
  }
}

function hasAnyField(attachment?: FeedbackAttachment): boolean {
  if (!attachment) return false
  return (
    attachment.docSnapshot !== undefined ||
    attachment.reviewState !== undefined ||
    attachment.domSnapshot !== undefined
  )
}

function makeFeedbackId(date: Date): string {
  const stamp = date
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14) // YYYYMMDDHHMMSS
  return `${stamp}-${randomBytes(3).toString('hex')}`
}
