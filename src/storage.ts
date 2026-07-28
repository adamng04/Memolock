import { filesystem } from '@neutralinojs/lib'
import { accentColorIds, createBlankReport } from './types'
import type { AnnualReport, AppSettings, CustomEntry, ReportArchive, ReportLock, ReportLocks } from './types'

export interface StoredData {
  version: 5
  archive: ReportArchive
  locks: ReportLocks
  draft?: AnnualReport
  settings: AppSettings
  migrations?: {
    demo2025Reset: true
  }
  migrationPending?: boolean
}

const archiveKey = 'personal-annual-report-archive'
const lockKey = `${archiveKey}:lock`
const draftKey = `${archiveKey}:draft`
const settingsKey = `${archiveKey}:settings`

type LegacyCustomEntry = {
  id?: unknown
  type?: unknown
  title?: unknown
  content?: unknown
  value?: unknown
}

type LegacyReport = Omit<Partial<AnnualReport>, 'customEntries'> & {
  customEntries?: LegacyCustomEntry[]
  steps?: number
  codingHours?: number
  photos?: number
  musicHours?: number
  sleepAverage?: number
  exerciseHours?: number
}

type LegacyStoredData = Omit<Partial<StoredData>, 'version'> & {
  version?: number
  lock?: ReportLock | null
}

export function normalizeReport(report: LegacyReport): AnnualReport {
  const bookEntries = Array.isArray(report.bookEntries) ? report.bookEntries.map((entry) => ({
    ...entry,
    ...(entry.rating === undefined
      ? {}
      : { rating: Math.min(10, Math.max(0, Math.round(Number(entry.rating) || 0))) }),
  })) : []
  const placeEntries = Array.isArray(report.placeEntries) ? report.placeEntries.map((entry) => ({ ...entry })) : []
  const customEntries: CustomEntry[] = Array.isArray(report.customEntries) ? report.customEntries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const id = typeof entry.id === 'string' && entry.id ? entry.id : crypto.randomUUID()
      const title = typeof entry.title === 'string' ? entry.title : ''
      if (entry.type === 'number') {
        const value = Number(entry.value)
        return { id, type: 'number', title, value: Number.isFinite(value) ? value : 0 }
      }
      return {
        id,
        type: 'text',
        title,
        content: typeof entry.content === 'string' ? entry.content : '',
      }
    }) : []
  return {
    year: Number(report.year) || new Date().getFullYear(),
    title: typeof report.title === 'string' ? report.title : '',
    subtitle: typeof report.subtitle === 'string' ? report.subtitle : '',
    books: bookEntries.length,
    places: placeEntries.length,
    stepsPerDay: report.stepsPerDay !== undefined
      ? Number(report.stepsPerDay) || 0
      : Math.round(((Number(report.steps) || 0) / 365) * 10) / 10,
    albumsListened: report.albumsListened !== undefined ? Number(report.albumsListened) || 0 : 0,
    averageDailySleepHours: report.averageDailySleepHours !== undefined
      ? Number(report.averageDailySleepHours) || 0
      : Number(report.sleepAverage) || 0,
    dailyExerciseHours: report.dailyExerciseHours !== undefined
      ? Number(report.dailyExerciseHours) || 0
      : Math.round(((Number(report.exerciseHours) || 0) / 365) * 100) / 100,
    highlight: typeof report.highlight === 'string' ? report.highlight : '',
    bookEntries,
    placeEntries,
    customEntries,
  }
}

function normalizeLocks(data: LegacyStoredData): ReportLocks {
  const locks: ReportLocks = {}
  if (data.locks && typeof data.locks === 'object') {
    Object.values(data.locks).forEach((lock) => {
      if (lock && Number.isFinite(Number(lock.year)) && typeof lock.lockedAt === 'string') {
        const year = Number(lock.year)
        locks[year] = { year, lockedAt: lock.lockedAt }
      }
    })
  }
  if (data.lock && Number.isFinite(Number(data.lock.year)) && typeof data.lock.lockedAt === 'string') {
    const year = Number(data.lock.year)
    locks[year] ??= { year, lockedAt: data.lock.lockedAt }
  }
  return locks
}

