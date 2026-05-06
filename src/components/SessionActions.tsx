import type { SessionResponse } from '../../types/api'

interface SessionActionsProps {
  session: SessionResponse | null
  closing: boolean
  onDone: () => void
}

export function SessionActions({ session, closing, onDone }: SessionActionsProps): JSX.Element {
  if (!session) return <div className="session-actions" aria-hidden="true" />

  return (
    <div className="session-actions">
      <button type="button" className="primary" onClick={onDone} disabled={closing}>
        {closing ? 'Closing...' : 'Done'}
      </button>
    </div>
  )
}
