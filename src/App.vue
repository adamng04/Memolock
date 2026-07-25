<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { os } from '@neutralinojs/lib'
import seedReport from './data/annual-report.json'
import countries from './data/countries.json'
import { accentPalette } from './accentPalette'
import { loadStoredData, saveStoredData } from './storage'
import { createBlankReport, isMeaningfulReport } from './types'
import type { AnnualReport, AppSettings, BookEntry, PlaceEntry, ReportArchive, ReportLock } from './types'

const params = new URLSearchParams(window.location.search)
const isSavedView = params.get('report') === 'saved'
const now = new Date()

const archive = reactive<ReportArchive>({ [seedReport.year]: { ...seedReport } })
const availableYears = Object.keys(archive).map(Number)
const selectedYear = ref(Number(params.get('year')) || Math.max(...availableYears))
const cloneReport = (value: AnnualReport): AnnualReport => ({
  ...value,
  bookEntries: value.bookEntries.map((entry) => ({ ...entry })),
  placeEntries: value.placeEntries.map((entry) => ({ ...entry })),
})
const draft = reactive<AnnualReport>(cloneReport(archive[selectedYear.value] ?? seedReport))
const lock = ref<ReportLock | null>(null)
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
const activeLock = computed(() => lock.value && new Date(lock.value.unlockAt) > now ? lock.value : null)
const unlockDate = computed(() => new Date(now.getFullYear() + 1, 0, 1))
const unlockLabel = computed(() => unlockDate.value.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))
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
    lock.value = data.lock && new Date(data.lock.unlockAt) > now ? data.lock : null
    Object.assign(settings, data.settings)
    applyTheme()
    selectedYear.value = Number(params.get('year')) || Math.max(...Object.keys(archive).map(Number))
    Object.assign(draft, data.draft ?? report.value)
    persistedDraft.value = data.draft ? cloneReport(data.draft) : null
    if ((data.lock && !lock.value) || data.migrationPending) await persist()
  } catch (error) {
    storageError.value = error instanceof Error ? error.message : 'Unable to read the local data file.'
  } finally {
    isLoading.value = false
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.new-year-dialog')?.focus())
  }
})

async function persist(includeDraft = false) {
  if (includeDraft) persistedDraft.value = cloneReport(draft)
  await saveStoredData({
    version: 3,
    settings: { ...settings },
    migrations: { demo2025Reset: true },
    archive: { ...archive },
    lock: lock.value,
    ...(persistedDraft.value ? { draft: persistedDraft.value } : {}),
  })
}

