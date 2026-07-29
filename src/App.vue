<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { os } from '@neutralinojs/lib'
import seedReport from './data/annual-report.json'
import countries from './data/countries.json'
import { accentPalette } from './accentPalette'
import { chooseMemolockFile, exportMemolockReport, parseMemolockDocument } from './memolock'
import type { MemolockConflictAction } from './memolock'
import { loadStoredData, saveStoredData } from './storage'
import { createBlankReport, isMeaningfulReport } from './types'
import type { AnnualReport, AppSettings, BookEntry, CustomEntry, CustomTextEntry, PlaceEntry, ReportArchive, ReportLock, ReportLocks } from './types'

const params = new URLSearchParams(window.location.search)
const isSavedView = params.get('report') === 'saved'
const now = new Date()
if (!document.documentElement.dataset.theme) {
  document.documentElement.dataset.theme = 'dark'
  document.documentElement.style.colorScheme = 'dark'
}

const archive = reactive<ReportArchive>({ [seedReport.year]: { ...seedReport } })
const availableYears = Object.keys(archive).map(Number)
const selectedYear = ref(Number(params.get('year')) || Math.max(...availableYears))
const cloneReport = (value: AnnualReport): AnnualReport => ({
  ...value,
  bookEntries: value.bookEntries.map((entry) => ({ ...entry })),
  placeEntries: value.placeEntries.map((entry) => ({ ...entry })),
  customEntries: value.customEntries.map((entry) => ({ ...entry })),
})
const draft = reactive<AnnualReport>(cloneReport(archive[selectedYear.value] ?? seedReport))
const locks = reactive<ReportLocks>({})
const isEditing = ref(false)
const isConfirmingLock = ref(false)
const sidebarOpen = ref(false)
const isLoading = ref(true)
const storageError = ref('')
let errorTimeout: ReturnType<typeof setTimeout> | null = null
function setTemporaryError(msg: string, ms = 3000) {
  if (errorTimeout) clearTimeout(errorTimeout)
  storageError.value = msg
  errorTimeout = setTimeout(() => { storageError.value = '' }, ms)
}
const saveFeedback = ref('')
const persistedDraft = ref<AnnualReport | null>(null)
const settings = reactive<AppSettings>({ theme: 'dark', accent: 'leaf' })
const isSettingsOpen = ref(false)
const settingsTrigger = ref<HTMLElement | null>(null)
const activeView = ref<'report' | 'comparison'>('report')
const isImportOpen = ref(false)
const importTrigger = ref<HTMLElement | null>(null)
const importFileInput = ref<HTMLInputElement | null>(null)
const importDragging = ref(false)
const importResult = ref<{ kind: 'success' | 'error'; title: string; message: string } | null>(null)
const exportNotice = ref<{ year: number; path: string; error?: boolean } | null>(null)
const exportConflict = ref<{ report: AnnualReport; lock: ReportLock; path: string } | null>(null)
const customEntryDialog = ref<'chooser' | 'text' | 'number' | null>(null)
const isCustomEntryOpen = computed(() => customEntryDialog.value !== null)
const customEntryTrigger = ref<HTMLElement | null>(null)
const customEntryDraft = reactive<{ title: string; content: string; value: number | string }>({ title: '', content: '', value: '' })
const customEntryError = ref('')
const customEntryInvalid = ref<'title' | 'content' | 'value' | null>(null)
const lastCustomEntryChoice = ref<'text' | 'number'>('text')
const editingCustomEntryId = ref<string | null>(null)
const overflowingCustomEntryIds = ref<Set<string>>(new Set())
const activeCustomTextEntry = ref<CustomTextEntry | null>(null)
const customTextEntryTrigger = ref<HTMLElement | null>(null)
const activeDetail = ref<'books' | 'places' | null>(null)
const detailTrigger = ref<HTMLElement | null>(null)
const countryQueries = reactive<Record<string, string>>({})
const openCountryPicker = ref<string | null>(null)
const entryDialog = ref<'books' | 'places' | null>(null)
const workingBooks = ref<BookEntry[]>([])
const bookRatingInputs = reactive<Record<string, string>>({})
const workingPlaces = ref<PlaceEntry[]>([])
const entryError = ref('')
const entryTrigger = ref<HTMLElement | null>(null)
const newYearPromptDismissed = ref(false)

const report = computed(() => archive[selectedYear.value] ?? seedReport)
const isEmptyReport = computed(() => !isMeaningfulReport(report.value))
const currentYear = now.getFullYear()
const reportYear = currentYear - 1

const showNewYearPrompt = computed(() => !isSavedView
  && !newYearPromptDismissed.value
  && currentYear > seedReport.year
  && (!archive[reportYear] || !isMeaningfulReport(archive[reportYear])))
const years = computed(() => Object.keys(archive).map(Number).sort((a, b) => b - a))
const activeLock = computed(() => locks[selectedYear.value] ?? null)
const canEditSelectedYear = computed(() => selectedYear.value === reportYear && !activeLock.value && !isSavedView)
const numberFormat = new Intl.NumberFormat('en-US')
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const countryOptions = [...countries].sort((a, b) => a.name.localeCompare(b.name))
const metrics = computed(() => [
  { key: 'books', label: 'Books read', value: numberFormat.format(report.value.bookEntries.length), detail: '', accent: 'orange' },
  { key: 'places', label: 'Places visited', value: numberFormat.format(report.value.placeEntries.length), detail: '', accent: 'blue' },
  { key: 'stepsPerDay', label: 'Steps per day', value: numberFormat.format(report.value.stepsPerDay), detail: '', accent: 'green' },
  { key: 'albumsListened', label: 'Albums listened', value: numberFormat.format(report.value.albumsListened), detail: 'this year', accent: 'violet' },
  { key: 'averageDailySleepHours', label: 'Average sleep', value: `${report.value.averageDailySleepHours}h`, detail: 'per night', accent: 'navy' },
  { key: 'dailyExerciseHours', label: 'Daily exercise', value: `${report.value.dailyExerciseHours}h`, detail: 'per day', accent: 'teal' },
])

