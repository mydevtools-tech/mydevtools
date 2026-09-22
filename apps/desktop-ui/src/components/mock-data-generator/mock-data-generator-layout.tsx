'use client'

import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useMockDataWorker } from '@/hooks/use-mock-data-worker'
import { useIsMobile } from '@/components/hooks/use-mobile'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Dices, Download, Plus, Trash2, RefreshCw, CopyPlus, Loader2, FileUp, FileDown } from 'lucide-react'
import { IconClipboardData } from '@tabler/icons-react'
import { ToolMobileTabs } from '@/components/tools/tool-mobile-tabs'
import { CopyTextButton } from '@/components/tools/copy-text-button'
import { ToolShell } from '@/components/tools/tool-shell'
import { IOPanel, ToolTextArea } from '@/components/tools/io-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { downloadFile } from '@/lib/desktop/save-file'
import {
  ALL_FIELD_TYPES,
  FIELD_TYPE_GROUP_STRUCTURE,
  MAX_MOCK_ROWS,
  schemaHasDuplicateFieldNames,
  TYPES_WITH_OPTIONS,
  type FieldSchema,
  type FieldType,
  type OutputFormat,
} from '@/lib/mock-data-generator'

type SchemaRow = FieldSchema & { _id: string }

function newRow(partial?: Partial<FieldSchema>): SchemaRow {
  return {
    _id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
    name: partial?.name ?? 'field',
    type: partial?.type ?? 'full_name',
    options: partial?.options ?? {},
  }
}

const DEFAULT_ROWS: SchemaRow[] = [
  newRow({ name: 'id', type: 'uuid' }),
  newRow({ name: 'name', type: 'full_name' }),
  newRow({ name: 'email', type: 'email' }),
  newRow({ name: 'created_at', type: 'datetime', options: { dateFrom: '2023-01-01' } }),
]

function toFieldSchema(rows: SchemaRow[]): FieldSchema[] {
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    options: r.options,
  }))
}

function extensionForFormat(f: OutputFormat): string {
  switch (f) {
    case 'json': return 'json'
    case 'csv': return 'csv'
    case 'sql': return 'sql'
    case 'xml': return 'xml'
    default: return 'txt'
  }
}

