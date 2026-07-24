// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import seedReport from './data/annual-report.json'
import { loadStoredData, saveStoredData, type StoredData } from './storage'
import { createBlankReport } from './types'

const legacyDemo2025 = {
  year: 2025,
  title: 'A year of small distances',
  subtitle: 'Measured in pages, footsteps, commits, and the moments between.',
  books: 24,
  places: 11,
  steps: 2847631,
  codingHours: 914,
  photos: 6832,
  musicHours: 1260,
  sleepAverage: 7.2,
  exerciseHours: 186,
  highlight: 'I learned that progress rarely announces itself. It accumulates quietly—in a chapter before bed, a walk taken anyway, and one more careful line of code.',
  bookEntries: [],
  placeEntries: [],
}

const nativeFilesystem = vi.hoisted(() => ({
  createDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@neutralinojs/lib', () => ({ filesystem: nativeFilesystem }))

afterEach(() => {
  delete window.NL_PATH
  delete window.NL_OS
  localStorage.clear()
  vi.clearAllMocks()
})

function installNativeFilesystem() {
  nativeFilesystem.createDirectory.mockResolvedValue(undefined)
  nativeFilesystem.writeFile.mockResolvedValue(undefined)
  window.NL_PATH = 'C:\\Portable\\YearInData'
  window.NL_OS = 'Windows'
  return nativeFilesystem
}

describe('portable report storage', () => {
  it('loads the JSON archive beside the portable executable data directory', async () => {
    const stored: StoredData = {
      version: 3,
      archive: { 2024: { ...seedReport, year: 2024, title: 'Native archive' } },
      lock: null,
      settings: { theme: 'dark', accent: 'navy' },
    }
    const filesystem = installNativeFilesystem()
    filesystem.readFile.mockResolvedValue(JSON.stringify(stored))

    const result = await loadStoredData(seedReport)

    expect(filesystem.readFile).toHaveBeenCalledWith(
      'C:\\Portable\\YearInData\\data\\annual-report.json',
    )
    expect(result.archive[2024].title).toBe('Native archive')
    expect(result.archive[seedReport.year]).toMatchObject(seedReport)
  })

  it('creates the portable data directory and writes formatted local JSON', async () => {
    const filesystem = installNativeFilesystem()
    const data: StoredData = {
      version: 3,
      archive: { [seedReport.year]: seedReport },
      lock: null,
      draft: { ...seedReport, books: 30 },
      settings: { theme: 'dark', accent: 'navy' },
    }

    await saveStoredData(data)

    expect(filesystem.createDirectory).toHaveBeenCalledWith('C:\\Portable\\YearInData\\data')
    expect(filesystem.writeFile).toHaveBeenCalledWith(
      'C:\\Portable\\YearInData\\data\\annual-report.json',
      `${JSON.stringify(data, null, 2)}\n`,
    )
  })

  it('initializes a seed JSON file when no native archive exists', async () => {
    const filesystem = installNativeFilesystem()
    filesystem.readFile.mockRejectedValue(new Error('missing file'))

    const result = await loadStoredData(seedReport)

    expect(result).toEqual({
      version: 3,
      archive: { [seedReport.year]: seedReport },
      lock: null,
      settings: { theme: 'dark', accent: 'leaf' },
      migrations: { demo2025Reset: true },
      migrationPending: true,
    })
    expect(filesystem.writeFile).toHaveBeenCalledOnce()
  })

  it('migrates v2 annual totals to the explicit v3 daily schema and removes obsolete keys', async () => {
    const filesystem = installNativeFilesystem()
    const bookEntries = [{ id: 'b1', title: 'Piranesi', author: 'Susanna Clarke' }]
    const placeEntries = [{ id: 'p1', location: 'Kyoto', countryCode: 'JP', countryName: 'Japan' }]
    const v2Report = {
      year: 2024,
      title: 'Migrated year',
      subtitle: 'Legacy metrics',
      books: 99,
      places: 88,
      steps: 3650,
      codingHours: 914,
      photos: 6832,
      musicHours: 1260,
      sleepAverage: 7.2,
      exerciseHours: 365,
      highlight: 'Preserve me',
      bookEntries,
      placeEntries,
    }
    filesystem.readFile.mockResolvedValue(JSON.stringify({
      version: 2,
      archive: { 2024: v2Report },
      lock: null,
      draft: { ...v2Report, steps: 730, exerciseHours: 182.5 },
      settings: { theme: 'dark' },
    }))

    const result = await loadStoredData(seedReport)

    expect(result.version).toBe(3)
    expect(result.settings).toEqual({ theme: 'dark', accent: 'leaf' })
    expect(result.archive[2024]).toMatchObject({
      books: 1,
      places: 1,
      stepsPerDay: 10,
      albumsListened: 0,
      averageDailySleepHours: 7.2,
      dailyExerciseHours: 1,
      highlight: 'Preserve me',
      bookEntries,
      placeEntries,
    })
    expect(result.archive[2024]).not.toHaveProperty('codingHours')
    expect(result.archive[2024]).not.toHaveProperty('photos')
    expect(result.archive[2024]).not.toHaveProperty('musicHours')
    expect(result.archive[2024]).not.toHaveProperty('steps')
    expect(result.archive[2024]).not.toHaveProperty('exerciseHours')
    expect(result.draft).toMatchObject({
      stepsPerDay: 2,
      albumsListened: 0,
      averageDailySleepHours: 7.2,
      dailyExerciseHours: 0.5,
    })
    expect(result.migrationPending).toBe(true)
  })

  it('resets only the exact legacy demo while preserving settings, lock, draft, and other years', async () => {
    const filesystem = installNativeFilesystem()
    const lock = {
      year: 2024,
      lockedAt: '2025-12-31T00:00:00.000Z',
      unlockAt: '2027-01-01T00:00:00.000Z',
    }
    const draft = { ...createBlankReport(2026), highlight: 'Still writing' }
    filesystem.readFile.mockResolvedValue(JSON.stringify({
      version: 2,
      archive: {
        2024: { ...createBlankReport(2024), stepsPerDay: 123 },
        2025: legacyDemo2025,
      },
      lock,
      draft,
      settings: { theme: 'dark', accent: 'berry' },
    }))

    const result = await loadStoredData(seedReport)

    expect(result.archive[2025]).toEqual(createBlankReport(2025))
    expect(result.archive[2024].stepsPerDay).toBe(123)
    expect(result.settings).toEqual({ theme: 'dark', accent: 'berry' })
    expect(result.lock).toEqual(lock)
    expect(result.draft).toMatchObject({ year: 2026, highlight: 'Still writing' })
    expect(result.migrations).toEqual({ demo2025Reset: true })
    expect(result.migrationPending).toBe(true)
  })

  it('never erases a user report that differs from the demo fingerprint', async () => {
    const filesystem = installNativeFilesystem()
    filesystem.readFile.mockResolvedValue(JSON.stringify({
      version: 2,
      archive: { 2025: { ...legacyDemo2025, highlight: 'My own irreplaceable note' } },
      lock: null,
      settings: { theme: 'light', accent: 'invalid-color' },
    }))

    const result = await loadStoredData(seedReport)

    expect(result.archive[2025]).toMatchObject({
      books: 0,
      places: 0,
      stepsPerDay: 7801.7,
      albumsListened: 0,
      averageDailySleepHours: 7.2,
      dailyExerciseHours: 0.51,
      highlight: 'My own irreplaceable note',
    })
    expect(result.archive[2025]).not.toHaveProperty('codingHours')
    expect(result.archive[2025]).not.toHaveProperty('photos')
    expect(result.settings).toEqual({ theme: 'light', accent: 'leaf' })
  })

  it('normalizes legacy book ratings to whole numbers between zero and ten', async () => {
    const filesystem = installNativeFilesystem()
    filesystem.readFile.mockResolvedValue(JSON.stringify({
      version: 3,
      archive: {
        2024: {
          ...createBlankReport(2024),
          bookEntries: [
            { id: 'low', title: 'Low', rating: -5 },
            { id: 'rounded', title: 'Rounded', rating: 4.6 },
            { id: 'high', title: 'High', rating: 99 },
            { id: 'huge', title: 'Huge', rating: 11111 },
          ],
        },
      },
      lock: null,
    }))

    const result = await loadStoredData(seedReport)

    expect(result.archive[2024].bookEntries.map((book) => book.rating)).toEqual([0, 5, 10, 10])
  })

  it('preserves OLED and legacy light themes while invalid or missing themes default dark', async () => {
    const filesystem = installNativeFilesystem()
    for (const [theme, expected] of [
      ['oled', 'oled'],
      ['light', 'light'],
      ['dark', 'dark'],
      ['sepia', 'dark'],
      [undefined, 'dark'],
    ] as const) {
      filesystem.readFile.mockResolvedValueOnce(JSON.stringify({
        version: 3,
        archive: { [seedReport.year]: seedReport },
        lock: null,
        settings: { ...(theme ? { theme } : {}), accent: 'leaf' },
        migrations: { demo2025Reset: true },
      }))
      const result = await loadStoredData(seedReport)
      expect(result.settings.theme).toBe(expected)
    }
  })
})