function formatCustomNumber(value: number) {
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000_000 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(3)
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

type ComparisonMetricKey = 'books' | 'places' | 'stepsPerDay' | 'albumsListened' | 'averageDailySleepHours' | 'dailyExerciseHours'
const comparisonMetric = ref<ComparisonMetricKey | ''>('')
const comparisonMetrics: { key: ComparisonMetricKey; label: string }[] = [
  { key: 'books', label: 'Books read' },
  { key: 'places', label: 'Places visited' },
  { key: 'stepsPerDay', label: 'Steps per day' },
  { key: 'albumsListened', label: 'Albums listened' },
  { key: 'averageDailySleepHours', label: 'Average sleep (hours)' },
  { key: 'dailyExerciseHours', label: 'Daily exercise (hours)' },
]
const comparisonYears = computed(() => Object.values(archive).sort((a, b) => a.year - b.year))
const customSummaryYears = computed(() => Object.values(archive)
  .filter((annualReport) => annualReport.customEntries.length > 0)
  .sort((a, b) => b.year - a.year))
const selectedComparisonMetric = computed(() => comparisonMetrics.find((metric) => metric.key === comparisonMetric.value))
const hasComparableData = computed(() => Boolean(comparisonMetric.value)
  && comparisonYears.value.length >= 2
  && comparisonYears.value.some((annualReport) => reportMetricValue(annualReport, comparisonMetric.value as ComparisonMetricKey) !== 0))
const chartWidth = computed(() => Math.max(720, (comparisonYears.value.length * 110) + 110))
function reportMetricValue(value: AnnualReport, key: ComparisonMetricKey) {
  if (key === 'books') return value.bookEntries.length
  if (key === 'places') return value.placeEntries.length
  return Number(value[key]) || 0
}
function niceAxisStep(maxValue: number) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 1
  if (maxValue >= 10_000) {
    const magnitude = 10 ** Math.floor(Math.log10(maxValue))
    return (maxValue / magnitude) > 5 ? magnitude * 2 : magnitude
  }
  const rawStep = maxValue / 5
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return factor * magnitude
}
const chartScale = computed(() => {
  if (!comparisonMetric.value || comparisonYears.value.length < 2) return { maximum: 1, step: 1, ticks: [] as { value: number; y: number; label: string }[] }
  const maximumValue = Math.max(...comparisonYears.value.map((annualReport) => reportMetricValue(annualReport, comparisonMetric.value as ComparisonMetricKey)), 0)
  const step = niceAxisStep(maximumValue)
  const maximum = Math.max(step, Math.ceil(maximumValue / step) * step)
  const count = Math.round(maximum / step)
  const fractionDigits = step >= 1 ? 0 : Math.min(4, Math.max(1, Math.ceil(-Math.log10(step))))
  const ticks = Array.from({ length: count + 1 }, (_, index) => {
    const value = index * step
    return {
      value,
      y: 245 - ((value / maximum) * 190),
      label: value.toLocaleString('en-US', { maximumFractionDigits: fractionDigits }),
    }
  })
  return { maximum, step, ticks }
})
function formatComparisonValue(value: number) {
  return comparisonMetric.value === 'averageDailySleepHours' || comparisonMetric.value === 'dailyExerciseHours'
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : numberFormat.format(value)
}
const chartBars = computed(() => {
  if (!comparisonMetric.value || !hasComparableData.value) return []
  const values = comparisonYears.value.map((annualReport) => reportMetricValue(annualReport, comparisonMetric.value as ComparisonMetricKey))
  const slotWidth = (chartWidth.value - 110) / Math.max(values.length, 1)
  const width = Math.min(64, slotWidth * 0.58)
  return comparisonYears.value.map((annualReport, index) => {
    const value = values[index]
    const height = value === 0 ? 2 : (value / chartScale.value.maximum) * 190
    return {
      year: annualReport.year,
      value,
      label: formatComparisonValue(value),
      x: 70 + (index * slotWidth) + ((slotWidth - width) / 2),
      y: 245 - height,
      width,
      height,
    }
  })
})

function measureCustomTextOverflow() {
  const overflowing = new Set<string>()
  document.querySelectorAll<HTMLElement>('.custom-text-card-content').forEach((element) => {
    const id = element.dataset.entryId
    if (id && element.scrollHeight > element.clientHeight + 1) overflowing.add(id)
  })
  overflowingCustomEntryIds.value = overflowing
}
async function scheduleCustomTextMeasurement() {
  await nextTick()
  requestAnimationFrame(measureCustomTextOverflow)
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme
  document.documentElement.style.colorScheme = settings.theme === 'light' ? 'light' : 'dark'
  const accent = accentPalette.find((color) => color.id === settings.accent) ?? accentPalette[6]
  document.documentElement.dataset.accent = accent.id
  document.documentElement.style.setProperty('--accent-swatch', accent.swatch)
  document.documentElement.style.setProperty('--accent-action', accent.action)
}

onMounted(async () => {
  if (typeof window.NL_PATH === 'string') {
  }
  try {
    const data = await loadStoredData(seedReport)
    Object.keys(archive).forEach((year) => delete archive[Number(year)])
    Object.assign(archive, data.archive)
    Object.keys(locks).forEach((year) => delete locks[Number(year)])
    Object.assign(locks, data.locks)
    Object.assign(settings, data.settings)
    applyTheme()
    selectedYear.value = Number(params.get('year')) || Math.max(...Object.keys(archive).map(Number))
    Object.assign(draft, data.draft ?? report.value)
    persistedDraft.value = data.draft ? cloneReport(data.draft) : null
    if (data.migrationPending) await persist()
  } catch (error) {
    storageError.value = error instanceof Error ? error.message : 'Unable to read the local data file.'
  } finally {
    isLoading.value = false
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.new-year-dialog')?.focus())
    void scheduleCustomTextMeasurement()
  }
})
window.addEventListener('resize', measureCustomTextOverflow)
onBeforeUnmount(() => window.removeEventListener('resize', measureCustomTextOverflow))

async function persist(includeDraft = false) {
  if (includeDraft) persistedDraft.value = cloneReport(draft)
  await saveStoredData({
    version: 5,
    settings: { ...settings },
    migrations: { demo2025Reset: true },
    archive: { ...archive },
    locks: { ...locks },
    ...(persistedDraft.value ? { draft: persistedDraft.value } : {}),
  })
}

