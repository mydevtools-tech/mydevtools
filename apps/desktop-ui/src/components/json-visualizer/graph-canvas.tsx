'use client'

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  layoutGraph,
  NODE_STYLE,
  nodeSummary,
  type GraphLayout,
  type JsonGraph,
  type LaidOutNode,
} from '@/lib/json-visualizer'
import { downloadFile } from '@/lib/desktop/save-file'

const TYPE_COLORS: Record<string, string> = {
  string: '#10b981',
  number: '#0ea5e9',
  boolean: '#8b5cf6',
  null: 'hsl(var(--muted-foreground))',
}

const HIT_COLOR = '#f59e0b'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 4
const EXPORT_PADDING = 24

interface Transform {
  x: number
  y: number
  k: number
}

export interface GraphCanvasHandle {
  fitView: () => void
  zoomBy: (factor: number) => void
  centerOn: (nodeId: string) => void
  exportImage: (format: 'png' | 'svg', filename: string) => Promise<void>
}

interface GraphCanvasProps {
  graph: JsonGraph
  collapsedIds: ReadonlySet<string>
  onToggleCollapse: (id: string) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  searchHits: ReadonlySet<string>
  activeHitId: string | null
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  { graph, collapsedIds, onToggleCollapse, selectedId, onSelect, searchHits, activeHitId },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null)
  const contentRef = useRef<SVGGElement>(null)
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 })
  const transformRef = useRef(transform)
  transformRef.current = transform
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const panState = useRef<{ moved: boolean } | null>(null)

  const layout = useMemo(() => layoutGraph(graph, collapsedIds), [graph, collapsedIds])
  const layoutRef = useRef<GraphLayout>(layout)
  layoutRef.current = layout

  const fitView = useCallback(() => {
    const svg = svgRef.current
    const l = layoutRef.current
    if (!svg || l.width === 0) return
    const { clientWidth: cw, clientHeight: ch } = svg
    const pad = 32
    const k = Math.min((cw - pad * 2) / l.width, (ch - pad * 2) / l.height, 1.25)
    const safeK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k))
    setTransform({
      x: (cw - l.width * safeK) / 2,
      y: (ch - l.height * safeK) / 2,
      k: safeK,
    })
  }, [])

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setTransform((t) => {
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, t.k * factor))
      const scale = k / t.k
      return { k, x: cx - (cx - t.x) * scale, y: cy - (cy - t.y) * scale }
    })
  }, [])

  const zoomBy = useCallback(
    (factor: number) => {
      const svg = svgRef.current
      if (!svg) return
      zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, factor)
    },
    [zoomAt],
  )

  const centerOn = useCallback((nodeId: string) => {
    const svg = svgRef.current
    if (!svg) return
    const laid = layoutRef.current.nodes.find((n) => n.node.id === nodeId)
    if (!laid) return
    const k = Math.max(transformRef.current.k, 0.75)
    setTransform({
      x: svg.clientWidth / 2 - (laid.x + laid.width / 2) * k,
      y: svg.clientHeight / 2 - (laid.y + laid.height / 2) * k,
      k,
    })
  }, [])

  const exportImage = useCallback(async (format: 'png' | 'svg', filename: string) => {
    const svg = svgRef.current
    const content = contentRef.current
    const l = layoutRef.current
    if (!svg || !content) return
    const serialized = serializeGraphSvg(svg, content, l)
    if (format === 'svg') {
      downloadFile(new Blob([serialized], { type: 'image/svg+xml' }), `${filename}.svg`)
      return
    }
    const blob = await svgToPngBlob(serialized, l.width + EXPORT_PADDING * 2, l.height + EXPORT_PADDING * 2)
    if (blob) downloadFile(blob, `${filename}.png`)
  }, [])

  useImperativeHandle(ref, () => ({ fitView, zoomBy, centerOn, exportImage }), [
    fitView,
    zoomBy,
    centerOn,
    exportImage,
  ])

  // Fit whenever a different document is loaded
  const graphIdentity = graph.rootId + ':' + graph.nodeCount
  useEffect(() => {
    fitView()
  }, [graphIdentity, fitView])

  // Non-passive wheel handler so the page doesn't scroll while zooming
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0018))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) panState.current = { moved: false }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const next = { x: e.clientX, y: e.clientY }

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()]
      const other = a[0] === e.pointerId ? b[1] : a[1]
      const dPrev = Math.hypot(prev.x - other.x, prev.y - other.y)
      const dNext = Math.hypot(next.x - other.x, next.y - other.y)
      if (dPrev > 0) {
        const rect = svgRef.current!.getBoundingClientRect()
        zoomAt(
          (next.x + other.x) / 2 - rect.left,
          (next.y + other.y) / 2 - rect.top,
          dNext / dPrev,
        )
      }
    } else if (panState.current) {
      const dx = next.x - prev.x
      const dy = next.y - prev.y
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        panState.current.moved = true
        setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
      }
    }
    pointers.current.set(e.pointerId, next)
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    const wasClick = panState.current && !panState.current.moved
    if (pointers.current.size === 0) panState.current = null
    if (wasClick && e.target === svgRef.current) onSelect(null)
  }

  return (
    <svg
      ref={svgRef}
      className="h-full w-full touch-none select-none"
      style={{ cursor: panState.current ? 'grabbing' : 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
    >
      <g ref={contentRef} transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
        {layout.edges.map((e) => {
          const mx = (e.x1 + e.x2) / 2
          return (
            <path
              key={e.id}
              d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={1.5}
            />
          )
        })}
        {layout.nodes.map((laid) => (
          <GraphNodeView
            key={laid.node.id}
            laid={laid}
            collapsed={collapsedIds.has(laid.node.id)}
            selected={laid.node.id === selectedId}
            isHit={searchHits.has(laid.node.id)}
            isActiveHit={laid.node.id === activeHitId}
            onSelect={onSelect}
            onToggleCollapse={onToggleCollapse}
          />
        ))}
      </g>
    </svg>
  )
})

