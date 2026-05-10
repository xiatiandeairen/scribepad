import type { CSSProperties } from 'react'
import type {
  PlanItem,
  PlanItemKind,
  PlanItemStatus,
  PlanReadinessSummary,
  ReviewMode,
} from '../../types/plan'

interface PlanPanelProps {
  items: PlanItem[]
  summary: PlanReadinessSummary
  preferredMode: ReviewMode
  variant: ReviewPanelVariant
  activeItemId?: string | undefined
  onModeChange: (mode: ReviewMode) => void
  onSelectItem: (id: string) => void
  onToggleLocked: (item: PlanItem) => void
}

export type ReviewPanelVariant =
  | 'executive'
  | 'spreadsheet'
  | 'kanban'
  | 'timeline'
  | 'command'
  | 'minimal'
  | 'inspector'
  | 'contrast'

const KIND_ORDER: PlanItemKind[] = [
  'open-question',
  'risk',
  'verification',
  'task',
  'scope',
  'behavior',
  'goal',
  'decision',
]

const KIND_LABELS: Record<PlanItemKind, string> = {
  goal: '目标',
  scope: '范围',
  behavior: '行为',
  task: '任务',
  verification: '验证',
  risk: '风险',
  decision: '决策',
  'open-question': '待确认',
}

const MODE_LABELS: Record<ReviewMode, string> = {
  auto: 'Auto',
  structured: 'Full plan',
  lightweight: 'Light review',
  'annotation-only': 'Annotation only',
}

const VARIANT_LABELS: Record<ReviewPanelVariant, string> = {
  executive: 'Executive',
  spreadsheet: 'Spreadsheet',
  kanban: 'Kanban',
  timeline: 'Timeline',
  command: 'Command',
  minimal: 'Minimal',
  inspector: 'Inspector',
  contrast: 'Contrast',
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
  const { items, summary, activeItemId, variant } = props
  const progress = summary.total === 0 ? 0 : Math.round((summary.resolved / summary.total) * 100)
  const visibleItems = summary.mode === 'annotation-only' ? [] : items
  const activeItem = activeItemId ? items.find((item) => item.id === activeItemId) : undefined
  const open = visibleItems.filter((item) => item.status === 'open').length
  const stale = visibleItems.filter((item) => item.status === 'stale').length
  const locked = visibleItems.filter((item) => item.status === 'locked').length
  const timelineItems = [...visibleItems].sort((a, b) => a.srcStart - b.srcStart)
  const nextTimelineItem =
    timelineItems.find((item) => item.status === 'stale') ??
    timelineItems.find((item) => item.status === 'open')
  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    items: visibleItems.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0)

  if (variant === 'executive') {
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

  return (
    <section className={`plan-panel plan-panel-${variant}`} aria-label="Plan review">
      <div className="plan-panel-head">
        <div>
          <h2>{VARIANT_LABELS[variant]}</h2>
          <span>
            {summary.mode === 'annotation-only'
              ? '批注模式'
              : `${summary.resolved} / ${summary.total} points ready`}
          </span>
        </div>
        <div className="plan-score" style={{ '--score': `${progress * 3.6}deg` } as CSSProperties}>
          {progress}%
        </div>
      </div>

      <div className="plan-metrics" aria-label="review summary">
        <div>
          <span>Readiness</span>
          <strong>{progress}%</strong>
        </div>
        <div>
          <span>Info Points</span>
          <strong>
            {summary.resolved} / {summary.total}
          </strong>
        </div>
        <div>
          <span>Default</span>
          <strong>{open}</strong>
        </div>
        <div>
          <span>Changed</span>
          <strong>{stale}</strong>
        </div>
        <div>
          <span>Locked</span>
          <strong>{locked}</strong>
        </div>
      </div>

      <div className="plan-mode-row">
        <span className={`plan-mode-badge ${summary.mode}`}>{MODE_LABELS[summary.mode]}</span>
        <select
          aria-label="review mode"
          value={props.preferredMode}
          onChange={(event) => props.onModeChange(event.currentTarget.value as ReviewMode)}
        >
          {Object.entries(MODE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {summary.mode !== 'annotation-only' && (
        <div className="plan-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}

      {activeItem && summary.mode !== 'annotation-only' && (
        <div className={`plan-detail ${activeItem.status}`}>
          <div className="plan-detail-kicker">
            {KIND_LABELS[activeItem.kind]} · {statusLabel(activeItem.status)}
          </div>
          <p>{activeItem.text}</p>
        </div>
      )}

      {variant === 'timeline' && visibleItems.length > 0 && (
        <div className="timeline-review" aria-label="timeline review path">
          <div className="timeline-next">
            <span>{nextTimelineItem ? 'Next' : 'Complete'}</span>
            <strong>{nextTimelineItem ? nextTimelineItem.text : '全部信息点已锁定'}</strong>
          </div>
          <div className="timeline-list">
            {timelineItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`timeline-step ${item.status} ${activeItemId === item.id ? 'active' : ''}`}
                onClick={() => {
                  props.onSelectItem(item.id)
                  props.onToggleLocked(item)
                }}
              >
                <span className="timeline-node">{String(index + 1).padStart(2, '0')}</span>
                <span className="timeline-main">
                  <span className="timeline-meta">
                    <span>{KIND_LABELS[item.kind]}</span>
                    <span>{statusLabel(item.status)}</span>
                  </span>
                  <strong>{item.text}</strong>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {variant !== 'timeline' && visibleItems.length > 0 && (
        <div className="plan-groups">
          {grouped.map(({ kind, items: group }) => {
            const unresolved = group.filter(
              (item) => item.status === 'open' || item.status === 'stale',
            ).length
            return (
              <section key={kind} className="plan-group">
                <h3>
                  {KIND_LABELS[kind]}
                  <span>{groupSummary(kind, group)}</span>
                </h3>
                <div className="plan-group-items">
                  {group
                    .slice(0, variant === 'spreadsheet' || variant === 'minimal' ? 8 : 4)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`plan-item-row ${item.status} ${activeItemId === item.id ? 'active' : ''}`}
                        onClick={() => {
                          props.onSelectItem(item.id)
                          props.onToggleLocked(item)
                        }}
                      >
                        <span className="plan-row-section">{KIND_LABELS[kind]}</span>
                        <span className="plan-row-text">{item.text}</span>
                        <span className={`plan-row-status ${item.status}`}>
                          {statusLabel(item.status)}
                        </span>
                      </button>
                    ))}
                  {group.length > (variant === 'spreadsheet' || variant === 'minimal' ? 8 : 4) && (
                    <button
                      type="button"
                      className="plan-group-open"
                      onClick={() => props.onSelectItem(group[0]!.id)}
                    >
                      <span>{groupDetail(kind, group)}</span>
                      {unresolved > 0 && <i aria-hidden="true" />}
                    </button>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <div className="plan-panel-actions">
        <button type="button">Filters</button>
        <button type="button" aria-label="review settings">
          ☷
        </button>
      </div>
    </section>
  )
}

function groupSummary(kind: PlanItemKind, group: PlanItem[]): string {
  const resolved = group.filter((item) => item.status === 'locked').length
  if (kind === 'risk' || kind === 'open-question') {
    const open = group.length - resolved
    return open === 1 ? '1 open' : `${open} open`
  }
  return `${resolved} / ${group.length} locked`
}

function groupDetail(kind: PlanItemKind, group: PlanItem[]): string {
  const firstOpen = group.find((item) => item.status === 'open' || item.status === 'stale')
  if (firstOpen) return firstOpen.text
  if (kind === 'task') return `${group.length} tasks tracked`
  return `${group.length} points tracked`
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