export function MockDataGeneratorLayout() {
  const t = useTranslations('MockDataGenerator')
  const tg = useTranslations('MockDataGenerator.groups')
  const tf = useTranslations('MockDataGenerator.fieldTypes')
  const baseId = useId()
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<'schema' | 'output'>('schema')
  const [schemaRows, setSchemaRows] = useState<SchemaRow[]>(DEFAULT_ROWS)
  const [rowCount, setRowCount] = useState(25)
  const [format, setFormat] = useState<OutputFormat>('json')
  const [tableName, setTableName] = useState('records')
  const [output, setOutput] = useState('')
  const [generating, setGenerating] = useState(false)
  const { isCopied: copied, copyToClipboard, reset: resetCopied } = useCopyToClipboard()
  const [presetSelectKey, setPresetSelectKey] = useState(0)
  const [seedInput, setSeedInput] = useState('')

  const schema = useMemo(() => toFieldSchema(schemaRows), [schemaRows])
  const duplicates = useMemo(() => schemaHasDuplicateFieldNames(schema), [schema])

  const updateRow = useCallback((id: string, patch: Partial<FieldSchema>) => {
    setSchemaRows((prev) =>
      prev.map((r) => {
        if (r._id !== id) return r
        if (patch.type !== undefined) {
          return { ...r, ...patch, options: patch.options ?? {} }
        }
        if (patch.options !== undefined) {
          return { ...r, ...patch, options: { ...r.options, ...patch.options } }
        }
        return { ...r, ...patch }
      })
    )
  }, [])

  const setRowOptions = useCallback((id: string, options: FieldSchema['options']) => {
    setSchemaRows((prev) => prev.map((r) => (r._id === id ? { ...r, options: { ...options } } : r)))
  }, [])

  const { generate } = useMockDataWorker()

  const runGenerate = useCallback(async () => {
    resetCopied()
    setGenerating(true)
    try {
      const result = await generate({
        schema,
        rows: rowCount,
        format,
        tableName: format === 'sql' ? tableName : undefined,
        seed: seedInput.trim() === '' ? undefined : seedInput.trim(),
      })
      setOutput(result)
      if (isMobile) setMobileTab('output')
    } catch {
      setOutput('')
    } finally {
      setGenerating(false)
    }
  }, [generate, schema, rowCount, format, tableName, seedInput, isMobile, resetCopied])

  const randomizeSeed = useCallback(() => {
    setSeedInput(String(Math.floor(Math.random() * 1_000_000_000)))
  }, [])

  const handleCopy = () => {
    if (!output) return
    void copyToClipboard(output, { silent: true })
  }

  const handleDownload = () => {
    if (!output) return
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' })
    downloadFile(blob, `mock-data.${extensionForFormat(format)}`)
  }

  const loadPreset = (key: string) => {
    setPresetSelectKey((k) => k + 1)
    resetCopied()
    setOutput('')
    switch (key) {
      case 'users':
        setSchemaRows([
          newRow({ name: 'id', type: 'uuid' }),
          newRow({ name: 'username', type: 'username' }),
          newRow({ name: 'email', type: 'email' }),
          newRow({ name: 'role', type: 'custom_list', options: { values: 'admin, editor, viewer' } }),
          newRow({ name: 'active', type: 'boolean' }),
          newRow({ name: 'created_at', type: 'datetime' }),
        ])
        break
      case 'products':
        setSchemaRows([
          newRow({ name: 'sku', type: 'sequence', options: { min: 1000, step: 1 } }),
          newRow({ name: 'name', type: 'word' }),
          newRow({ name: 'description', type: 'sentence' }),
          newRow({ name: 'price', type: 'float', options: { min: 4.99, max: 999.99, decimals: 2 } }),
          newRow({ name: 'currency', type: 'currency_code' }),
          newRow({ name: 'in_stock', type: 'boolean' }),
        ])
        break
      case 'apiLog':
        setSchemaRows([
          newRow({ name: 'id', type: 'uuid' }),
          newRow({ name: 'method', type: 'http_method' }),
          newRow({ name: 'path', type: 'slug' }),
          newRow({ name: 'status', type: 'http_status' }),
          newRow({ name: 'duration_ms', type: 'integer', options: { min: 5, max: 2500 } }),
          newRow({ name: 'logged_at', type: 'datetime' }),
        ])
        break
      default:
        setSchemaRows(DEFAULT_ROWS.map((r) => newRow({ name: r.name, type: r.type, options: r.options })))
    }
  }

  const importInputRef = useRef<HTMLInputElement>(null)

  const handleExportSchema = () => {
    const blob = new Blob([JSON.stringify(toFieldSchema(schemaRows), null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    downloadFile(blob, 'mock-data-schema.json')
  }

  const handleImportSchema = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error()
      const rows = parsed.map((f) => {
        const field = f as Partial<FieldSchema>
        if (typeof field.name !== 'string' || !ALL_FIELD_TYPES.includes(field.type as FieldType)) {
          throw new Error()
        }
        return newRow({
          name: field.name,
          type: field.type,
          options: typeof field.options === 'object' && field.options !== null ? field.options : {},
        })
      })
      setSchemaRows(rows)
      resetCopied()
      setOutput('')
    } catch {
      toast.error(t('importSchemaError'))
    }
  }

  const showTypeOptions = (type: FieldType) => TYPES_WITH_OPTIONS.includes(type)

  return (
    <ToolShell
      icon={IconClipboardData}
      title={t('title')}
      description={t('subtitle', { max: MAX_MOCK_ROWS })}
      contentClassName="min-h-0"
    >

      {isMobile && (
        <ToolMobileTabs
          value={mobileTab}
          onValueChange={setMobileTab}
          tabs={[
            { value: 'schema', label: t('schemaHeading') },
            { value: 'output', label: t('output') },
          ]}
        />
      )}

      <div className={`flex-1 min-h-0 ${isMobile ? 'flex flex-col' : 'grid grid-cols-1 xl:grid-cols-[1fr_minmax(280px,38%)] gap-4'}`}>
        {(!isMobile || mobileTab === 'schema') && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${baseId}-rows`} className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('rowsLabel')}
              </Label>
              <Input
                id={`${baseId}-rows`}
                type="number"
                min={1}
                max={MAX_MOCK_ROWS}
                value={rowCount}
                onChange={(e) => setRowCount(Number(e.target.value))}
                className="w-28 font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">{t('formatLabel')}</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as OutputFormat)}>
                <SelectTrigger className="w-[140px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">{t('formats.json')}</SelectItem>
                  <SelectItem value="csv">{t('formats.csv')}</SelectItem>
                  <SelectItem value="sql">{t('formats.sql')}</SelectItem>
                  <SelectItem value="xml">{t('formats.xml')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {format === 'sql' && (
              <div className="space-y-1.5 flex-1 min-w-[160px] max-w-xs">
                <Label htmlFor={`${baseId}-table`} className="text-xs text-muted-foreground uppercase tracking-wider">
                  {t('tableNameLabel')}
                </Label>
                <Input
                  id={`${baseId}-table`}
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  className="font-mono text-sm"
                  placeholder="records"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">{t('presetsLabel')}</Label>
              <Select key={presetSelectKey} onValueChange={loadPreset}>
                <SelectTrigger className="w-[200px] text-sm">
                  <SelectValue placeholder={t('presetPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t('presetDefault')}</SelectItem>
                  <SelectItem value="users">{t('presetUsers')}</SelectItem>
                  <SelectItem value="products">{t('presetProducts')}</SelectItem>
                  <SelectItem value="apiLog">{t('presetApiLog')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${baseId}-seed`} className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('seedLabel')}
              </Label>
              <div className="flex gap-1.5">
                <Input
                  id={`${baseId}-seed`}
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  placeholder={t('seedPlaceholder')}
                  title={t('seedHint')}
                  maxLength={64}
                  spellCheck={false}
                  className="w-32 font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={randomizeSeed}
                  aria-label={t('seedRandomize')}
                  title={t('seedRandomize')}
                >
                  <Dices className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Button
              type="button"
              onClick={() => void runGenerate()}
              disabled={generating}
              className="gap-2 shrink-0"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t('generate')}
            </Button>
          </div>

          {duplicates && (
            <p className="text-xs text-amber-600 dark:text-amber-500" role="status">
              {t('warningDuplicateNames')}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 shrink-0">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('schemaHeading')}
            </span>
            <div className="flex gap-1.5">
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleImportSchema(file)
                  e.target.value = ''
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => importInputRef.current?.click()}
              >
                <FileUp className="h-3.5 w-3.5" />
                {t('importSchema')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5"
                onClick={handleExportSchema}
              >
                <FileDown className="h-3.5 w-3.5" />
                {t('exportSchema')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setSchemaRows((r) => [...r, newRow()])}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('addField')}
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[22%] min-w-[100px] font-mono text-xs">{t('colName')}</TableHead>
                  <TableHead className="w-[22%] min-w-[120px] text-xs">{t('colType')}</TableHead>
                  <TableHead className="min-w-[180px] text-xs">{t('colOptions')}</TableHead>
                  <TableHead className="w-20 text-xs text-center">{t('colBlank')}</TableHead>
                  <TableHead className="w-[72px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {schemaRows.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="align-top py-2">
                      <Input
                        value={row.name}
                        onChange={(e) => updateRow(row._id, { name: e.target.value })}
                        className="h-8 font-mono text-xs"
                        aria-label={t('colName')}
                      />
                    </TableCell>
                    <TableCell className="align-top py-2">
                      <Select
                        value={row.type}
                        onValueChange={(v) => {
                          updateRow(row._id, { type: v as FieldType, options: {} })
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[min(70vh,420px)]">
                          {FIELD_TYPE_GROUP_STRUCTURE.map((g) => (
                            <SelectGroup key={g.groupKey}>
                              <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                {tg(g.groupKey)}
                              </SelectLabel>
                              {g.types.map((value) => (
                                <SelectItem key={value} value={value} className="text-xs">
                                  {tf(value)}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="align-top py-2">
                      {showTypeOptions(row.type) ? (
                        <FieldOptionsEditor
                          type={row.type}
                          options={row.options ?? {}}
                          onChange={(opts) => setRowOptions(row._id, opts)}
                          labels={{
                            min: t('optMin'),
                            max: t('optMax'),
                            decimals: t('optDecimals'),
                            from: t('optDateFrom'),
                            to: t('optDateTo'),
                            values: t('optValues'),
                            step: t('optStep'),
                            rowBase: t('optRowBase'),
                          }}
                        />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top py-2">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        className="h-8 text-xs text-center px-1"
                        value={row.options?.blankPercent ?? ''}
                        placeholder="0"
                        onChange={(e) => {
                          const v = e.target.value
                          updateRow(row._id, {
                            options: {
                              ...row.options,
                              blankPercent: v === '' ? undefined : Math.min(100, Math.max(0, Number(v))),
                            },
                          })
                        }}
                        aria-label={t('colBlank')}
                      />
                    </TableCell>
                    <TableCell className="align-top py-2">
                      <div className="flex gap-0.5 justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => {
                            const copy = newRow({ name: `${row.name}_copy`, type: row.type, options: { ...row.options } })
                            setSchemaRows((prev) => {
                              const idx = prev.findIndex((x) => x._id === row._id)
                              const next = [...prev]
                              next.splice(idx + 1, 0, copy)
                              return next
                            })
                          }}
                          aria-label={t('duplicateField')}
                        >
                          <CopyPlus className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                          disabled={schemaRows.length <= 1}
                          onClick={() => setSchemaRows((prev) => prev.filter((x) => x._id !== row._id))}
                          aria-label={t('removeField')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {t('rowsHint', { max: MAX_MOCK_ROWS })}
          </p>
        </div>
        )}

        {(!isMobile || mobileTab === 'output') && (
        <IOPanel
          label={t('output')}
          className="min-h-0 flex-1"
          actions={
            <>
              <CopyTextButton
                onCopy={handleCopy}
                copied={copied}
                disabled={!output}
                label={t('copy')}
                copiedLabel={t('copied')}
                className="h-8 gap-1.5"
              />
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleDownload} disabled={!output}>
                <Download className="h-3.5 w-3.5" />
                {t('download')}
              </Button>
            </>
          }
        >
          <ToolTextArea readOnly value={output} placeholder={t('outputPlaceholder')} className="text-xs" />
        </IOPanel>
        )}
      </div>
    </ToolShell>
  )
}

function FieldOptionsEditor({
  type,
  options,
  onChange,
  labels,
}: {
  type: FieldType
  options: NonNullable<FieldSchema['options']>
  onChange: (o: FieldSchema['options']) => void
  labels: Record<string, string>
}) {
  const set = (patch: Partial<NonNullable<FieldSchema['options']>>) => {
    onChange({ ...options, ...patch })
  }

  if (type === 'integer' || type === 'float') {
    return (
      <div className="flex flex-wrap gap-1.5 items-center">
        <Input
          className="h-7 w-16 font-mono text-[11px] px-1.5"
          type="number"
          placeholder={labels.min}
          value={options.min ?? ''}
          onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
        <Input
          className="h-7 w-16 font-mono text-[11px] px-1.5"
          type="number"
          placeholder={labels.max}
          value={options.max ?? ''}
          onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
        {type === 'float' && (
          <Input
            className="h-7 w-14 font-mono text-[11px] px-1.5"
            type="number"
            min={0}
            max={8}
            placeholder={labels.decimals}
            value={options.decimals ?? ''}
            onChange={(e) => set({ decimals: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        )}
      </div>
    )
  }

  if (type === 'date' || type === 'datetime' || type === 'unix_timestamp') {
    return (
      <div className="flex flex-col gap-1">
        <Input
          className="h-7 font-mono text-[11px] px-1.5"
          placeholder={labels.from}
          value={options.dateFrom ?? ''}
          onChange={(e) => set({ dateFrom: e.target.value || undefined })}
        />
        <Input
          className="h-7 font-mono text-[11px] px-1.5"
          placeholder={labels.to}
          value={options.dateTo ?? ''}
          onChange={(e) => set({ dateTo: e.target.value || undefined })}
        />
      </div>
    )
  }

  if (type === 'custom_list') {
    return (
      <Input
        className="h-7 font-mono text-[11px] px-1.5"
        placeholder={labels.values}
        value={options.values ?? ''}
        onChange={(e) => set({ values: e.target.value })}
      />
    )
  }

  if (type === 'sequence') {
    return (
      <div className="flex flex-wrap gap-1.5 items-center">
        <Input
          className="h-7 w-16 font-mono text-[11px] px-1.5"
          type="number"
          placeholder={labels.min}
          value={options.min ?? ''}
          onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
        <Input
          className="h-7 w-14 font-mono text-[11px] px-1.5"
          type="number"
          placeholder={labels.step}
          value={options.step ?? ''}
          onChange={(e) => set({ step: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
      </div>
    )
  }

  if (type === 'row_index') {
    return (
      <Input
        className="h-7 w-16 font-mono text-[11px] px-1.5"
        type="number"
        placeholder={labels.rowBase}
        value={options.rowIndexBase ?? ''}
        onChange={(e) => set({ rowIndexBase: e.target.value === '' ? undefined : Number(e.target.value) })}
      />
    )
  }

  return null
}
