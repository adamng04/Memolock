export interface BookEntry {
  id: string
  title: string
  author: string
  finishedDate?: string
  rating?: number
}

export interface PlaceEntry {
  id: string
  location: string
  countryCode: string
  countryName: string
  visitedDate?: string
}

export interface AnnualReport {
  year: number
  title: string
  subtitle: string
  books: number
  places: number
  stepsPerDay: number
  albumsListened: number
  averageDailySleepHours: number
  dailyExerciseHours: number
  highlight: string
  bookEntries: BookEntry[]
  placeEntries: PlaceEntry[]
}

export type ReportArchive = Record<number, AnnualReport>

export interface ReportLock {
  year: number
  lockedAt: string
  unlockAt: string
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'oled'
  accent: AccentColorId
}

export const accentColorIds = [
  'rose', 'coral', 'orange', 'amber', 'gold', 'lime',
  'leaf', 'emerald', 'teal', 'cyan', 'sky', 'blue',
  'indigo', 'violet', 'purple', 'magenta', 'pink', 'berry',
  'red', 'brick', 'cocoa', 'sand', 'olive', 'forest',
  'ocean', 'navy', 'slate', 'lavender', 'mint', 'graphite',
] as const

export type AccentColorId = typeof accentColorIds[number]

export function createBlankReport(year: number): AnnualReport {
  return {
    year,
    title: '',
    subtitle: '',
    books: 0,
    places: 0,
    stepsPerDay: 0,
    albumsListened: 0,
    averageDailySleepHours: 0,
    dailyExerciseHours: 0,
    highlight: '',
    bookEntries: [],
    placeEntries: [],
  }
}

export function isMeaningfulReport(report: AnnualReport): boolean {
  return report.books > 0
    || report.places > 0
    || report.stepsPerDay > 0
    || report.albumsListened > 0
    || report.averageDailySleepHours > 0
    || report.dailyExerciseHours > 0
    || report.bookEntries.length > 0
    || report.placeEntries.length > 0
    || report.highlight.trim().length > 0
}