const GraphNodeView = React.memo(function GraphNodeView({
  laid,
  collapsed,
  selected,
  isHit,
  isActiveHit,
  onSelect,
  onToggleCollapse,
}: {
  laid: LaidOutNode
  collapsed: boolean
  selected: boolean
  isHit: boolean
  isActiveHit: boolean
  onSelect: (id: string) => void
  onToggleCollapse: (id: string) => void
}) {
  const s = NODE_STYLE
  const { node, x, y, width, height } = laid
  const hasHeader = node.label !== '' || node.kind !== 'value'
  const showRows = node.kind === 'value' ? true : !collapsed && node.rows.length > 0
  const maxChars = Math.floor((width - s.paddingX * 2) / s.charWidth)
  const stroke = selected
    ? 'hsl(var(--primary))'
    : isActiveHit
      ? HIT_COLOR
      : isHit
        ? HIT_COLOR
        : 'hsl(var(--border))'

  return (
    <g
      transform={`translate(${x},${y})`}
      onPointerUp={(e) => {
        e.stopPropagation()
        onSelect(node.id)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (node.childIds.length > 0) onToggleCollapse(node.id)
      }}
      style={{ cursor: 'pointer' }}
    >
      <rect
        width={width}
        height={height}
        rx={6}
        fill="hsl(var(--card))"
        stroke={stroke}
        strokeWidth={selected || isActiveHit ? 2 : isHit ? 1.75 : 1}
      />
      {hasHeader && (
        <>
          <text
            x={s.paddingX}
            y={s.headerHeight / 2 + 4}
            fontSize={12}
            fontWeight={600}
            fontFamily="var(--font-geist-mono), ui-monospace, monospace"
            fill={node.kind === 'array' ? '#8b5cf6' : 'hsl(var(--foreground))'}
          >
            {truncate(node.label === '$' ? '$ (root)' : node.label, maxChars - 6)}
          </text>
          {node.kind !== 'value' && (
            <text
              x={width - s.paddingX - (node.childIds.length > 0 ? 16 : 0)}
              y={s.headerHeight / 2 + 4}
              fontSize={11}
              textAnchor="end"
              fontFamily="var(--font-geist-mono), ui-monospace, monospace"
              fill="hsl(var(--muted-foreground))"
            >
              {nodeSummary(node)}
            </text>
          )}
          {showRows && node.kind !== 'value' && (
            <line
              x1={0}
              x2={width}
              y1={s.headerHeight}
              y2={s.headerHeight}
              stroke="hsl(var(--border))"
              strokeWidth={1}
            />
          )}
        </>
      )}
      {showRows &&
        node.rows.map((row, i) => {
          const rowY =
            (hasHeader && node.kind !== 'value' ? s.headerHeight : 0) + s.paddingY + (i + 1) * s.rowHeight - 5
          const keyPart = row.key ? `${row.key}: ` : ''
          const valueChars = Math.max(4, maxChars - keyPart.length)
          return (
            <text
              key={i}
              x={s.paddingX}
              y={node.kind === 'value' ? height / 2 + 4 : rowY}
              fontSize={12}
              fontFamily="var(--font-geist-mono), ui-monospace, monospace"
            >
              {keyPart && <tspan fill="hsl(var(--foreground))">{keyPart}</tspan>}
              <tspan fill={TYPE_COLORS[row.valueType]}>{truncate(row.value, valueChars)}</tspan>
            </text>
          )
        })}
      {node.childIds.length > 0 && (
        <g
          transform={`translate(${width - 11}, ${s.headerHeight / 2})`}
          onPointerUp={(e) => {
            e.stopPropagation()
            onToggleCollapse(node.id)
          }}
          role="button"
          aria-label={collapsed ? 'expand' : 'collapse'}
        >
          <circle r={7} fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth={1} />
          <text
            y={3.5}
            fontSize={11}
            textAnchor="middle"
            fill="hsl(var(--muted-foreground))"
            fontFamily="var(--font-geist-mono), ui-monospace, monospace"
          >
            {collapsed ? '+' : '−'}
          </text>
        </g>
      )}
    </g>
  )
})

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 1) return '…'
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

