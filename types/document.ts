/**
 * Document — represents a markdown file scribepad operates on.
 */

export interface DocumentFile {
  /** absolute filesystem path */
  path: string
  /** raw markdown content */
  content: string
}
