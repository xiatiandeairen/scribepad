import type { CSSProperties } from 'react'
import type { PlanItem, PlanItemKind, PlanItemStatus, PlanReadinessSummary } from '../../types/plan'

interface PlanPanelProps {
  items: PlanItem[]
  summary: PlanReadinessSummary
  activeItemId?: string | undefined
  onSelectItem: (id: string) => void
  onToggleLocked: (item: PlanItem) => void
}

const EXECUTIVE_SECTIONS: Array<{ kind: PlanItemKind; title: string }> = [
  { kind: 'goal', title: 'Goal' },
  { kind: 'scope', title: 'Scope' },
  { kind: 'behavior', title: 'Behavior' },
  { kind: 'decision', title: 'Decisions' },
  { kind: 'risk', title: 'Risks' },
  { kind: 'task', title: 'Tasks' },
  { kind: 'verification', title: 'Verification' },
]

export function PlanPanel(props: PlanPanelProps): JSX.Element {
  const { items, summary, activeItemId } = props
  const visibleItems = summary.mode === 'annotation-only' ? [] : items
  const executiveItems = EXECUTIVE_SECTIONS.flatMap((section) =>
    visibleItems.filter((item) => item.kind === section.kind),
  )
  const executiveTotal = executiveItems.length
  const executiveLocked = executiveItems.filter((item) => item.status === 'locked').length
  const executiveOpen = executiveItems.filter((item) => item.status === 'open').length
  const executiveStale = executiveItems.filter((item) => item.status === 'stale').length
  const executiveProgress =
    executiveTotal === 0 ? 0 : Math.round((executiveLocked / executiveTotal) * 100)
  const executiveStatus =
    executiveStale > 0
      ? 'Review changed items'
      : executiveOpen > 0
        ? `Needs ${executiveOpen} locks`
        : 'Ready for handoff'

  return (
    <section className="plan-panel plan-panel-executive" aria-label="Plan review">
      <div className={`executive-readiness ${executiveStale > 0 ? 'stale' : ''}`}>
        <div>
          <span>Handoff Readiness</span>
          <strong>{executiveStatus}</strong>
          <p>
            {executiveLocked} / {executiveTotal} focused points locked
          </p>
        </div>
        <div
          className="plan-score"
          style={{ '--score': `${executiveProgress * 3.6}deg` } as CSSProperties}
        >
          {executiveProgress}%
        </div>
      </div>

      <div className="executive-outline">
        <div className="executive-outline-head">
          <h2>Feature Review Outline</h2>
          <span>{executiveTotal === 0 ? 'No focused points' : `${executiveOpen} open`}</span>
        </div>

        {EXECUTIVE_SECTIONS.map((section) => {
          const sectionItems = visibleItems.filter((item) => item.kind === section.kind)
          const firstActionable =
            sectionItems.find((item) => item.status === 'stale') ??
            sectionItems.find((item) => item.status === 'open') ??
            sectionItems[0]
          const lockedCount = sectionItems.filter((item) => item.status === 'locked').length

          return (
            <section key={section.kind} className="executive-section">
              <button
                type="button"
                className="executive-section-title"
                disabled={!firstActionable}
                onClick={() => firstActionable && props.onSelectItem(firstActionable.id)}
              >
                <span>{section.title}</span>
                <strong>
                  {sectionItems.length === 0
                    ? 'missing'
                    : `${lockedCount}/${sectionItems.length} locked`}
                </strong>
              </button>
              {sectionItems.length > 0 ? (
                <div className="executive-points">
                  {sectionItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`executive-point ${item.status} ${activeItemId === item.id ? 'active' : ''}`}
                      onClick={() => {
                        props.onSelectItem(item.id)
                        props.onToggleLocked(item)
                      }}
                    >
                      <span className="executive-point-mark">{statusMark(item.status)}</span>
                      <span className="executive-point-text">{item.text}</span>
                      <span className="executive-point-status">{statusLabel(item.status)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="executive-missing">- 未识别到相关内容</div>
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
}

function statusLabel(status: PlanItemStatus): string {
  switch (status) {
    case 'open':
      return '默认'
    case 'locked':
      return '已锁定'
    case 'stale':
      return '需复核'
  }
}

function statusMark(status: PlanItemStatus): string {
  switch (status) {
    case 'open':
      return '□'
    case 'locked':
      return '■'
    case 'stale':
      return '!'
  }
}