function selectYear(year: number) { selectedYear.value = year; sidebarOpen.value = false }
function beginCompletedYearReport() {
  if (activeLock.value || isSavedView) return
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
  if (activeLock.value || isSavedView) return
  Object.assign(draft, cloneReport(report.value))
  saveFeedback.value = ''
  isEditing.value = true
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.editor')?.focus())
}
function openLockReport() {
  if (activeLock.value || isSavedView) return
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
  if (activeLock.value) return
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
  if (activeLock.value) return
  const saved = cloneReport(draft)
  if (saved.placeEntries.some((place) => !place.location.trim() || !place.countryCode)) {
    storageError.value = 'Every detailed place needs a specific location and selected country or region before locking.'
    return
  }
  normalizeOptionalNumbers(saved)
  const savedLock: ReportLock = { year: saved.year, lockedAt: new Date().toISOString(), unlockAt: unlockDate.value.toISOString() }
  archive[saved.year] = saved
  selectedYear.value = saved.year
  lock.value = savedLock
  persistedDraft.value = null
  storageError.value = ''
  try {
    await persist()
    closeEditor()
    if (typeof window.NL_PATH !== 'string') {
      const url = new URL(window.location.href)
      url.searchParams.set('report', 'saved')
      url.searchParams.set('year', String(saved.year))
      window.open(url.toString(), '_blank', 'noopener,noreferrer')
    }
  } catch (error) {
    lock.value = null
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
  <div v-else class="workspace">
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <nav aria-label="Report years">
        <p class="nav-label">Report years</p>
        <button v-for="year in years" :key="year" type="button" :class="{ active: year === selectedYear }" :aria-current="year === selectedYear ? 'page' : undefined" @click="selectYear(year)">
          <span>{{ year }}</span>
        </button>
      </nav>
      <button class="settings-button" type="button" @click="openSettings"><span aria-hidden="true">⚙</span> Settings</button>
      <div class="local-note"><div><strong>Memolock 0.1-rc1</strong><span style="font-size: 12px;">adamngshrine {{ currentYear }}</span></div></div>
    </aside>
    <button v-if="sidebarOpen" class="sidebar-scrim" aria-label="Close year menu" @click="sidebarOpen = false"></button>
    <main>
      <header class="topbar">
        <button class="menu-button" type="button" aria-label="Open year menu" @click="sidebarOpen = true">☰</button>
        <div><p>Annual report</p><h1>{{ report.title || 'Untitled' }}</h1></div>
        <div class="top-actions">
          <span v-if="activeLock" class="lock-status">Locked until {{ new Date(activeLock.unlockAt).toLocaleDateString() }}</span>
          <span v-else-if="isSavedView" class="saved-status">Saved report</span>
          <template v-else>
            <button class="edit-button" type="button" @click="openEditor">Edit report</button>
            <button class="lock-button" type="button" @click="openLockReport">Lock report</button>
          </template>
        </div>
      </header>
      <div class="content">
        <p v-if="storageError" class="storage-error" role="alert">{{ storageError }}</p>
        <section v-if="isEmptyReport" class="empty-callout">
          <div><p>You haven't added an entry in {{ report.year }} yet. Add one now so your journey can take shape.</p></div>
          <button type="button" :disabled="Boolean(activeLock) || isSavedView" @click="openEditor">Add an entry</button>
        </section>
        <section class="metric-grid" aria-label="Annual statistics">
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
        </section>
        <section class="note-card"><div>Quote of the year</div><blockquote>“{{ report.highlight }}”</blockquote></section>
      </div>
    </main>
    <Teleport to="body">
      <div v-if="showNewYearPrompt" class="overlay" @click.self="dismissNewYearPrompt" @keydown.esc="dismissNewYearPrompt">
        <section class="new-year-dialog" role="dialog" aria-modal="true" aria-labelledby="new-year-title" tabindex="-1">
          <button class="prompt-close" type="button" aria-label="Dismiss new year reminder" @click="dismissNewYearPrompt">×</button>
          <h2 id="new-year-title">It's {{ currentYear }}! Time to add your {{ reportYear }} journey</h2>
          <p>Look back on the year you completed.</p>
          <button class="primary" type="button" :disabled="Boolean(activeLock)" @click="beginCompletedYearReport">Start {{ reportYear }} report</button>
          <small v-if="activeLock">Your archive is locked until {{ new Date(activeLock.unlockAt).toLocaleDateString() }}.</small>
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
    <div v-if="isEditing" class="overlay" @click.self="closeEditor">
      <section v-if="!isConfirmingLock" class="editor" role="dialog" aria-modal="true" aria-labelledby="editor-title" tabindex="-1">
        <div class="modal-head"><div><h4>What did you accomplish in {{ reportYear }}?</h4></div><button type="button" aria-label="Close form" @click="closeEditor">×</button></div>
        <form @submit.prevent="saveAndClose">
          <div class="field-grid">
            <label>Report title<input v-model.trim="draft.title" type="text" /></label>
            <label class="wide">Subtitle (optional)<input v-model.trim="draft.subtitle" type="text" /></label>
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
        <span class="lock-icon" aria-hidden="true">!</span><p>Final confirmation</p><h2 id="lock-title">LOCK UNTIL NEXT YEAR</h2>
        <p class="warning-copy">Once saved, no report can be edited or saved again on this device until <strong>{{ unlockLabel }}</strong>.</p>
        <p v-if="storageError" class="storage-error" role="alert">{{ storageError }}</p>
        <div class="lock-date"><span>Unlock date</span><strong>{{ unlockLabel }}</strong></div>
        <label class="confirmation-check"><input type="checkbox" required form="lock-form" /><span>I understand this report will be read-only until the date above.</span></label>
        <form id="lock-form" class="lock-actions" @submit.prevent="confirmAndSave"><button class="secondary" type="button" @click="isConfirmingLock = false">Go back</button><button class="danger" type="submit">LOCK ENTRY</button></form>
      </section>
    </div>
    <div v-if="isSettingsOpen" class="overlay" @click.self="closeSettings" @keydown.esc="closeSettings">
      <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
        <div class="modal-head"><div><p>Application preferences</p><h2 id="settings-title">Settings</h2></div><button type="button" aria-label="Close settings" @click="closeSettings">×</button></div>
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
        <section class="settings-section about"><div><h3>About this app</h3><p>Memolock · version 0.1-rc1</p></div><p>Your annual archive stays in a readable JSON file beside the app. There are no accounts, analytics, or cloud services.</p></section>
        <p v-if="storageError" class="storage-error" role="alert">{{ storageError }}</p>
        <a class="help-button" href="https://adamngshrine.com/index/miscs/memolock" @click.prevent="openHelp"><span>Help desk</span><small>↗</small></a>
      </section>
    </div>
  </div>
</template>