function normalizeData(data: LegacyStoredData, seed: AnnualReport): StoredData {
  const rawArchive = (data.archive ?? {}) as Record<string, LegacyReport>
  const archive = Object.fromEntries(
    Object.entries(rawArchive).map(([year, report]) => [year, normalizeReport(report)]),
  ) as ReportArchive
  archive[seed.year] ??= normalizeReport(seed)
  const demoMigrationPending = !data.migrations?.demo2025Reset
  const migrationPending = demoMigrationPending || data.version !== 5 || Boolean(data.lock)
  if (demoMigrationPending && isExactDemo2025(rawArchive[2025])) archive[2025] = createBlankReport(2025)
  return {
    version: 5,
    archive,
    locks: normalizeLocks(data),
    ...(data.draft ? { draft: normalizeReport(data.draft) } : {}),
    settings: {
      theme: data.settings?.theme === 'light' || data.settings?.theme === 'oled'
        ? data.settings.theme
        : 'dark',
      accent: accentColorIds.includes(data.settings?.accent as typeof accentColorIds[number])
        ? data.settings!.accent
        : 'leaf',
    },
    migrations: { demo2025Reset: true },
    ...(migrationPending ? { migrationPending: true } : {}),
  }
}

function isExactDemo2025(report?: LegacyReport): boolean {
  return Boolean(report
    && report.year === 2025
    && report.title === 'A year of small distances'
    && report.subtitle === 'Measured in pages, footsteps, commits, and the moments between.'
    && report.books === 24
    && report.places === 11
    && report.steps === 2847631
    && report.codingHours === 914
    && report.photos === 6832
    && report.musicHours === 1260
    && report.sleepAverage === 7.2
    && report.exerciseHours === 186
    && report.highlight === 'I learned that progress rarely announces itself. It accumulates quietly—in a chapter before bed, a walk taken anyway, and one more careful line of code.'
    && (!report.bookEntries || report.bookEntries.length === 0)
    && (!report.placeEntries || report.placeEntries.length === 0))
}

function isNativeRuntime() {
  return typeof window !== 'undefined' && typeof window.NL_PATH === 'string'
}

function nativeDataPath() {
  const separator = window.NL_OS === 'Windows' ? '\\' : '/'
  return {
    directory: `${window.NL_PATH}${separator}data`,
    file: `${window.NL_PATH}${separator}data${separator}annual-report.json`,
  }
}

function readBrowser(seed: AnnualReport): StoredData {
  try {
    const legacy = localStorage.getItem('personal-annual-report')
    const archive = JSON.parse(localStorage.getItem(archiveKey) ?? '{}') as ReportArchive
    if (legacy) {
      const report = JSON.parse(legacy) as AnnualReport
      archive[report.year] ??= report
    }
    archive[seed.year] ??= { ...seed }
    const storedLocks = JSON.parse(localStorage.getItem(lockKey) ?? '{}') as ReportLocks | ReportLock | null
    const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as AnnualReport | null
    const settings = JSON.parse(localStorage.getItem(settingsKey) ?? '{}') as AppSettings
    const lockData = storedLocks && 'year' in storedLocks
      ? { lock: storedLocks as ReportLock }
      : { locks: (storedLocks ?? {}) as ReportLocks }
    return normalizeData({ archive, ...lockData, ...(draft ? { draft } : {}), settings }, seed)
  } catch {
    return normalizeData({ archive: { [seed.year]: seed }, locks: {} }, seed)
  }
}

function writeBrowser(data: StoredData) {
  localStorage.setItem(archiveKey, JSON.stringify(data.archive))
  Object.keys(data.locks).length
    ? localStorage.setItem(lockKey, JSON.stringify(data.locks))
    : localStorage.removeItem(lockKey)
  data.draft ? localStorage.setItem(draftKey, JSON.stringify(data.draft)) : localStorage.removeItem(draftKey)
  localStorage.setItem(settingsKey, JSON.stringify(data.settings))
}

export async function loadStoredData(seed: AnnualReport): Promise<StoredData> {
  if (!isNativeRuntime()) return readBrowser(seed)
  const { file } = nativeDataPath()
  try {
    const raw = await filesystem.readFile(file)
    return normalizeData(JSON.parse(raw) as LegacyStoredData, seed)
  } catch {
    const initial = normalizeData({ archive: { [seed.year]: seed }, locks: {} }, seed)
    await saveStoredData(initial)
    return initial
  }
}

export async function saveStoredData(data: StoredData): Promise<void> {
  const { migrationPending: _migrationPending, ...persistedData } = data
  if (!isNativeRuntime()) {
    writeBrowser(persistedData)
    return
  }
  const { directory, file } = nativeDataPath()
  try {
    await filesystem.createDirectory(directory)
  } catch {
    // Existing data directories are expected after the first save.
  }
  await filesystem.writeFile(file, `${JSON.stringify(persistedData, null, 2)}\n`)
}
