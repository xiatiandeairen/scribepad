import { useState, type CSSProperties } from 'react'
import type {
  PlanItem,
  PlanItemStatus,
  PlanReadinessSummary,
  PlanReviewSection,
} from '../../types/plan'

interface PlanPanelProps {
  sections: PlanReviewSection[]
  summary: PlanReadinessSummary
  activeItemId?: string | undefined
  normalizing?: boolean
  onSelectItem: (id: string) => void
  onToggleLocked: (item: PlanItem) => void
  onNormalize: () => void
}

export function PlanPanel(props: PlanPanelProps): JSX.Element {
  const { sections, summary, activeItemId } = props
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const reviewTotal = summary.total
  const reviewLocked = summary.locked
  const reviewOpen = summary.total - summary.locked
  const reviewStale = sections.reduce((count, section) => count + section.stale, 0)
  const reviewProgress = reviewTotal === 0 ? 0 : Math.round((reviewLocked / reviewTotal) * 100)
  const reviewStatus =
    reviewStale > 0
      ? 'Review changed items'
      : reviewOpen > 0
        ? `Needs ${reviewOpen} locks`
        : 'Ready for handoff'

  if (summary.mode === 'annotation-only') {
    return (
      <section className="plan-panel plan-panel-review" aria-label="Plan review">
        <div className="review-normalize-empty">
          <span>Review structure needed</span>
          <strong>未识别到 Review 目录结构</strong>
          <p>将当前 plan 按目标、范围、方案、验收、待确认重新整理后再开始 Review。</p>
          <button type="button" onClick={props.onNormalize} disabled={props.normalizing}>
            {props.normalizing ? '规范化中...' : '规范化文档'}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="plan-panel plan-panel-review" aria-label="Plan review">
      <div className={`review-readiness ${reviewStale > 0 ? 'stale' : ''}`}>
        <div>
          <span>Handoff Readiness</span>
          <strong>{reviewStatus}</strong>
          <p>
            {reviewLocked} / {reviewTotal} focused points locked
          </p>
        </div>
        <div
          className="plan-score"
          style={{ '--score': `${reviewProgress * 3.6}deg` } as CSSProperties}
        >
          {reviewProgress}%
        </div>
      </div>

      {summary.structureQuality === 'partial' && (
        <div className="review-structure-banner">
          <div>
            <strong>结构不完整</strong>
            <span>{missingSectionText(summary.missingRequiredSections)}未识别到可 review 内容</span>
          </div>
          <button type="button" onClick={props.onNormalize} disabled={props.normalizing}>
            {props.normalizing ? '规范化中...' : '规范化文档'}
          </button>
        </div>
      )}

      <div className="review-outline">
        <div className="review-outline-head">
          <h2>Review Outline</h2>
          <span>{reviewTotal === 0 ? 'No focused points' : `${reviewOpen} open`}</span>
        </div>

        {sections.map((section) => {
          const firstActionable =
            section.items.find((item) => item.status === 'stale') ??
            section.groups
              .flatMap((group) => [...(group.checkpoint ? [group.checkpoint] : []), ...group.items])
              .find((item) => item.status === 'stale') ??
            section.items.find((item) => item.status === 'open') ??
            section.groups
              .flatMap((group) => [...(group.checkpoint ? [group.checkpoint] : []), ...group.items])
              .find((item) => item.status === 'open') ??
            section.items[0] ??
            section.groups[0]?.checkpoint ??
            section.groups[0]?.items[0]

          return (
            <section key={section.kind} className="review-section">
              <button
                type="button"
                className="review-section-title"
                disabled={!firstActionable}
                onClick={() => firstActionable && props.onSelectItem(firstActionable.id)}
              >
                <span>{section.title}</span>
                <strong>{`${section.locked}/${section.total} locked`}</strong>
              </button>
              <div className="review-section-body">
                {section.items.length > 0 && (
                  <div className="review-points">
                    {section.items.map((item) =>
                      renderPoint({ item, activeItemId, props, expandedIds, setExpandedIds }),
                    )}
                  </div>
                )}
                {section.details.length > 0 && <DetailList details={section.details} />}
                {section.groups.map((group) => (
                  <div key={group.id} className="review-group">
                    {group.checkpoint ? (
                      <>
                        {renderPoint({
                          item: group.checkpoint,
                          activeItemId,
                          props,
                          expandedIds,
                          setExpandedIds,
                          details: group.details,
                        })}
                      </>
                    ) : (
                      <div className="review-group-title">{group.title}</div>
                    )}
                    {group.items.length > 0 && (
                      <div className="review-points">
                        {group.items.map((item) =>
                          renderPoint({ item, activeItemId, props, expandedIds, setExpandedIds }),
                        )}
                      </div>
                    )}
                    {group.checkpoint &&
                      expandedIds.has(group.checkpoint.id) &&
                      group.details.length > 0 && <DetailList details={group.details} />}
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}

function DetailList(props: { details: PlanItem[] }): JSX.Element {
  return (
    <ul className="review-details">
      {props.details.map((detail) => (
        <li
          key={detail.id}
          className="review-detail"
          style={{ '--point-indent': `${(detail.depth ?? 0) * 14}px` } as CSSProperties}
        >
          {detail.text}
        </li>
      ))}
    </ul>
  )
}

interface RenderPointArgs {
  item: PlanItem
  activeItemId: string | undefined
  props: PlanPanelProps
  expandedIds: ReadonlySet<string>
  setExpandedIds: (updater: (prev: Set<string>) => Set<string>) => void
  details?: PlanItem[]
}

function renderPoint(args: RenderPointArgs): JSX.Element {
  const { item, activeItemId, props, expandedIds, setExpandedIds, details = [] } = args
  const hasDetails = details.length > 0
  const expanded = expandedIds.has(item.id)
  return (
    <div
      key={item.id}
      className={`review-point ${item.status} ${activeItemId === item.id ? 'active' : ''}`}
      style={{ '--point-indent': `${(item.depth ?? 0) * 14}px` } as CSSProperties}
    >
      <button
        type="button"
        className="review-point-check"
        aria-label={`${statusLabel(item.status)}: ${item.text}`}
        onClick={() => {
          props.onSelectItem(item.id)
          props.onToggleLocked(item)
        }}
      />
      <button
        type="button"
        className="review-point-main"
        aria-expanded={hasDetails ? expanded : undefined}
        onClick={() => {
          props.onSelectItem(item.id)
          if (!hasDetails) return
          setExpandedIds((prev) => {
            const next = new Set(prev)
            if (next.has(item.id)) next.delete(item.id)
            else next.add(item.id)
            return next
          })
        }}
      >
        <span className="review-point-text">{item.text}</span>
        {hasDetails && <span className={`review-point-caret ${expanded ? 'open' : ''}`} />}
      </button>
      <span className="review-point-status">{statusLabel(item.status)}</span>
    </div>
  )
}

function missingSectionText(kinds: readonly string[]): string {
  if (kinds.length === 0) return '部分必需章节'
  const labels: Record<string, string> = {
    goal: '目标',
    scope: '范围',
    behavior: '方案',
    verification: '验收',
  }
  return kinds.map((kind) => labels[kind] ?? kind).join('、')
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