/**
 * Clones the graph <g>, inlines computed colors (resolving CSS variables so
 * the file stands alone), and wraps it in a standalone <svg> document.
 */
function serializeGraphSvg(svg: SVGSVGElement, content: SVGGElement, layout: GraphLayout): string {
  const clone = content.cloneNode(true) as SVGGElement
  clone.removeAttribute('transform')

  const srcEls = [content, ...Array.from(content.querySelectorAll('*'))]
  const dstEls = [clone, ...Array.from(clone.querySelectorAll('*'))]
  for (let i = 0; i < srcEls.length; i++) {
    const computed = window.getComputedStyle(srcEls[i])
    const dst = dstEls[i] as SVGElement
    for (const prop of ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight'] as const) {
      const v = computed.getPropertyValue(prop)
      if (v) dst.setAttribute(prop, v)
    }
  }

  const p = EXPORT_PADDING
  const w = layout.width + p * 2
  const h = layout.height + p * 2
  const bg = window.getComputedStyle(svg).getPropertyValue('background-color')
  const bgColor = !bg || bg === 'rgba(0, 0, 0, 0)' ? backgroundOf(svg) : bg
  const out = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  out.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  out.setAttribute('width', String(w))
  out.setAttribute('height', String(h))
  out.setAttribute('viewBox', `${-p} ${-p} ${w} ${h}`)
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', String(-p))
  rect.setAttribute('y', String(-p))
  rect.setAttribute('width', String(w))
  rect.setAttribute('height', String(h))
  rect.setAttribute('fill', bgColor)
  out.appendChild(rect)
  out.appendChild(clone)
  return new XMLSerializer().serializeToString(out)
}

function backgroundOf(el: Element): string {
  let cur: Element | null = el
  while (cur) {
    const bg = window.getComputedStyle(cur).getPropertyValue('background-color')
    if (bg && bg !== 'rgba(0, 0, 0, 0)') return bg
    cur = cur.parentElement
  }
  return '#ffffff'
}

function svgToPngBlob(serialized: string, width: number, height: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(width * scale)
      canvas.height = Math.ceil(height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        resolve(null)
        return
      }
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}
