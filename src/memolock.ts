import { filesystem, os } from '@neutralinojs/lib'
import { normalizeReport } from './storage'
import type { AnnualReport, ReportLock } from './types'

export const memolockFormat = 'memolock-report' as const
export const memolockFormatVersion = 1 as const

export interface MemolockDocument {
  format: typeof memolockFormat
  formatVersion: typeof memolockFormatVersion
  exportedAt: string
  status: {
    code: 'LOCKED' | 'UNLOCKED'
    locked: boolean
    lockedAt: string | null
  }
  report: AnnualReport
}

export type MemolockConflictAction = 'copy' | 'overwrite'
export type MemolockExportResult =
  | { status: 'exported'; path: string }
  | { status: 'conflict'; path: string }

function cloneReport(report: AnnualReport): AnnualReport {
  return {
    ...report,
    bookEntries: report.bookEntries.map((entry) => ({ ...entry })),
    placeEntries: report.placeEntries.map((entry) => ({ ...entry })),
    customEntries: report.customEntries.map((entry) => ({ ...entry })),
  }
}

export function createMemolockDocument(report: AnnualReport, lock?: ReportLock | null): MemolockDocument {
  const locked = Boolean(lock)
  return {
    format: memolockFormat,
    formatVersion: memolockFormatVersion,
    exportedAt: new Date().toISOString(),
    status: {
      code: locked ? 'LOCKED' : 'UNLOCKED',
      locked,
      lockedAt: lock?.lockedAt ?? null,
    },
    report: cloneReport(report),
  }
}

export function serializeMemolockDocument(report: AnnualReport, lock?: ReportLock | null): string {
  return `${JSON.stringify(createMemolockDocument(report, lock), null, 2)}\n`
}

export function parseMemolockDocument(raw: string): MemolockDocument {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('This file is not valid Memolock JSON.')
  }
  if (!value || typeof value !== 'object') throw new Error('This file is not a Memolock report.')
  const document = value as Partial<MemolockDocument>
  if (document.format !== memolockFormat || document.formatVersion !== memolockFormatVersion) {
    throw new Error('This file uses an unsupported Memolock format.')
  }
  if (!document.status || typeof document.status !== 'object' || typeof document.status.locked !== 'boolean') {
    throw new Error('This Memolock file has no valid lock status.')
  }
  const expectedCode = document.status.locked ? 'LOCKED' : 'UNLOCKED'
  if (document.status.code !== expectedCode) throw new Error('This Memolock file has an inconsistent lock status code.')
  if (document.status.locked && typeof document.status.lockedAt !== 'string') {
    throw new Error('This locked Memolock file has no lock date.')
  }
  if (!document.report || typeof document.report !== 'object') throw new Error('This Memolock file has no report data.')
  const year = Number(document.report.year)
  if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error('This Memolock file has an invalid report year.')
  return {
    format: memolockFormat,
    formatVersion: memolockFormatVersion,
    exportedAt: typeof document.exportedAt === 'string' ? document.exportedAt : new Date(0).toISOString(),
    status: {
      code: expectedCode,
      locked: document.status.locked,
      lockedAt: document.status.locked ? document.status.lockedAt as string : null,
    },
    report: normalizeReport(document.report),
  }
}

function isNativeRuntime() {
  return typeof window !== 'undefined' && typeof window.NL_PATH === 'string'
}

function pathSeparator() {
  return window.NL_OS === 'Windows' ? '\\' : '/'
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await filesystem.getStats(path)
    return stats.isFile
  } catch {
    return false
  }
}

export async function exportMemolockReport(
  report: AnnualReport,
  lock: ReportLock,
  conflictAction?: MemolockConflictAction,
): Promise<MemolockExportResult> {
  const filename = `${report.year}_report.memolock`
  const contents = serializeMemolockDocument(report, lock)
  if (!isNativeRuntime()) {
    if (typeof URL.createObjectURL !== 'function') return { status: 'exported', path: filename }
    const blob = new Blob([contents], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
    return { status: 'exported', path: filename }
  }

  const separator = pathSeparator()
  const profileVariable = window.NL_OS === 'Windows' ? 'USERPROFILE' : 'HOME'
  const profile = await os.getEnv(profileVariable)
  if (!profile) throw new Error('Your Documents folder could not be located.')
  const directory = `${profile}${separator}Documents${separator}Memolock`
  const file = `${directory}${separator}${filename}`
  try {
    await filesystem.createDirectory(directory)
  } catch {
    // The export directory normally already exists after the first report.
  }
  const existing = await fileExists(file)
  if (existing && !conflictAction) {
    return { status: 'conflict', path: `Documents${separator}Memolock${separator}${filename}` }
  }

  let outputFile = file
  let outputFilename = filename
  if (existing && conflictAction === 'copy') {
    for (let index = 1; index <= 9999; index += 1) {
      const candidateFilename = `${report.year}_report (${index}).memolock`
      const candidate = `${directory}${separator}${candidateFilename}`
      if (!await fileExists(candidate)) {
        outputFile = candidate
        outputFilename = candidateFilename
        break
      }
      if (index === 9999) throw new Error('No available numbered Memolock filename was found.')
    }
  }
  await filesystem.writeFile(outputFile, contents)
  return { status: 'exported', path: `Documents${separator}Memolock${separator}${outputFilename}` }
}

export async function chooseMemolockFile(): Promise<{ name: string; contents: string } | null> {
  const paths = await os.showOpenDialog('Import a Memolock report', {
    filters: [{ name: 'Memolock reports', extensions: ['memolock'] }],
    multiSelections: false,
  })
  const path = paths[0]
  if (!path) return null
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    contents: await filesystem.readFile(path),
  }
}