function selectYear(year: number) {
  selectedYear.value = year
  activeView.value = 'report'
  sidebarOpen.value = false
  void scheduleCustomTextMeasurement()
}
async function openComparison() {
  activeView.value = 'comparison'
  comparisonMetric.value = ''
  sidebarOpen.value = false
  await nextTick()
  document.querySelector<HTMLElement>('.comparison-heading')?.focus()
}
async function openImport(event: MouseEvent) {
  importTrigger.value = event.currentTarget as HTMLElement
  importResult.value = null
  importDragging.value = false
  isImportOpen.value = true
  sidebarOpen.value = false
  await nextTick()
  document.querySelector<HTMLElement>('.import-dialog')?.focus()
}
function closeImport() {
  isImportOpen.value = false
  importDragging.value = false
  requestAnimationFrame(() => importTrigger.value?.focus())
}
async function processMemolockImport(name: string, contents: string) {
  if (!name.toLocaleLowerCase().endsWith('.memolock')) {
    importResult.value = { kind: 'error', title: 'Unsupported file', message: 'Choose a file ending in .memolock.' }
    return
  }
  try {
    const imported = parseMemolockDocument(contents)
    const year = imported.report.year
    if (locks[year]) throw new Error(`The ${year} report is already permanently locked and cannot be replaced.`)
    const previousReport = archive[year] ? cloneReport(archive[year]) : undefined
    archive[year] = cloneReport(imported.report)
    if (imported.status.locked) locks[year] = { year, lockedAt: imported.status.lockedAt as string }
    if (persistedDraft.value?.year === year) persistedDraft.value = null
    try {
      await persist()
    } catch (error) {
      if (previousReport) archive[year] = previousReport
      else delete archive[year]
      delete locks[year]
      throw error
    }
    selectedYear.value = year
    activeView.value = 'report'
    importResult.value = {
      kind: 'success',
      title: `${year} report imported`,
      message: imported.status.locked ? 'Status code: LOCKED. This report is permanently read-only.' : 'Status code: UNLOCKED. Normal year editing rules apply.',
    }
    void scheduleCustomTextMeasurement()
  } catch (error) {
    importResult.value = {
      kind: 'error',
      title: 'Import failed',
      message: error instanceof Error ? error.message : 'The Memolock file could not be processed.',
    }
  }
}
async function chooseImportFile() {
  if (typeof window.NL_PATH !== 'string') {
    importFileInput.value?.click()
    return
  }
  try {
    const selected = await chooseMemolockFile()
    if (selected) await processMemolockImport(selected.name, selected.contents)
  } catch (error) {
    importResult.value = { kind: 'error', title: 'Import failed', message: error instanceof Error ? error.message : 'The file could not be opened.' }
  }
}
async function handleImportInput(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  if (file) await processMemolockImport(file.name, await file.text())
  input.value = ''
}
async function handleImportDrop(event: DragEvent) {
  importDragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file) await processMemolockImport(file.name, await file.text())
}
async function exportLockedReport(
  reportToExport = report.value,
  lock = activeLock.value,
  conflictAction?: MemolockConflictAction,
) {
  if (!lock) return
  try {
    const result = await exportMemolockReport(reportToExport, lock, conflictAction)
    if (result.status === 'conflict') {
      exportConflict.value = { report: cloneReport(reportToExport), lock: { ...lock }, path: result.path }
      await nextTick()
      document.querySelector<HTMLElement>('.export-conflict-dialog')?.focus()
      return
    }
    exportConflict.value = null
    exportNotice.value = { year: reportToExport.year, path: result.path }
  } catch (error) {
    exportNotice.value = {
      year: reportToExport.year,
      path: error instanceof Error ? error.message : 'The .memolock file could not be exported.',
      error: true,
    }
  }
  await nextTick()
  document.querySelector<HTMLElement>('.export-dialog')?.focus()
}
async function resolveExportConflict(action: 'skip' | MemolockConflictAction) {
  const conflict = exportConflict.value
  if (!conflict) return
  exportConflict.value = null
  if (action === 'skip') return
  await exportLockedReport(conflict.report, conflict.lock, action)
}
function beginCompletedYearReport() {
  if (locks[reportYear] || isSavedView) return
  archive[reportYear] ??= createBlankReport(reportYear)
  selectedYear.value = reportYear
  newYearPromptDismissed.value = true
  Object.assign(draft, cloneReport(archive[reportYear]))
  saveFeedback.value = ''
  isEditing.value = true
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.editor')?.focus())
}
async function setAccent(accent: AppSettings['accent']) {
  const previous = settings.accent
  settings.accent = accent
  applyTheme()
  storageError.value = ''
  try {
    await persist()
  } catch (error) {
    settings.accent = previous
    applyTheme()
    storageError.value = error instanceof Error ? error.message : 'Accent color could not be saved.'
  }
}
function dismissNewYearPrompt() {
  newYearPromptDismissed.value = true
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.edit-button')?.focus())
}
function openEditor() {
  if (!canEditSelectedYear.value) return
  Object.assign(draft, cloneReport(report.value))
  saveFeedback.value = ''
  isEditing.value = true
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.editor')?.focus())
}
function openLockReport() {
  if (!canEditSelectedYear.value) return
  if (!isMeaningfulReport(report.value)) {
    setTemporaryError("You can't lock the report until you've added values to the entries.")
    return
  }
  Object.assign(draft, cloneReport(report.value))
  storageError.value = ''
  isEditing.value = true
  isConfirmingLock.value = true
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.lock-panel')?.focus())
}
async function setTheme(theme: AppSettings['theme']) {
  const previous = settings.theme
  settings.theme = theme
  applyTheme()
  storageError.value = ''
  try {
    await persist()
  } catch (error) {
    settings.theme = previous
    applyTheme()
    storageError.value = error instanceof Error ? error.message : 'Theme preference could not be saved.'
  }
}
function openSettings(event: MouseEvent) {
  settingsTrigger.value = event.currentTarget as HTMLElement
  isSettingsOpen.value = true
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.settings-panel')?.focus())
}
function closeSettings() {
  isSettingsOpen.value = false
  requestAnimationFrame(() => settingsTrigger.value?.focus())
}
function handleModalKeydown(event: KeyboardEvent, close: () => void) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const overlay = event.currentTarget as HTMLElement
  const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
  if (!focusable.length) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
  if (event.shiftKey && activeIndex <= 0) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (activeIndex === -1 || document.activeElement === last)) {
    event.preventDefault()
    first.focus()
  }
}
async function openCustomEntry(event: MouseEvent) {
  if (!canEditSelectedYear.value) return
  customEntryTrigger.value = event.currentTarget as HTMLElement
  editingCustomEntryId.value = null
  customEntryDialog.value = 'chooser'
  await nextTick()
  document.querySelector<HTMLElement>('.custom-entry-choice')?.focus()
}
async function editCustomEntry(entry: CustomEntry, event: MouseEvent) {
  if (!canEditSelectedYear.value) return
  customEntryTrigger.value = event.currentTarget as HTMLElement
  editingCustomEntryId.value = entry.id
  customEntryDraft.title = entry.title
  customEntryDraft.content = entry.type === 'text' ? entry.content : ''
  customEntryDraft.value = entry.type === 'number' ? entry.value : ''
  customEntryError.value = ''
  customEntryInvalid.value = null
  customEntryDialog.value = entry.type
  await nextTick()
  document.querySelector<HTMLInputElement>('#custom-entry-title')?.focus()
}
function resetCustomEntryDraft() {
  customEntryDraft.title = ''
  customEntryDraft.content = ''
  customEntryDraft.value = ''
  customEntryError.value = ''
  customEntryInvalid.value = null
}
async function chooseCustomEntryType(type: 'text' | 'number') {
  lastCustomEntryChoice.value = type
  editingCustomEntryId.value = null
  resetCustomEntryDraft()
  customEntryDialog.value = type
  await nextTick()
  document.querySelector<HTMLInputElement>('#custom-entry-title')?.focus()
}
async function backToCustomEntryChooser() {
  customEntryError.value = ''
  customEntryInvalid.value = null
  customEntryDialog.value = 'chooser'
  await nextTick()
  document.querySelector<HTMLElement>(`[data-custom-entry-choice="${lastCustomEntryChoice.value}"]`)?.focus()
}
async function closeCustomEntry() {
  customEntryDialog.value = null
  editingCustomEntryId.value = null
  await nextTick()
  customEntryTrigger.value?.focus()
}
async function openCustomTextEntry(entry: CustomTextEntry, event: MouseEvent) {
  customTextEntryTrigger.value = event.currentTarget as HTMLElement
  activeCustomTextEntry.value = entry
  await nextTick()
  document.querySelector<HTMLElement>('.custom-entry-reading-dialog')?.focus()
}
function closeCustomTextEntry() {
  activeCustomTextEntry.value = null
  requestAnimationFrame(() => customTextEntryTrigger.value?.focus())
}
async function saveCustomEntry() {
  if (!canEditSelectedYear.value || (customEntryDialog.value !== 'text' && customEntryDialog.value !== 'number')) return
  const title = customEntryDraft.title.trim()
  if (!title) {
    customEntryError.value = 'Enter a title for this entry.'
    customEntryInvalid.value = 'title'
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#custom-entry-title')?.focus())
    return
  }
  let entry: CustomEntry
  if (customEntryDialog.value === 'text') {
    const content = customEntryDraft.content.trim()
    if (!content) {
      customEntryError.value = 'Enter content for this entry.'
      customEntryInvalid.value = 'content'
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#custom-entry-content')?.focus())
      return
    }
    entry = { id: editingCustomEntryId.value ?? crypto.randomUUID(), type: 'text', title, content }
  } else {
    const value = customEntryDraft.value
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      customEntryError.value = 'Enter a valid number. Zero, decimals, and negative values are allowed.'
      customEntryInvalid.value = 'value'
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#custom-entry-value')?.focus())
      return
    }
    entry = { id: editingCustomEntryId.value ?? crypto.randomUUID(), type: 'number', title, value }
  }
  customEntryError.value = ''
  customEntryInvalid.value = null
  const previous = archive[selectedYear.value]
  const saved = cloneReport(previous)
  const editingIndex = editingCustomEntryId.value
    ? saved.customEntries.findIndex((candidate) => candidate.id === editingCustomEntryId.value)
    : -1
  if (editingCustomEntryId.value && editingIndex < 0) {
    customEntryError.value = 'This custom entry no longer exists.'
    return
  }
  if (editingIndex >= 0) saved.customEntries.splice(editingIndex, 1, entry)
  else saved.customEntries.push(entry)
  archive[selectedYear.value] = saved
  storageError.value = ''
  try {
    await persist()
    await closeCustomEntry()
    void scheduleCustomTextMeasurement()
  } catch (error) {
    archive[selectedYear.value] = previous
    customEntryError.value = error instanceof Error ? error.message : 'The custom entry could not be saved.'
  }
}
async function openHelp() {
  const url = 'https://adamngshrine.com/index/miscs/memolock'
  try {
    if (typeof window.NL_PATH === 'string') await os.open(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  } catch (error) {
    storageError.value = error instanceof Error ? error.message : 'The help desk could not be opened.'
  }
}
function addBook() {
  const entry: BookEntry = { id: crypto.randomUUID(), title: '', author: '' }
  workingBooks.value.push(entry)
  bookRatingInputs[entry.id] = ''
}
function removeBook(id: string) {
  workingBooks.value = workingBooks.value.filter((entry) => entry.id !== id)
  delete bookRatingInputs[id]
}
function addPlace() {
  const entry: PlaceEntry = { id: crypto.randomUUID(), location: '', countryCode: '', countryName: '' }
  workingPlaces.value.push(entry)
}
function removePlace(id: string) {
  workingPlaces.value = workingPlaces.value.filter((entry) => entry.id !== id)
  delete countryQueries[id]
}
function openEntryDialog(kind: 'books' | 'places', event: MouseEvent) {
  entryTrigger.value = event.currentTarget as HTMLElement
  workingBooks.value = draft.bookEntries.map((entry) => ({ ...entry }))
  Object.keys(bookRatingInputs).forEach((id) => delete bookRatingInputs[id])
  workingBooks.value.forEach((book) => { bookRatingInputs[book.id] = book.rating === undefined ? '' : String(book.rating) })
  workingPlaces.value = draft.placeEntries.map((entry) => ({ ...entry }))
  entryError.value = ''
  entryDialog.value = kind
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.entry-dialog')?.focus())
}
function closeEntryDialog() {
  entryDialog.value = null
  openCountryPicker.value = null
  requestAnimationFrame(() => entryTrigger.value?.focus())
}
function commitBooks() {
  if (workingBooks.value.some((book) => !book.title.trim())) {
    entryError.value = 'Every book needs a title.'
    return
  }
  draft.bookEntries = workingBooks.value.map((entry) => ({
    ...entry,
    title: entry.title.trim(),
    ...(entry.rating === undefined
      ? {}
      : { rating: Math.min(10, Math.max(0, Math.round(Number(entry.rating) || 0))) }),
  }))
  draft.books = draft.bookEntries.length
  closeEntryDialog()
}
function setBookRating(book: BookEntry, event: Event) {
  const input = event.target as HTMLInputElement
  if (input.value === '') {
    bookRatingInputs[book.id] = ''
    book.rating = undefined
    return
  }
  const clamped = Math.min(10, Math.max(0, Math.round(Number(input.value) || 0)))
  bookRatingInputs[book.id] = String(clamped)
  book.rating = clamped
  input.value = String(clamped)
}
function commitPlaces() {
  if (workingPlaces.value.some((place) => !place.location.trim() || !place.countryCode)) {
    entryError.value = 'Every place needs a specific location and selected country or region.'
    return
  }
  draft.placeEntries = workingPlaces.value.map((entry) => ({ ...entry, location: entry.location.trim() }))
  draft.places = draft.placeEntries.length
  closeEntryDialog()
}
function filteredCountries(id: string) {
  const query = (countryQueries[id] ?? '').trim().toLocaleLowerCase()
  return query ? countryOptions.filter((country) => country.name.toLocaleLowerCase().includes(query) || country.code.toLocaleLowerCase().includes(query)) : countryOptions
}
function selectCountry(entry: PlaceEntry, country: { code: string; name: string }) {
  entry.countryCode = country.code
  entry.countryName = country.name
  countryQueries[entry.id] = ''
  openCountryPicker.value = null
}
function openDetail(detail: 'books' | 'places', event: MouseEvent) {
  detailTrigger.value = event.currentTarget as HTMLElement
  activeDetail.value = detail
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.detail-dialog')?.focus())
}
function closeDetail() {
  activeDetail.value = null
  requestAnimationFrame(() => detailTrigger.value?.focus())
}
function closeEditor() { isEditing.value = false; isConfirmingLock.value = false }
async function saveAndClose() {
  if (draft.year !== reportYear || locks[draft.year] || isSavedView) return
  storageError.value = ''
  const saved = cloneReport(draft)
  normalizeOptionalNumbers(saved)
  Object.assign(draft, saved)
  archive[saved.year] = saved
  selectedYear.value = saved.year
  persistedDraft.value = null
  try {
    await persist()
    closeEditor()
  } catch (error) {
    storageError.value = error instanceof Error ? error.message : 'The report could not be saved.'
  }
}
async function confirmAndSave() {
  if (draft.year !== reportYear || locks[draft.year] || isSavedView) return
  const saved = cloneReport(draft)
  if (saved.placeEntries.some((place) => !place.location.trim() || !place.countryCode)) {
    storageError.value = 'Every detailed place needs a specific location and selected country or region before locking.'
    return
  }
  normalizeOptionalNumbers(saved)
  archive[saved.year] = saved
  selectedYear.value = saved.year
  locks[saved.year] = { year: saved.year, lockedAt: new Date().toISOString() }
  persistedDraft.value = null
  storageError.value = ''
  try {
    await persist()
    closeEditor()
    await exportLockedReport(saved, locks[saved.year])
  } catch (error) {
    delete locks[saved.year]
    storageError.value = error instanceof Error ? error.message : 'Final save failed; the report was not locked.'
  }
}
function normalizeOptionalNumbers(value: AnnualReport) {
  value.books = value.bookEntries.length
  value.places = value.placeEntries.length
  value.stepsPerDay = Number(value.stepsPerDay) || 0
  value.albumsListened = Number(value.albumsListened) || 0
  value.averageDailySleepHours = Number(value.averageDailySleepHours) || 0
  value.dailyExerciseHours = Number(value.dailyExerciseHours) || 0
}
</script>

<template>
  <div v-if="isLoading" class="loading-state" role="status">Opening your local archive…</div>
  <div
    v-else
    class="workspace"
    :inert="isCustomEntryOpen"
    :aria-hidden="isCustomEntryOpen ? 'true' : undefined"
  >
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <nav aria-label="Report years">
        <p class="nav-label">Report years</p>
        <button v-for="year in years" :key="year" type="button" :class="{ active: activeView === 'report' && year === selectedYear }" :aria-current="activeView === 'report' && year === selectedYear ? 'page' : undefined" @click="selectYear(year)">
          <span>{{ year }}</span>
          <small v-if="locks[year]" aria-label="Permanently locked">Locked</small>
          <small v-else-if="year !== reportYear" aria-label="Read-only archive year">Read-only</small>
        </button>
      </nav>
      <nav class="view-nav" aria-label="Report views">
        <button class="settings-button import-button" type="button" aria-haspopup="dialog" @click="openImport"><span aria-hidden="true">⇩</span> Import report</button>
        <button class="settings-button chart-button" type="button" :class="{ active: activeView === 'comparison' }" :aria-current="activeView === 'comparison' ? 'page' : undefined" @click="openComparison"><span aria-hidden="true">▥</span> Compare years</button>
      </nav>
      <button class="settings-button" type="button" @click="openSettings"><span aria-hidden="true">⚙</span> Settings</button>
      <div class="local-note"><div><strong>Memolock 0.1.1</strong><span style="font-size: 12px;">adamngshrine {{ currentYear }}</span></div></div>
    </aside>
    <button v-if="sidebarOpen" class="sidebar-scrim" aria-label="Close year menu" @click="sidebarOpen = false"></button>
    <main>
      <header class="topbar">
        <button class="menu-button" type="button" aria-label="Open year menu" @click="sidebarOpen = true">☰</button>
        <div v-if="activeView === 'report'"><p>Annual report</p><h1>{{ report.title || 'Untitled' }}</h1></div>
        <div v-else><p>Annual trends</p><h1 class="comparison-heading" tabindex="-1">Compare years</h1></div>
        <div v-if="activeView === 'report'" class="top-actions">
          <template v-if="activeLock">
            <span class="lock-status">Locked permanently</span>
            <button class="export-report-button" type="button" @click="exportLockedReport()">Export</button>
          </template>
          <span v-else-if="isSavedView" class="saved-status">Saved report</span>
          <span v-else-if="selectedYear !== reportYear" class="saved-status">Read-only archive</span>
          <template v-else-if="canEditSelectedYear">
            <button class="edit-button" type="button" @click="openEditor">Edit report</button>
            <button class="lock-button" type="button" @click="openLockReport">Lock report</button>
          </template>
        </div>
      </header>
      <div v-if="activeView === 'report'" class="content">
        <p v-if="storageError" class="storage-error" role="alert">{{ storageError }}</p>
        <section v-if="isEmptyReport" class="empty-callout">
          <div><p>You haven't added an entry in {{ report.year }} yet. Add one now so your journey can take shape.</p></div>
          <button type="button" :disabled="!canEditSelectedYear" @click="openEditor">Add an entry</button>
        </section>
        <section class="metric-grid" aria-label="Annual report entries">
          <component
            :is="metric.key === 'books' || metric.key === 'places' ? 'button' : 'article'"
            v-for="metric in metrics"
            :key="metric.key"
            class="metric-card"
            :class="[`accent-${metric.accent}`, { interactive: metric.key === 'books' || metric.key === 'places' }]"
            :type="metric.key === 'books' || metric.key === 'places' ? 'button' : undefined"
            :aria-haspopup="metric.key === 'books' || metric.key === 'places' ? 'dialog' : undefined"
            :aria-expanded="metric.key === 'books' ? activeDetail === 'books' : metric.key === 'places' ? activeDetail === 'places' : undefined"
            :aria-controls="metric.key === 'books' ? 'books-detail' : metric.key === 'places' ? 'places-detail' : undefined"
            @click="metric.key === 'books' || metric.key === 'places' ? openDetail(metric.key, $event) : undefined"
          >
            <span v-if="metric.key === 'books' || metric.key === 'places'" class="metric-affordance" aria-hidden="true">View details ↗</span>
            <strong>{{ metric.value }}</strong><div><h2>{{ metric.label }}</h2><p>{{ metric.detail }}</p></div>
          </component>
          <article
            v-for="entry in report.customEntries"
            :key="entry.id"
            class="metric-card custom-entry-card"
            :class="entry.type === 'number' ? 'custom-number-card' : 'custom-text-card'"
            :aria-label="entry.type === 'number' ? `${entry.title}: ${entry.value}` : undefined"
          >
            <button v-if="entry.type === 'text'" class="custom-entry-reader" type="button" :aria-label="`Read ${entry.title}`" @click="openCustomTextEntry(entry, $event)"></button>
            <button v-if="canEditSelectedYear" class="edit-custom-entry" type="button" :aria-label="`Edit ${entry.title}`" @click.stop="editCustomEntry(entry, $event)">Edit</button>
            <template v-if="entry.type === 'number'">
              <strong>{{ formatCustomNumber(entry.value) }}</strong>
              <div><h2>{{ entry.title }}</h2><p>Custom number</p></div>
            </template>
            <template v-else>
              <strong>{{ entry.title }}</strong>
              <p class="custom-text-card-content" :data-entry-id="entry.id">{{ entry.content }}</p>
              <span v-if="overflowingCustomEntryIds.has(entry.id)" class="custom-read-more">Read more</span>
            </template>
          </article>
          <button
            class="metric-card add-more-card"
            type="button"
            aria-haspopup="dialog"
            aria-controls="custom-entry-flow"
            :aria-expanded="isCustomEntryOpen"
            :disabled="!canEditSelectedYear"
            :title="canEditSelectedYear ? 'Add a custom entry' : 'Only the newly completed, unlocked year can be edited'"
            @click="openCustomEntry"
          >
            <span class="add-more-icon" aria-hidden="true">+</span>
            <strong>Add more entries</strong>
          </button>
        </section>
        <section class="note-card"><div>Quote of the year</div><blockquote>“{{ report.highlight }}”</blockquote></section>
      </div>
      <div v-else class="content comparison-view">
        <section class="comparison-controls" aria-labelledby="comparison-view-title">
          <div>
            <p class="comparison-eyebrow">Offline year comparison</p>
            <h2 id="comparison-view-title">See what changed over time</h2>
            <p>Select one standard metric. Custom entries stay separate below.</p>
          </div>
          <label for="comparison-metric">Metric
            <select id="comparison-metric" v-model="comparisonMetric">
              <option value="" disabled>Choose a metric</option>
              <option v-for="metric in comparisonMetrics" :key="metric.key" :value="metric.key">{{ metric.label }}</option>
            </select>
          </label>
        </section>

        <section class="comparison-chart-section">
          <div v-if="!comparisonMetric" class="chart-empty" role="status">Choose a metric to draw the comparison chart.</div>
          <div v-else-if="comparisonYears.length < 2" class="chart-empty" role="status">At least two report years are needed for a comparison.</div>
          <div v-else-if="!hasComparableData" class="chart-empty" role="status">This metric has no recorded values yet.</div>
          <template v-else>
            <div class="chart-plot">
              <svg :viewBox="`0 0 ${chartWidth} 300`" :style="{ minWidth: `${chartWidth}px` }" role="img" aria-labelledby="comparison-chart-title comparison-chart-description">
                <title id="comparison-chart-title">{{ selectedComparisonMetric?.label }} by year</title>
                <desc id="comparison-chart-description">Bar chart comparing {{ selectedComparisonMetric?.label.toLocaleLowerCase() }} across {{ comparisonYears.length }} report years.</desc>
                <g v-for="tick in chartScale.ticks" :key="tick.value">
                  <line x1="70" :y1="tick.y" :x2="chartWidth - 40" :y2="tick.y" class="chart-grid-line" />
                  <text x="60" :y="tick.y + 4" text-anchor="end" class="chart-tick">{{ tick.label }}</text>
                </g>
                <line x1="70" y1="55" x2="70" y2="245" class="chart-axis" />
                <text x="-150" y="19" text-anchor="middle" transform="rotate(-90)" class="chart-axis-label">{{ selectedComparisonMetric?.label }}</text>
                <g v-for="bar in chartBars" :key="bar.year">
                  <rect :x="bar.x" :y="bar.y" :width="bar.width" :height="bar.height" rx="3" class="chart-bar" />
                  <text :x="bar.x + (bar.width / 2)" :y="Math.max(bar.y - 9, 18)" text-anchor="middle" class="chart-value">{{ bar.label }}</text>
                  <text :x="bar.x + (bar.width / 2)" y="274" text-anchor="middle" class="chart-year">{{ bar.year }}</text>
                </g>
              </svg>
            </div>
            <div class="chart-table-wrap">
              <table class="chart-table">
                <caption>{{ selectedComparisonMetric?.label }} values by year</caption>
                <thead><tr><th scope="col">Year</th><th scope="col">Value</th></tr></thead>
                <tbody><tr v-for="bar in chartBars" :key="bar.year"><th scope="row">{{ bar.year }}</th><td>{{ bar.label }}</td></tr></tbody>
              </table>
            </div>
          </template>
        </section>

        <section class="custom-summary" aria-labelledby="custom-summary-title">
          <div class="custom-summary-head"><h2 id="custom-summary-title">Custom entries by year</h2><p>Written notes and custom numbers are shown as context, not chart metrics.</p></div>
          <p v-if="!customSummaryYears.length" class="chart-empty">No custom entries have been saved yet.</p>
          <div v-for="annualReport in customSummaryYears" v-else :key="annualReport.year" class="custom-summary-year">
            <h3>{{ annualReport.year }}</h3>
            <ul>
              <li v-for="entry in annualReport.customEntries" :key="entry.id">
                <div><strong>{{ entry.title }}</strong><small>{{ entry.type === 'number' ? 'Number' : 'Text' }}</small></div>
                <p>{{ entry.type === 'number' ? formatCustomNumber(entry.value) : entry.content }}</p>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </main>
    <Teleport to="body">
      <div v-if="activeCustomTextEntry" class="overlay" @click.self="closeCustomTextEntry" @keydown="handleModalKeydown($event, closeCustomTextEntry)">
        <section class="custom-entry-reading-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-entry-reading-title" tabindex="-1">
          <div class="modal-head">
            <div><p>Custom entry</p><h2 id="custom-entry-reading-title">{{ activeCustomTextEntry.title }}</h2></div>
            <button type="button" aria-label="Close custom entry" @click="closeCustomTextEntry">×</button>
          </div>
          <div class="custom-entry-reading-content"><p>{{ activeCustomTextEntry.content }}</p></div>
        </section>
      </div>
      <div v-if="isImportOpen" class="overlay" @click.self="closeImport" @keydown="handleModalKeydown($event, closeImport)">
        <section class="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" tabindex="-1">
          <div class="modal-head">
            <div><p>Portable report file</p><h2 id="import-title">Import .memolock</h2></div>
            <button type="button" aria-label="Close import" @click="closeImport">×</button>
          </div>
          <div
            class="import-dropzone"
            :class="{ dragging: importDragging }"
            @dragenter.prevent="importDragging = true"
            @dragover.prevent="importDragging = true"
            @dragleave.prevent="importDragging = false"
            @drop.prevent="handleImportDrop"
          >
            <span class="import-icon" aria-hidden="true">⇩</span>
            <strong>Select or drag and drop</strong>
            <p>Process one portable Memolock report.</p>
            <button class="primary" type="button" @click="chooseImportFile">Select .memolock file</button>
            <input ref="importFileInput" class="visually-hidden" type="file" accept=".memolock" @change="handleImportInput" />
          </div>
          <section v-if="importResult" class="import-result" :class="importResult.kind" :aria-live="importResult.kind === 'error' ? 'assertive' : 'polite'">
            <strong>{{ importResult.title }}</strong>
            <p>{{ importResult.message }}</p>
          </section>
          <div v-if="importResult?.kind === 'success'" class="form-actions"><button class="secondary" type="button" @click="closeImport">View report</button></div>
        </section>
      </div>
      <div v-if="exportNotice" class="overlay" @click.self="exportNotice = null" @keydown.esc="exportNotice = null">
        <section class="export-dialog" role="alertdialog" aria-modal="true" aria-labelledby="export-title" tabindex="-1">
          <span class="export-icon" aria-hidden="true">{{ exportNotice.error ? '!' : '✓' }}</span>
          <p>{{ exportNotice.error ? 'Report locked; export needs attention' : 'Portable copy created' }}</p>
          <h2 id="export-title">{{ exportNotice.error ? 'Export failed' : `${exportNotice.year} report exported` }}</h2>
          <p v-if="!exportNotice.error" class="export-path">Exported to {{ exportNotice.path }}.</p>
          <p v-else class="storage-error" role="alert">{{ exportNotice.path }}</p>
        </section>
      </div>
      <div v-if="exportConflict" class="overlay" @keydown.esc="resolveExportConflict('skip')">
        <section class="export-dialog export-conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="export-conflict-title" tabindex="-1">
          <span class="export-icon" aria-hidden="true">!</span>
          <p>Matching file found</p>
          <h2 id="export-conflict-title">Report already exists</h2>
          <p class="export-path">{{ exportConflict.path }}</p>
          <p>Choose what Windows should do with this export.</p>
          <div class="export-conflict-actions">
            <button class="secondary" type="button" @click="resolveExportConflict('skip')">Skip</button>
            <button class="primary" type="button" @click="resolveExportConflict('copy')">Make (1)</button>
            <button class="danger" type="button" @click="resolveExportConflict('overwrite')">Overwrite</button>
          </div>
        </section>
      </div>
      <div v-if="showNewYearPrompt" class="overlay" @click.self="dismissNewYearPrompt" @keydown.esc="dismissNewYearPrompt">
        <section class="new-year-dialog" role="dialog" aria-modal="true" aria-labelledby="new-year-title" tabindex="-1">
          <button class="prompt-close" type="button" aria-label="Dismiss new year reminder" @click="dismissNewYearPrompt">×</button>
          <h2 id="new-year-title">It's {{ currentYear }}! Time to add your {{ reportYear }} journey</h2>
          <p>Look back on the year you completed.</p>
          <button class="primary" type="button" :disabled="Boolean(locks[reportYear])" @click="beginCompletedYearReport">Start {{ reportYear }} report</button>
          <small v-if="locks[reportYear]">Your {{ reportYear }} report is permanently locked.</small>
        </section>
      </div>
      <div v-if="activeDetail" class="overlay" @click.self="closeDetail" @keydown.esc="closeDetail">
        <section
          :id="`${activeDetail}-detail`"
          class="detail-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`${activeDetail}-detail-title`"
          tabindex="-1"
        >
          <div class="modal-head">
            <div><p>{{ activeDetail === 'books' ? 'Reading log' : 'Travel log' }}</p><h2 :id="`${activeDetail}-detail-title`">{{ activeDetail === 'books' ? 'Books read' : 'Places visited' }}</h2></div>
            <button type="button" :aria-label="`Close ${activeDetail} details`" @click="closeDetail">×</button>
          </div>
          <template v-if="activeDetail === 'books'">
            <p v-if="!report.bookEntries.length" class="empty-detail">No book details recorded yet. The annual total is still preserved.</p>
            <ol v-else><li v-for="book in report.bookEntries" :key="book.id"><div><strong>{{ book.title }}</strong><span>{{ book.author || 'Unknown author' }}</span></div><small>{{ book.rating !== undefined ? `${book.rating}/10` : 'Unrated' }}<template v-if="book.finishedDate"> · {{ book.finishedDate }}</template></small></li></ol>
          </template>
          <template v-else>
            <p v-if="!report.placeEntries.length" class="empty-detail">No place details recorded yet. The annual total is still preserved.</p>
            <ol v-else><li v-for="place in report.placeEntries" :key="place.id"><div><strong>{{ place.location }}</strong><span>{{ place.countryName }}</span></div><small>{{ place.countryCode }}<template v-if="place.visitedDate"> · {{ place.visitedDate }}</template></small></li></ol>
          </template>
        </section>
      </div>
      <div id="custom-entry-flow" v-if="isCustomEntryOpen" class="overlay" @click.self="closeCustomEntry" @keydown="handleModalKeydown($event, closeCustomEntry)">
        <section v-if="customEntryDialog === 'chooser'" id="custom-entry-chooser" class="custom-entry-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-entry-chooser-title" tabindex="-1">
          <div class="modal-head">
            <div><p>Custom report card</p><h2 id="custom-entry-chooser-title">Add more entries</h2></div>
            <button type="button" aria-label="Close entry type chooser" @click="closeCustomEntry">×</button>
          </div>
          <p class="custom-entry-intro">Choose how this entry should appear in your annual report.</p>
          <div class="custom-entry-choices">
            <button class="custom-entry-choice" data-custom-entry-choice="text" type="button" @click="chooseCustomEntryType('text')">
              <strong>Title with textbox</strong>
              <span>Add a heading with longer written content.</span>
            </button>
            <button class="custom-entry-choice" data-custom-entry-choice="number" type="button" @click="chooseCustomEntryType('number')">
              <strong>Title with number</strong>
              <span>Add a heading with a standalone numeric value.</span>
            </button>
          </div>
        </section>
        <section v-else class="custom-entry-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-entry-dialog-title" tabindex="-1">
          <div class="modal-head">
            <div><p>Custom report card</p><h2 id="custom-entry-dialog-title">{{ editingCustomEntryId ? `Edit ${customEntryDialog} entry` : customEntryDialog === 'number' ? 'Title with number' : 'Title with textbox' }}</h2></div>
            <button type="button" aria-label="Close custom entry form" @click="closeCustomEntry">×</button>
          </div>
          <form :aria-describedby="customEntryError && !customEntryInvalid ? 'custom-entry-error' : undefined" novalidate @submit.prevent="saveCustomEntry">
            <label for="custom-entry-title">Title</label>
            <input
              id="custom-entry-title"
              v-model="customEntryDraft.title"
              type="text"
              maxlength="120"
              required
              :aria-invalid="customEntryInvalid === 'title' ? 'true' : undefined"
              :aria-describedby="customEntryInvalid === 'title' ? 'custom-entry-error' : undefined"
            />
            <template v-if="customEntryDialog === 'text'">
              <label for="custom-entry-content">Content</label>
              <textarea
                id="custom-entry-content"
                v-model="customEntryDraft.content"
                rows="6"
                maxlength="2000"
                required
                :aria-invalid="customEntryInvalid === 'content' ? 'true' : undefined"
                :aria-describedby="customEntryInvalid === 'content' ? 'custom-entry-error' : undefined"
              ></textarea>
            </template>
            <template v-else>
              <label for="custom-entry-value">Number</label>
              <input
                id="custom-entry-value"
                v-model.number="customEntryDraft.value"
                type="number"
                step="any"
                inputmode="decimal"
                required
                :aria-invalid="customEntryInvalid === 'value' ? 'true' : undefined"
                :aria-describedby="customEntryInvalid === 'value' ? 'custom-entry-error' : undefined"
              />
            </template>
            <p v-if="customEntryError" id="custom-entry-error" class="storage-error" role="alert">{{ customEntryError }}</p>
            <div class="form-actions"><button class="secondary" type="button" @click="editingCustomEntryId ? closeCustomEntry() : backToCustomEntryChooser()">{{ editingCustomEntryId ? 'Cancel' : 'Back' }}</button><button class="primary" type="submit">{{ editingCustomEntryId ? 'Save changes' : 'Add entry' }}</button></div>
          </form>
        </section>
      </div>
      <div v-if="entryDialog" class="overlay" @click.self="closeEntryDialog" @keydown.esc="closeEntryDialog">
        <section class="entry-dialog" role="dialog" aria-modal="true" :aria-labelledby="`${entryDialog}-editor-title`" tabindex="-1">
          <div class="modal-head">
            <div><p>Report details</p><h2 :id="`${entryDialog}-editor-title`">{{ entryDialog === 'books' ? 'Books you read' : 'Places you visited' }}</h2></div>
            <button type="button" :aria-label="`Cancel ${entryDialog} changes`" @click="closeEntryDialog">×</button>
          </div>
          <template v-if="entryDialog === 'books'">
            <div class="entry-title"><p>Add every book you want included in the annual count.</p><button type="button" @click="addBook">+ Add book</button></div>
            <p v-if="!workingBooks.length" class="entry-empty">No books added yet.</p>
            <div v-for="(book, index) in workingBooks" :key="book.id" class="entry-row">
              <span class="entry-number">{{ index + 1 }}</span>
              <label>Title<input v-model.trim="book.title" type="text" required /></label>
              <label>Author <span>*optional</span><input v-model.trim="book.author" type="text" /></label>
              <label>Finished date <span>*optional</span><input v-model="book.finishedDate" type="date" /></label>
              <label class="score-ratings">Rating <span>*optional</span>
                <span class="rating-input-wrap">
                  <input
                    class="rating-input"
                    type="number"
                    min="0"
                    max="10"
                    step="1"
                    :class="{ empty: bookRatingInputs[book.id] === '' }"
                    :value="bookRatingInputs[book.id]"
                    :aria-describedby="bookRatingInputs[book.id] === '' ? `rating-scale-${book.id}` : undefined"
                    @input="setBookRating(book, $event)"
                  />
                  <span v-if="bookRatingInputs[book.id] === ''" :id="`rating-scale-${book.id}`" class="rating-suffix">out of 10</span>
                </span>
              </label>
              <button class="delete-entry" type="button" :aria-label="`Delete ${book.title || `book ${index + 1}`}`" @click="removeBook(book.id)">Delete entry</button>
            </div>
          </template>
          <template v-else>
            <div class="entry-title"><p>Add a specific location and select its country or region.</p><button type="button" @click="addPlace">+ Add place</button></div>
            <p v-if="!workingPlaces.length" class="entry-empty">No places added yet.</p>
            <div v-for="(place, index) in workingPlaces" :key="place.id" class="entry-row place-row">
              <span class="entry-number">{{ index + 1 }}</span>
              <label>Specific location<input v-model.trim="place.location" type="text" placeholder="City, landmark, or region" required /></label>
              <div class="country-field">
                <label :for="`country-${place.id}`">Country or region</label>
                <button :id="`country-${place.id}`" class="country-trigger" type="button" :aria-expanded="openCountryPicker === place.id" :aria-controls="`countries-${place.id}`" @click="openCountryPicker = openCountryPicker === place.id ? null : place.id"><span>{{ place.countryName || 'Choose a country or region' }}</span><span aria-hidden="true">⌄</span></button>
                <div v-if="openCountryPicker === place.id" :id="`countries-${place.id}`" class="country-popover">
                  <input v-model="countryQueries[place.id]" type="search" placeholder="Search countries" aria-label="Search countries and regions" />
                  <div class="country-list" role="listbox" :aria-label="`Country for ${place.location || `place ${index + 1}`}`">
                    <button v-for="country in filteredCountries(place.id)" :key="country.code" type="button" role="option" :aria-selected="place.countryCode === country.code" @click="selectCountry(place, country)"><span>{{ country.name }}</span><span aria-hidden="true">{{ place.countryCode === country.code ? '✓' : '' }}</span></button>
                  </div>
                </div>
              </div>
              <label>Visited date <span>*optional</span><input v-model="place.visitedDate" type="date" /></label>
              <button class="delete-entry" type="button" :aria-label="`Delete ${place.location || `place ${index + 1}`}`" @click="removePlace(place.id)">Delete entry</button>
            </div>
          </template>
          <p v-if="entryError" class="storage-error" role="alert">{{ entryError }}</p>
          <div class="form-actions"><button class="secondary" type="button" @click="closeEntryDialog">Cancel</button><button class="primary" type="button" @click="entryDialog === 'books' ? commitBooks() : commitPlaces()">Save & close</button></div>
        </section>
      </div>
    </Teleport>
    <div v-if="isEditing" class="overlay" @click.self="closeEditor" @keydown.esc="closeEditor">
      <section v-if="!isConfirmingLock" class="editor" role="dialog" aria-modal="true" aria-labelledby="editor-title" tabindex="-1">
        <div class="modal-head"><div><h4>What did you accomplish in {{ draft.year }}?</h4><p class="editor-guidance">These default entries are used for chart comparisons and cannot be deleted. You can add custom entries, but they won't appear in the chart.</p></div><button type="button" aria-label="Close form" @click="closeEditor">×</button></div>
        <form @submit.prevent="saveAndClose">
          <div class="field-grid">
            <label class="wide">Report title<input v-model.trim="draft.title" type="text" /></label>
            <button class="entry-launcher" type="button" @click="openEntryDialog('books', $event)"><span>Add books you've read</span><small>{{ draft.bookEntries.length }} books saved</small></button>
            <button class="entry-launcher" type="button" @click="openEntryDialog('places', $event)"><span>Add places & countries you've visited</span><small>{{ draft.placeEntries.length }} places saved</small></button>
            <label>Average steps per day<input v-model.number="draft.stepsPerDay" type="number" min="0" required /></label>
            <label>Albums listened this year<input v-model.number="draft.albumsListened" type="number" min="0" required /></label>
            <label>Average sleep (hours)<input v-model.number="draft.averageDailySleepHours" type="number" min="0" max="24" step="0.1" required /></label>
            <label>Daily exercise (hours)<input v-model.number="draft.dailyExerciseHours" type="number" min="0" max="24" step="0.1" required /></label>
            <label class="wide">Quote of the year<textarea v-model.trim="draft.highlight" rows="3"></textarea></label>
          </div>
          <p v-if="storageError" class="storage-error" role="alert">{{ storageError }}</p>
          <div class="form-actions">
            <button class="secondary" type="button" @click="closeEditor">Cancel</button>
            <button class="primary save-report-button" type="submit">Save & close</button>
          </div>
        </form>
      </section>
      <section v-else class="lock-panel" role="alertdialog" aria-modal="true" aria-labelledby="lock-title" tabindex="-1">
        <span class="lock-icon" aria-hidden="true">!</span><p>Final confirmation</p><h2 id="lock-title">FINALIZE {{ draft.year }} FOREVER</h2>
        <p class="warning-copy">This permanently locks your {{ draft.year }} report. It cannot be edited or unlocked later.</p>
        <p v-if="storageError" class="storage-error" role="alert">{{ storageError }}</p>
        <label class="confirmation-check"><input type="checkbox" required form="lock-form" /><span>I understand this report will be permanently read-only.</span></label>
        <form id="lock-form" class="lock-actions" @submit.prevent="confirmAndSave"><button class="secondary" type="button" @click="isConfirmingLock = false">Go back</button><button class="danger" type="submit">LOCK FOREVER</button></form>
      </section>
    </div>
    <div v-if="isSettingsOpen" class="overlay" @click.self="closeSettings" @keydown.esc="closeSettings">
      <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
        <div class="modal-head"><div><h2 id="settings-title">Settings</h2></div><button type="button" aria-label="Close settings" @click="closeSettings">×</button></div>
        <section class="settings-section">
          <div><h3>Appearance</h3><p>Choose how this workspace looks on this device.</p></div>
          <div class="theme-control" aria-label="Color theme">
            <button type="button" :aria-pressed="settings.theme === 'light'" @click="setTheme('light')">Light</button>
            <button type="button" :aria-pressed="settings.theme === 'dark'" @click="setTheme('dark')">Dark</button>
            <button type="button" :aria-pressed="settings.theme === 'oled'" @click="setTheme('oled')">OLED</button>
          </div>
        </section>
        <section class="settings-section accent-settings">
          <div><h3>Accent color</h3><p>Personalize selected controls and primary actions.</p></div>
          <div class="accent-grid" aria-label="Accent color">
            <button
              v-for="color in accentPalette"
              :key="color.id"
              class="accent-choice"
              type="button"
              :style="{ '--swatch': color.swatch }"
              :aria-label="`${color.label} accent`"
              :aria-pressed="settings.accent === color.id"
              @click="setAccent(color.id)"
            ><span aria-hidden="true">{{ settings.accent === color.id ? '✓' : '' }}</span></button>
          </div>
        </section>
        <section class="settings-section about"><div><h3>About this app</h3><p>Memolock · version 0.1.1</p></div><p>Your archive stays beside the app, while portable .memolock copies export to Documents. There are no accounts, analytics, or cloud services.</p></section>
        <p v-if="storageError" class="storage-error" role="alert">{{ storageError }}</p>
        <a class="help-button" href="https://adamngshrine.com/index/miscs/memolock" @click.prevent="openHelp"><span>Help desk</span><small>↗</small></a>
      </section>
    </div>
  </div>
</template>
