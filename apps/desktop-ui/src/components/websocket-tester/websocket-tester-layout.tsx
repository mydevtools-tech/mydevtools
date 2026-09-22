'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  ArrowDown,
  ArrowUp,
  Braces,
  Check,
  Copy,
  Download,
  Info,
  Plug,
  Send,
  Trash2,
  Unplug,
} from 'lucide-react'
import { IconPlugConnected } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { ToolShell } from '@/components/tools/tool-shell'
import { IOPanel, ToolTextArea } from '@/components/tools/io-panel'
import { downloadFile } from '@/lib/desktop/save-file'
import {
  describeCloseEvent,
  formatLogEntry,
  formatLogTimestamp,
  isValidWsUrl,
  parseProtocols,
  tryPrettyJson,
  type LogDirection,
} from '@/lib/websocket-tester'

type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface UiLogEntry {
  id: number
  direction: LogDirection
  text: string
  timestamp: number
}

const STATUS_STYLE: Record<ConnStatus, string> = {
  disconnected: 'bg-muted text-muted-foreground border-border/60',
  connecting: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  connected: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  error: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',
}

function DirectionBadge({ direction }: { direction: LogDirection }) {
  if (direction === 'sent') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
        <ArrowUp className="h-3 w-3" /> SENT
      </span>
    )
  }
  if (direction === 'received') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
        <ArrowDown className="h-3 w-3" /> RECV
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
      <Info className="h-3 w-3" /> SYS
    </span>
  )
}

export function WebsocketTesterLayout() {
  const t = useTranslations('WebsocketTester')

  const [url, setUrl] = useState('')
  const [protocolsInput, setProtocolsInput] = useState('')
  const [status, setStatus] = useState<ConnStatus>('disconnected')
  const [entries, setEntries] = useState<UiLogEntry[]>([])
  const [prettyIds, setPrettyIds] = useState<Set<number>>(new Set())
  const [draft, setDraft] = useState('')
  const [pingEnabled, setPingEnabled] = useState(false)
  const [pingInterval, setPingInterval] = useState('10')
  const [pingPayload, setPingPayload] = useState('ping')

  const wsRef = useRef<WebSocket | null>(null)
  const idRef = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { isCopied: copiedAll, copyToClipboard } = useCopyToClipboard()

  const addEntry = useCallback((direction: LogDirection, text: string) => {
    setEntries((prev) => [...prev, { id: ++idRef.current, direction, text, timestamp: Date.now() }])
  }, [])

  const disconnect = useCallback(() => {
    const ws = wsRef.current
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(1000)
    }
  }, [])

  const connect = useCallback(() => {
    const target = url.trim()
    if (!isValidWsUrl(target)) {
      addEntry('system', t('messages.invalidUrl'))
      setStatus('error')
      return
    }
    const protocols = parseProtocols(protocolsInput)
    let ws: WebSocket
    try {
      ws = protocols.length > 0 ? new WebSocket(target, protocols) : new WebSocket(target)
    } catch (e) {
      addEntry('system', e instanceof Error ? e.message : t('messages.connectFailed'))
      setStatus('error')
      return
    }

    wsRef.current = ws
    setStatus('connecting')
    addEntry('system', t('messages.connecting', { url: target }))

    ws.onopen = () => {
      if (wsRef.current !== ws) return
      setStatus('connected')
      addEntry(
        'system',
        ws.protocol
          ? t('messages.connectedWithProtocol', { protocol: ws.protocol })
          : t('messages.connected'),
      )
    }
    ws.onmessage = (event: MessageEvent) => {
      if (wsRef.current !== ws) return
      const data: unknown = event.data
      if (typeof data === 'string') {
        addEntry('received', data)
      } else if (data instanceof Blob) {
        void data
          .text()
          .then((text) => addEntry('received', text))
          .catch(() => addEntry('system', t('messages.binaryMessage')))
      } else {
        addEntry('received', String(data))
      }
    }
    ws.onerror = () => {
      if (wsRef.current !== ws) return
      setStatus('error')
      addEntry('system', t('messages.socketError'))
    }
    ws.onclose = (event: CloseEvent) => {
      if (wsRef.current !== ws) return
      wsRef.current = null
      addEntry('system', describeCloseEvent(event.code, event.reason))
      setStatus((prev) => (prev === 'error' ? 'error' : 'disconnected'))
    }
  }, [url, protocolsInput, addEntry, t])

  const sendMessage = useCallback(
    (text: string, { fromPing = false }: { fromPing?: boolean } = {}) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (!fromPing) toast.error(t('messages.notConnected'))
        return false
      }
      ws.send(text)
      addEntry('sent', text)
      return true
    },
    [addEntry, t],
  )

  const sendDraft = useCallback(() => {
    if (!draft) return
    sendMessage(draft)
  }, [draft, sendMessage])

  const formatDraftAsJson = useCallback(() => {
    const pretty = tryPrettyJson(draft)
    if (pretty) setDraft(pretty)
    else toast.error(t('composer.invalidJson'))
  }, [draft, t])

  // Auto-send ping interval.
  useEffect(() => {
    if (!pingEnabled || status !== 'connected') return
    const seconds = Number.parseFloat(pingInterval)
    if (!Number.isFinite(seconds) || seconds <= 0) return
    const timer = window.setInterval(() => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN && pingPayload) {
        ws.send(pingPayload)
        addEntry('sent', pingPayload)
      }
    }, seconds * 1000)
    return () => window.clearInterval(timer)
  }, [pingEnabled, status, pingInterval, pingPayload, addEntry])

  // Clean up socket on unmount.
  useEffect(() => {
    return () => {
      const ws = wsRef.current
      wsRef.current = null
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000)
      }
    }
  }, [])

  // Auto-scroll the log.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [entries])

  const togglePretty = (id: number) => {
    setPrettyIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearLog = () => {
    setEntries([])
    setPrettyIds(new Set())
  }

  const copyAll = () => {
    if (entries.length === 0) return
    void copyToClipboard(entries.map(formatLogEntry).join('\n'), { silent: true })
  }

  const downloadLog = () => {
    if (entries.length === 0) return
    const blob = new Blob([entries.map(formatLogEntry).join('\n') + '\n'], {
      type: 'text/plain;charset=utf-8',
    })
    downloadFile(blob, `websocket-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
  }

  const isConnected = status === 'connected'
  const isConnecting = status === 'connecting'

  const toolbar = (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="min-w-[240px] flex-1 space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('urlLabel')}
          </Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isConnected && !isConnecting) connect()
            }}
            placeholder="wss://echo.websocket.org"
            className="font-mono text-sm"
            disabled={isConnected || isConnecting}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="min-w-[180px] space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('protocolsLabel')}
          </Label>
          <Input
            value={protocolsInput}
            onChange={(e) => setProtocolsInput(e.target.value)}
            placeholder={t('protocolsPlaceholder')}
            className="font-mono text-sm"
            disabled={isConnected || isConnecting}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {isConnected || isConnecting ? (
          <Button variant="destructive" onClick={disconnect} className="gap-1.5">
            <Unplug className="h-4 w-4" />
            {t('disconnect')}
          </Button>
        ) : (
          <Button onClick={connect} disabled={!url.trim()} className="gap-1.5">
            <Plug className="h-4 w-4" />
            {t('connect')}
          </Button>
        )}
        <Badge variant="outline" className={cn('h-9 gap-1.5 px-3 text-xs font-medium', STATUS_STYLE[status])}>
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              status === 'connected' && 'bg-emerald-500',
              status === 'connecting' && 'animate-pulse bg-amber-500',
              status === 'error' && 'bg-red-500',
              status === 'disconnected' && 'bg-muted-foreground/50',
            )}
            aria-hidden
          />
          {t(`status.${status}`)}
        </Badge>
      </div>
  )

  return (
    <ToolShell
      icon={IconPlugConnected}
      title={t('title')}
      description={t('subtitle')}
      offline={false}
      toolbar={toolbar}
      contentClassName="gap-4"
    >
      {/* Message log */}
      <IOPanel
        className="min-h-0 flex-1"
        bodyClassName="overflow-y-auto"
        label={t('log.title')}
        actions={
          <>
            <Badge variant="secondary" className="h-5 px-2 text-[11px]">
              {entries.length}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={copyAll}
              disabled={entries.length === 0}
              title={t('log.copyAll')}
            >
              {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={downloadLog}
              disabled={entries.length === 0}
              title={t('log.download')}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={clearLog}
              disabled={entries.length === 0}
              title={t('log.clear')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1 p-3">
            {entries.length === 0 && (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground/60">{t('log.empty')}</p>
            )}
            {entries.map((entry) => {
              const pretty = tryPrettyJson(entry.text)
              const showPretty = pretty !== null && prettyIds.has(entry.id)
              return (
                <div
                  key={entry.id}
                  className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/30"
                >
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground/60">
                    {formatLogTimestamp(entry.timestamp)}
                  </span>
                  <DirectionBadge direction={entry.direction} />
                  <pre
                    className={cn(
                      'min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed',
                      entry.direction === 'system' && 'italic text-muted-foreground',
                    )}
                  >
                    {showPretty ? pretty : entry.text}
                  </pre>
                  {pretty !== null && (
                    <button
                      type="button"
                      onClick={() => togglePretty(entry.id)}
                      title={showPretty ? t('log.showRaw') : t('log.prettyPrint')}
                      className={cn(
                        'shrink-0 rounded p-1 transition-colors hover:bg-muted/60',
                        showPretty ? 'text-primary' : 'text-muted-foreground/60 hover:text-foreground',
                      )}
                    >
                      <Braces className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
      </IOPanel>

      {/* Composer */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <ToolTextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              sendDraft()
            }
          }}
          placeholder={t('composer.placeholder')}
          className="relative h-auto min-h-[72px] resize-y"
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={sendDraft} disabled={!draft || !isConnected} className="gap-1.5">
            <Send className="h-4 w-4" />
            {t('composer.send')}
          </Button>
          <Button variant="outline" size="sm" onClick={formatDraftAsJson} disabled={!draft} className="gap-1.5">
            <Braces className="h-3.5 w-3.5" />
            {t('composer.formatJson')}
          </Button>
          <span className="text-[11px] text-muted-foreground/60">{t('composer.hint')}</span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Label htmlFor="ws-ping-switch" className="text-xs text-muted-foreground">
              {t('ping.label')}
            </Label>
            <Input
              value={pingInterval}
              onChange={(e) => setPingInterval(e.target.value)}
              type="number"
              min={1}
              className="h-8 w-20 text-xs"
              title={t('ping.intervalTitle')}
            />
            <span className="text-xs text-muted-foreground/60">{t('ping.seconds')}</span>
            <Input
              value={pingPayload}
              onChange={(e) => setPingPayload(e.target.value)}
              placeholder={t('ping.payloadPlaceholder')}
              className="h-8 w-32 font-mono text-xs"
              spellCheck={false}
            />
            <Switch id="ws-ping-switch" checked={pingEnabled} onCheckedChange={setPingEnabled} />
          </div>
        </div>
      </div>
    </ToolShell>
  )
}
