// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import seedReport from './data/annual-report.json'
import countries from './data/countries.json'
import { createBlankReport } from './types'

const styles = readFileSync('src/styles.css', 'utf8')
const packageManifest = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string; version: string }
const neutralinoConfig = JSON.parse(readFileSync('neutralino.config.json', 'utf8')) as {
  applicationId: string
  version: string
  cli: { binaryName: string }
  modes: { window: { title: string } }
}
const indexHtml = readFileSync('index.html', 'utf8')

const nativeApi = vi.hoisted(() => ({
  app: { exit: vi.fn() },
  os: { open: vi.fn() },
  window: { minimize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn() },
  events: { on: vi.fn(), off: vi.fn() },
  filesystem: {
    createDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}))
vi.mock('@neutralinojs/lib', () => nativeApi)

const archiveKey = 'personal-annual-report-archive'
const lockKey = `${archiveKey}:lock`
const draftKey = `${archiveKey}:draft`
const settingsKey = `${archiveKey}:settings`

async function mountApp(search = '', dismissNewYear = true) {
  window.history.replaceState({}, '', `/${search}`)
  vi.resetModules()
  const { default: App } = await import('./App.vue')
  const wrapper = mount(App)
  await flushPromises()
  if (dismissNewYear) {
    document.querySelector<HTMLButtonElement>('[aria-label="Dismiss new year reminder"]')?.click()
    await flushPromises()
  }
  return wrapper
}

function inputFor(wrapper: Awaited<ReturnType<typeof mountApp>>, labelText: string) {
  const label = wrapper.findAll('label').find((item) => item.text().includes(labelText))
  if (!label) throw new Error(`Could not find field "${labelText}"`)
  return label.find('input, textarea')
}

function buttonWithText(wrapper: Awaited<ReturnType<typeof mountApp>>, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text().includes(text))
  if (!button) throw new Error(`Could not find button "${text}"`)
  return button
}

function dialogInputFor(labelText: string) {
  const label = [...document.querySelectorAll<HTMLLabelElement>('.entry-dialog label')]
    .find((item) => item.textContent?.includes(labelText))
  if (!label) throw new Error(`Could not find entry field "${labelText}"`)
  return label.querySelector<HTMLInputElement>('input')!
}

function clickDialogButton(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.entry-dialog button')]
    .find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`Could not find entry button "${text}"`)
  button.click()
}

async function editCurrentYear(wrapper: Awaited<ReturnType<typeof mountApp>>) {
  await wrapper.get('.edit-button').trigger('click')
}

describe('personal annual report', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-23T10:00:00Z'))
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-accent')
    document.documentElement.style.removeProperty('color-scheme')
    document.documentElement.style.removeProperty('--accent-swatch')
    document.documentElement.style.removeProperty('--accent-action')
    delete window.NL_PATH
    delete window.NL_OS
    nativeApi.os.open.mockResolvedValue(undefined)
    nativeApi.filesystem.createDirectory.mockResolvedValue(undefined)
    nativeApi.filesystem.writeFile.mockResolvedValue(undefined)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    window.history.replaceState({}, '', '/')
  })

  it('starts with a zeroed 2025 report and a clear empty-state action', async () => {
    expect(seedReport).toEqual(createBlankReport(2025))
    const wrapper = await mountApp()

    expect(wrapper.get('.topbar').text()).toContain('Add a title here')
    expect(wrapper.get('.empty-callout').text()).toContain("You haven't added an entry in 2025 yet")
    expect(wrapper.get('.empty-callout button').text()).toBe('Add an entry')
    expect(wrapper.findAll('.metric-card')).toHaveLength(6)
    expect(wrapper.findAll('.metric-card').every((card) => /^0h?$/.test(card.get('strong').text()))).toBe(true)
  })

  it('shows a 2026 reminder for completed year 2025 and dismisses without creating 2026', async () => {
    const wrapper = await mountApp('', false)
    const prompt = document.querySelector<HTMLElement>('.new-year-dialog')!

    expect(prompt.getAttribute('role')).toBe('dialog')
    expect(prompt.getAttribute('aria-modal')).toBe('true')
    expect(prompt.textContent).toContain("It's 2026")
    expect(prompt.textContent).toContain('Start 2025 report')
    expect(wrapper.get('.topbar').text()).toContain('2025')

    prompt.querySelector<HTMLButtonElement>('[aria-label="Dismiss new year reminder"]')!.click()
    await flushPromises()
    expect(document.querySelector('.new-year-dialog')).toBeNull()
    expect(wrapper.findAll('nav button').some((button) => button.text().includes('2026'))).toBe(false)
  })

  it('starts completed year 2025 only and keeps the sidebar year-only', async () => {
    const wrapper = await mountApp('', false)
    document.querySelector<HTMLButtonElement>('.new-year-dialog .primary')!.click()
    await flushPromises()

    expect(document.querySelector('.new-year-dialog')).toBeNull()
    expect(wrapper.get('.topbar').text()).toContain('Add a title here')
    expect(wrapper.findAll('nav button').some((button) => button.text().includes('2026'))).toBe(false)
    expect(wrapper.get('nav').text()).not.toContain('logged')
    expect(wrapper.get('.year-display').text()).toContain('2025')
    expect(wrapper.find('.year-display input').exists()).toBe(false)
    expect(wrapper.findAll('.entry-launcher')).toHaveLength(2)
    expect(wrapper.findAll('label').some((label) => label.text() === 'Books read')).toBe(false)
    expect(wrapper.findAll('label').some((label) => label.text() === 'Places visited')).toBe(false)
    expect(JSON.parse(localStorage.getItem(archiveKey) ?? '{}')['2026']).toBeUndefined()
  })

  it('keeps prompting for blank 2025 but stops after meaningful 2025 data exists', async () => {
    localStorage.setItem(archiveKey, JSON.stringify({ 2025: seedReport, 2026: createBlankReport(2026) }))
    const blank = await mountApp('', false)
    expect(document.querySelector('.new-year-dialog')).not.toBeNull()
    document.querySelector<HTMLButtonElement>('[aria-label="Dismiss new year reminder"]')!.click()
    await flushPromises()
    blank.unmount()

    localStorage.setItem(archiveKey, JSON.stringify({
      2026: createBlankReport(2026),
      2025: { ...createBlankReport(2025), stepsPerDay: 1 },
    }))
    const meaningful = await mountApp('', false)
    expect(document.querySelector('.new-year-dialog')).toBeNull()
    expect(meaningful.get('.topbar').text()).toContain('2026')
  })

  it('targets 2026 in 2027 and preserves every preexisting archive year', async () => {
    vi.setSystemTime(new Date('2027-07-23T10:00:00Z'))
    localStorage.setItem(archiveKey, JSON.stringify({
      2023: { ...createBlankReport(2023), stepsPerDay: 3 },
      2024: { ...createBlankReport(2024), albumsListened: 4 },
    }))
    const wrapper = await mountApp('', false)
    expect(document.querySelector('.new-year-dialog')?.textContent).toContain('Start 2026 report')
    document.querySelector<HTMLButtonElement>('.new-year-dialog .primary')!.click()
    await flushPromises()

    expect(wrapper.get('.year-display').text()).toContain('2026')
    expect(wrapper.find('.year-display input').exists()).toBe(false)
    const sidebar = wrapper.get('nav').text()
    expect(sidebar).toContain('2023')
    expect(sidebar).toContain('2024')
    expect(sidebar).toContain('2025')
    expect(sidebar).toContain('2026')
    expect(sidebar).not.toContain('logged')
  })

  it('defaults to dark mode and restores backward-compatible dark settings', async () => {
    const first = await mountApp()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    await first.get('.settings-button').trigger('click')
    expect(first.get('.settings-panel').text()).toContain('About this app')
    expect(first.get('.settings-panel').text()).toContain('no accounts, analytics, or cloud services')
    expect(first.findAll('.theme-control button').map((button) => button.text())).toEqual(['Light', 'Dark', 'OLED'])

    await buttonWithText(first, 'Dark').trigger('click')
    await flushPromises()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(JSON.parse(localStorage.getItem(settingsKey) ?? '{}')).toEqual({ theme: 'dark', accent: 'leaf' })
    first.unmount()

    const restored = await mountApp()
    expect(document.documentElement.dataset.theme).toBe('dark')
    await restored.get('.settings-button').trigger('click')
    expect(buttonWithText(restored, 'Dark').attributes('aria-pressed')).toBe('true')
  })

  it('persists and restores the true-black OLED theme', async () => {
    const first = await mountApp()
    await first.get('.settings-button').trigger('click')
    await buttonWithText(first, 'OLED').trigger('click')
    await flushPromises()

    expect(document.documentElement.dataset.theme).toBe('oled')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(buttonWithText(first, 'OLED').attributes('aria-pressed')).toBe('true')
    expect(JSON.parse(localStorage.getItem(settingsKey) ?? '{}')).toEqual({ theme: 'oled', accent: 'leaf' })
    first.unmount()

    const restored = await mountApp()
    expect(document.documentElement.dataset.theme).toBe('oled')
    await restored.get('.settings-button').trigger('click')
    expect(buttonWithText(restored, 'OLED').attributes('aria-pressed')).toBe('true')
    expect(styles).toContain('[data-theme="oled"]')
    expect(styles).toContain('--page: #000;')
    expect(styles).toContain('--surface: #000;')
    expect(styles).toContain('[data-theme="oled"] body, [data-theme="oled"] .loading-state, [data-theme="oled"] .content')
    expect(styles).toContain('[data-theme="oled"] .overlay')
    expect(styles).toContain('background: #000d;')
    expect(styles).toContain('[data-theme="oled"] .lock-status')
    expect(styles).toContain('[data-theme="oled"] .saved-status')
    expect(styles).toContain('color: var(--success-text);')
    expect(styles).toContain('background: var(--success-surface)')
    expect(styles).toContain('[data-theme="oled"] .lock-date')
    expect(styles).toContain('color: var(--text);')
    expect(styles).toContain('background: var(--surface-muted);')
    expect(styles).toContain('border-color: var(--line);')
    expect(styles).toContain('[data-theme="oled"] .new-year-dialog')
    expect(styles).toContain('[data-theme="oled"] .save-feedback')
  })

  it('focuses Settings and restores its trigger after button, Escape, or backdrop dismissal', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0))
      return 1
    })
    const wrapper = await mountApp()
    document.body.appendChild(wrapper.element)
    const trigger = wrapper.get<HTMLButtonElement>('.settings-button')

    await trigger.trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('.settings-panel').element)
    expect(wrapper.get('.settings-panel').attributes('tabindex')).toBe('-1')
    await wrapper.get('button[aria-label="Close settings"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.settings-panel').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)

    await trigger.trigger('click')
    await flushPromises()
    await wrapper.get('.settings-panel').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('.settings-panel').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)

    await trigger.trigger('click')
    await flushPromises()
    await wrapper.get('.settings-panel').element.parentElement!.click()
    await flushPromises()
    expect(wrapper.find('.settings-panel').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
  })

  it('renders exactly 30 accessible accents and persists personalization across launches', async () => {
    const first = await mountApp()
    await first.get('.settings-button').trigger('click')
    const swatches = first.findAll('.accent-choice')
    expect(swatches).toHaveLength(30)
    expect(new Set(swatches.map((swatch) => swatch.attributes('aria-label'))).size).toBe(30)
    expect(swatches.filter((swatch) => swatch.attributes('aria-pressed') === 'true')).toHaveLength(1)
    expect(first.get('button[aria-label="Leaf accent"]').attributes('aria-pressed')).toBe('true')

    await first.get('button[aria-label="Navy accent"]').trigger('click')
    await flushPromises()
    expect(document.documentElement.dataset.accent).toBe('navy')
    expect(document.documentElement.style.getPropertyValue('--accent-swatch')).toBe('#556b8e')
    expect(JSON.parse(localStorage.getItem(settingsKey) ?? '{}')).toEqual({ theme: 'dark', accent: 'navy' })
    first.unmount()

    const restored = await mountApp()
    expect(document.documentElement.dataset.accent).toBe('navy')
    await restored.get('.settings-button').trigger('click')
    expect(restored.get('button[aria-label="Navy accent"]').attributes('aria-pressed')).toBe('true')
  })

  it('opens the exact help URL with the Neutralino OS API in native mode', async () => {
    const wrapper = await mountApp()
    window.NL_PATH = 'C:\\Portable\\YearInData'
    await wrapper.get('.settings-button').trigger('click')
    await wrapper.get('.help-button').trigger('click')
    await flushPromises()

    expect(nativeApi.os.open).toHaveBeenCalledOnce()
    expect(nativeApi.os.open).toHaveBeenCalledWith('https://adamngshrine.com')
  })

  it('uses Memolock branding without sidebar identity or metric code badges', async () => {
    const wrapper = await mountApp()
    expect(wrapper.find('.identity').exists()).toBe(false)
    expect(wrapper.find('.logo').exists()).toBe(false)
    expect(wrapper.find('.symbol').exists()).toBe(false)
    expect(wrapper.findAll('.metric-affordance').map((item) => item.text())).toEqual([
      expect.stringContaining('View details'),
      expect.stringContaining('View details'),
    ])
    await wrapper.get('.settings-button').trigger('click')
    expect(wrapper.get('.settings-panel').text()).toContain('Memolock · version 0.1-rc1')
    expect(wrapper.text()).not.toContain('Year in Data')
  })

  it('opens independent, accessible Books and Places detail dialogs and closes them explicitly', async () => {
    localStorage.setItem(archiveKey, JSON.stringify({
      2025: {
        ...seedReport,
        bookEntries: [{ id: 'b1', title: 'The Dispossessed', author: 'Ursula K. Le Guin', rating: 5 }],
        placeEntries: [{ id: 'p1', location: 'Kyoto', countryCode: 'JP', countryName: 'Japan' }],
      },
    }))
    const wrapper = await mountApp()
    const books = wrapper.findAll('.metric-card').find((card) => card.text().includes('Books read'))!
    const places = wrapper.findAll('.metric-card').find((card) => card.text().includes('Places visited'))!

    expect(books.element.tagName).toBe('BUTTON')
    expect(books.attributes()).toMatchObject({
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-controls': 'books-detail',
    })
    await books.trigger('click')
    await flushPromises()
    const booksDialog = document.querySelector<HTMLElement>('#books-detail')!
    expect(books.attributes('aria-expanded')).toBe('true')
    expect(booksDialog.getAttribute('role')).toBe('dialog')
    expect(booksDialog.getAttribute('aria-modal')).toBe('true')
    expect(booksDialog.getAttribute('aria-labelledby')).toBe('books-detail-title')
    expect(booksDialog.textContent).toContain('The Dispossessed')
    expect(booksDialog.textContent).toContain('Ursula K. Le Guin')
    expect(booksDialog.textContent).not.toContain('Kyoto')

    booksDialog.querySelector<HTMLButtonElement>('button[aria-label="Close books details"]')!.click()
    await flushPromises()
    expect(document.querySelector('#books-detail')).toBeNull()
    expect(books.attributes('aria-expanded')).toBe('false')

    expect(places.attributes('aria-haspopup')).toBe('dialog')
    await places.trigger('click')
    await flushPromises()
    const placesDialog = document.querySelector<HTMLElement>('#places-detail')!
    expect(placesDialog.textContent).toContain('Kyoto')
    expect(placesDialog.textContent).toContain('Japan')
    expect(placesDialog.textContent).not.toContain('The Dispossessed')
    placesDialog.querySelector<HTMLButtonElement>('button[aria-label="Close places details"]')!.click()
    await flushPromises()
  })

  it('keeps detail dialogs open for inside clicks and closes on backdrop or Escape', async () => {
    const wrapper = await mountApp()
    const books = wrapper.findAll('.metric-card').find((card) => card.text().includes('Books read'))!

    await books.trigger('click')
    await flushPromises()
    document.querySelector<HTMLElement>('.detail-dialog')!.click()
    await flushPromises()
    expect(document.querySelector('#books-detail')).not.toBeNull()

    document.querySelector<HTMLElement>('.detail-dialog')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(document.querySelector('#books-detail')).toBeNull()

    await books.trigger('click')
    await flushPromises()
    document.querySelector<HTMLElement>('.overlay')!.click()
    await flushPromises()
    expect(document.querySelector('#books-detail')).toBeNull()
  })

  it('uses the shared six-pixel corner token while preserving circular controls', () => {
    expect(styles).toContain('--radius: 6px;')
    expect(styles).toContain('border-radius: var(--radius);')
    expect(styles).toContain('border-radius: 50%;')
    expect(styles).not.toContain('.local-note>span')
  })

  it('uses locally bundled Merriweather everywhere without a monospace stack', () => {
    expect(styles).toContain('@import "@fontsource/merriweather/latin-400.css"')
    expect(styles).toContain('@import "@fontsource/merriweather/vietnamese-700.css"')
    expect(styles).not.toMatch(/https?:\/\/|monospace/i)
    expect(styles).toContain('--font-sans: "Merriweather", serif;')
    expect(styles).toContain('--font-mono: "Merriweather", serif;')
  })

  it('applies the readable typography floor to standard interface text', () => {
    expect(styles).toContain('/* Readable application typography and true-black OLED surfaces */')
    expect(styles).toContain(':root {\n  font-size: 16px;')
    expect(styles).toContain('.topbar p, .modal-head p, .lock-panel > p:first-of-type, .lock-date span, .empty-callout small {\n  font-size: 12px;')
    expect(styles).toContain('.secondary, .primary, .danger, .edit-button, .lock-button, .settings-button, .theme-control button, .empty-callout button, .new-year-dialog > .primary {\n  font-size: 13px;')
    expect(styles).toContain('label {\n  font-size: 13px;')
    expect(styles).toContain('.metric-card h2 {\n  font-size: 16px;')
    expect(styles).toContain('.field-grid label > span, .entry-dialog label > span, .new-year-dialog > small, .rating-suffix {\n  font-size: 12px;')
  })

  it('uses the borderless active, muted, hover, and disabled button tokens', () => {
    expect(styles).toContain('--button-active: #26352d;')
    expect(styles).toContain('--button-muted: #e2e4df;')
    expect(styles).toContain('--button-hover: #d5d8d2;')
    expect(styles).toContain('button, .help-button {\n  border: 0 !important;')
    expect(styles).toContain('button:not(:disabled):not(.sidebar-scrim):hover, .help-button:hover')
    expect(styles).toContain('button:active, .help-button:active')
    expect(styles).toContain('button:disabled {\n  cursor: not-allowed;\n  opacity: .48;')
    expect(styles).toContain('button:not(:disabled):not(.sidebar-scrim):hover, .help-button:hover')
    expect(styles).toContain('transition: background-color .16s ease, color .16s ease;')
    expect(styles).toContain('transform: none !important;')
    expect(styles).toContain('--button-active-text: #fff;')
    expect(styles).toContain('--button-muted-text: #f0f0f0;')
  })

  it('keeps country choices unclipped and light with readable dark text in dark mode', () => {
    expect(styles).toContain('.entry-dialog {\n  overflow: visible;\n  max-height: none;')
    expect(styles).toContain('--option-surface: #f0f0f0;')
    expect(styles).toContain('--option-text: #1a1a1a;')
    expect(styles).toContain('color: var(--option-text) !important;')
    expect(styles).toContain('background: var(--option-surface) !important;')
  })

  it('shows the six-field v3 editor and separates saving from locking', async () => {
    const wrapper = await mountApp()
    expect(wrapper.get('.edit-button').text()).toBe('Edit report')
    expect(wrapper.get('.lock-button').text()).toBe('Lock report')
    await wrapper.get('.edit-button').trigger('click')

    expect(wrapper.findAll('.entry-launcher').map((button) => button.text())).toEqual([
      expect.stringContaining("Add books you've read"),
      expect.stringContaining("Add places & countries you've visited"),
    ])
    expect(wrapper.findAll('label').some((label) => label.text() === 'Books read')).toBe(false)
    expect(wrapper.findAll('label').some((label) => label.text() === 'Places visited')).toBe(false)
    expect(wrapper.get('.year-display').attributes('aria-label')).toBe('Report year, locked')
    expect(wrapper.get('.year-display').text()).toContain('2025')
    expect(wrapper.find('.editor input[type="number"][min="1900"]').exists()).toBe(false)
    expect(inputFor(wrapper, 'Average steps per day').attributes('required')).toBeDefined()
    expect(inputFor(wrapper, 'Albums listened').attributes('required')).toBeDefined()
    expect(inputFor(wrapper, 'Average daily sleep').attributes('required')).toBeDefined()
    expect(inputFor(wrapper, 'Daily exercise').attributes('required')).toBeDefined()
    expect(wrapper.text()).not.toContain('Coding activity')
    expect(wrapper.text()).not.toContain('Photos taken')
    expect(wrapper.text()).not.toContain('Review & lock')
    expect(wrapper.text()).not.toContain('Temporary save')
    expect(wrapper.get('.editor form').text()).toContain('Save & close')
    const actions = wrapper.findAll('.editor .form-actions button')
    expect(actions.map((button) => button.text())).toEqual(['Cancel', 'Save & close'])
    expect(actions[0].classes()).toContain('secondary')
    expect(actions[1].classes()).toContain('save-report-button')
    expect(styles).toContain('.form-actions > .secondary {\n  margin-right: auto;')
    expect(styles).toContain('.save-report-button {\n  margin-left: auto;\n  min-width: 128px;')
    expect(styles).toContain('.save-report-button {\n  color: var(--button-active-text) !important;\n  background: var(--button-active) !important;')
    expect(styles).toContain('.lock-button {\n  color: var(--danger-text) !important;\n  background: var(--danger-surface) !important;')
    expect(styles).toContain('.save-report-button:hover {\n  color: var(--button-active-text) !important;\n  background: color-mix(in srgb, var(--button-active) 82%, #fff) !important;')
    expect(styles).toContain('.lock-button:hover {\n  color: var(--danger-text) !important;\n  background: color-mix(in srgb, var(--danger-surface) 82%, #fff) !important;')
  })

  it('shows the empty rating scale, clamps input to zero through ten, and saves zero as 0/10', async () => {
    const wrapper = await mountApp()
    await wrapper.get('.edit-button').trigger('click')
    await wrapper.findAll('.entry-launcher')[0].trigger('click')
    clickDialogButton('Add book')
    await flushPromises()

    const rating = document.querySelector<HTMLInputElement>('.rating-input')!
    expect(rating.type).toBe('number')
    expect(rating.min).toBe('0')
    expect(rating.max).toBe('10')
    expect(rating.step).toBe('1')
    let suffix = document.querySelector<HTMLElement>('.rating-suffix')!
    expect(rating.getAttribute('aria-describedby')).toBe(suffix.id)
    expect(suffix.textContent).toBe('out of 10')
    expect(styles).toContain('.rating-input {\n  padding-right: 72px;')
    expect(styles).toContain('.rating-input::-webkit-inner-spin-button, .rating-input::-webkit-outer-spin-button')

    expect(styles).toContain('-webkit-appearance: none;')
    expect(styles).toContain('appearance: none;')

    dialogInputFor('Title').value = 'Piranesi'
    dialogInputFor('Title').dispatchEvent(new Event('input', { bubbles: true }))
    rating.value = '7'
    rating.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(rating.value).toBe('7')
    expect(document.querySelector('.rating-suffix')).toBeNull()
    expect(rating.hasAttribute('aria-describedby')).toBe(false)
    expect(rating.classList.contains('empty')).toBe(false)
    expect(styles).toContain('.rating-input {\n  padding-right: 12px;\n}\n\n.rating-input.empty {\n  padding-right: 72px;')

    rating.value = ''
    rating.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    suffix = document.querySelector<HTMLElement>('.rating-suffix')!
    expect(rating.value).toBe('')
    expect(rating.classList.contains('empty')).toBe(true)
    expect(rating.getAttribute('aria-describedby')).toBe(suffix.id)

    for (const [attempt, expected] of [['-1', '0'], ['11', '10'], ['11111', '10']] as const) {
      rating.value = attempt
      rating.dispatchEvent(new Event('input', { bubbles: true }))
      await flushPromises()
      expect(rating.value).toBe(expected)
      expect(Number(rating.value)).toBeGreaterThanOrEqual(0)
      expect(Number(rating.value)).toBeLessThanOrEqual(10)
    }

    rating.value = '-100'
    rating.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(rating.value).toBe('0')
    clickDialogButton('Save & close')
    await wrapper.get('.editor form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(localStorage.getItem(archiveKey) ?? '{}')['2025'].bookEntries[0].rating).toBe(0)
    await wrapper.findAll('.metric-card').find((card) => card.text().includes('Books read'))!.trigger('click')
    await flushPromises()
    expect(document.querySelector('#books-detail')?.textContent).toContain('0/10')
  })

  it('places accessible Delete entry actions beneath both book and place rows', async () => {
    const wrapper = await mountApp()
    await wrapper.get('.edit-button').trigger('click')

    await wrapper.findAll('.entry-launcher')[0].trigger('click')
    clickDialogButton('Add book')
    await flushPromises()
    expect(document.querySelector('.entry-dialog .remove-entry')).toBeNull()
    let row = document.querySelector<HTMLElement>('.entry-dialog .entry-row')!
    let deletion = row.querySelector<HTMLButtonElement>('.delete-entry')!
    expect(deletion.textContent).toBe('Delete entry')
    expect(deletion.getAttribute('aria-label')).toBe('Delete book 1')
    deletion.click()
    await flushPromises()
    expect(document.querySelectorAll('.entry-dialog .entry-row')).toHaveLength(0)
    clickDialogButton('Cancel')
    await flushPromises()

    await wrapper.findAll('.entry-launcher')[1].trigger('click')
    clickDialogButton('Add place')
    await flushPromises()
    expect(document.querySelector('.entry-dialog .remove-entry')).toBeNull()
    row = document.querySelector<HTMLElement>('.entry-dialog .place-row')!
    deletion = row.querySelector<HTMLButtonElement>('.delete-entry')!
    expect(deletion.textContent).toBe('Delete entry')
    expect(deletion.getAttribute('aria-label')).toBe('Delete place 1')
    deletion.click()
    await flushPromises()
    expect(document.querySelectorAll('.entry-dialog .place-row')).toHaveLength(0)
    expect(styles).toContain('.delete-entry {\n  grid-column: 2 / -1;\n  justify-self: start;\n  margin-top: 4px;\n  padding: 7px 10px;')
    expect(styles).toContain('.delete-entry:hover, .delete-entry:focus, .delete-entry:active {\n  color: #b43f31 !important;\n  background: transparent !important;')
    expect(styles).toContain('.delete-entry {\n  min-height: 44px;\n  padding: 10px 12px;')
    expect(styles).toContain('@media (max-width: 850px) {\n  .entry-dialog .entry-row, .entry-dialog .place-row {\n    grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1fr);')
    expect(styles).toContain('.entry-dialog .delete-entry {\n    grid-column: 2 / -1;\n    width: 100%;\n    justify-self: stretch;\n    text-align: left;')
    expect(styles).toContain('@media (max-width: 560px) {\n  .entry-dialog .entry-row, .entry-dialog .place-row {\n    grid-template-columns: 24px minmax(0, 1fr);')
    expect(styles).toContain('.entry-dialog .entry-row label, .entry-dialog .entry-row .country-field {\n    grid-column: 2;')
    clickDialogButton('Cancel')
    await flushPromises()
  })

  it('discards a book working copy on Cancel and commits it only with Save & close', async () => {
    const wrapper = await mountApp()
    await wrapper.get('.edit-button').trigger('click')
    await wrapper.findAll('.entry-launcher')[0].trigger('click')
    clickDialogButton('Add book')
    await flushPromises()
    dialogInputFor('Title').value = 'Piranesi'
    dialogInputFor('Title').dispatchEvent(new Event('input', { bubbles: true }))
    expect(dialogInputFor('Title').required).toBe(true)
    expect(dialogInputFor('Author').required).toBe(false)
    expect(document.querySelector('.entry-dialog')?.textContent).toContain('Author *optional')
    clickDialogButton('Cancel')
    await flushPromises()
    expect(wrapper.findAll('.entry-launcher')[0].text()).toContain('0 books saved')

    await wrapper.findAll('.entry-launcher')[0].trigger('click')
    expect(document.querySelectorAll('.entry-dialog .entry-row')).toHaveLength(0)
    clickDialogButton('Add book')
    await flushPromises()
    dialogInputFor('Title').value = 'Piranesi'
    dialogInputFor('Title').dispatchEvent(new Event('input', { bubbles: true }))
    clickDialogButton('Save & close')
    await flushPromises()
    expect(document.querySelector('.entry-dialog')).toBeNull()
    expect(wrapper.findAll('.entry-launcher')[0].text()).toContain('1 books saved')
  })

  it('validates, filters, and commits a country from the Places working-copy dialog', async () => {
    expect(countries).toHaveLength(249)
    expect(new Set(countries.map((country) => country.code)).size).toBe(249)
    const wrapper = await mountApp()
    await editCurrentYear(wrapper)
    await wrapper.findAll('.entry-launcher')[1].trigger('click')
    clickDialogButton('Add place')
    await flushPromises()
    dialogInputFor('Specific location').value = 'Da Nang'
    dialogInputFor('Specific location').dispatchEvent(new Event('input', { bubbles: true }))
    clickDialogButton('Save & close')
    await flushPromises()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('selected country')
    expect(document.querySelector('.entry-dialog')).not.toBeNull()

    document.querySelector<HTMLButtonElement>('.country-trigger')!.click()
    await flushPromises()
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search countries and regions"]')!
    search.value = 'viet'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain('Vietnam')
    options[0].click()
    clickDialogButton('Save & close')
    await flushPromises()
    expect(wrapper.findAll('.entry-launcher')[1].text()).toContain('1 places saved')

    await wrapper.get('.editor form').trigger('submit')
    await flushPromises()
    const stored = JSON.parse(localStorage.getItem(archiveKey) ?? '{}')['2025']
    expect(stored.places).toBe(stored.placeEntries.length)
    expect(stored.placeEntries).toEqual([
      expect.objectContaining({ location: 'Da Nang', countryCode: 'VN', countryName: 'Vietnam' }),
    ])
    expect(localStorage.getItem(lockKey)).toBeNull()
    expect(wrapper.find('.editor').exists()).toBe(false)
  })

  it('uses a safe browser fallback for the final saved-report view', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = await mountApp()
    await wrapper.get('.lock-button').trigger('click')
    await wrapper.get('.confirmation-check input').setValue(true)
    await wrapper.get('#lock-form').trigger('submit')
    await flushPromises()

    expect(JSON.parse(localStorage.getItem(lockKey) ?? '{}')).toMatchObject({ year: 2025 })
    expect(localStorage.getItem(draftKey)).toBeNull()
    expect(open.mock.calls[0]).toEqual([
      expect.stringMatching(/[?&]report=saved.*[?&]year=2025|[?&]year=2025.*[?&]report=saved/),
      '_blank',
      'noopener,noreferrer',
    ])
  })

  it('never calls window.open after a native final lock, avoiding NL_TOKEN errors', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('NL_TOKEN is missing')
    })
    const wrapper = await mountApp()
    window.NL_PATH = 'C:\\Portable\\YearInData'
    window.NL_OS = 'Windows'

    await wrapper.get('.lock-button').trigger('click')
    await wrapper.get('.confirmation-check input').setValue(true)
    await wrapper.get('#lock-form').trigger('submit')
    await flushPromises()

    expect(open).not.toHaveBeenCalled()
    expect(nativeApi.filesystem.writeFile).toHaveBeenCalledOnce()
    const written = nativeApi.filesystem.writeFile.mock.calls[0][1]
    expect(JSON.parse(written)).toMatchObject({ lock: { year: 2025 }, version: 3 })
    expect(wrapper.text()).toContain('Locked until')
  })

  it('uses the rc1 version consistently in the About panel and manifests', async () => {
    const wrapper = await mountApp()
    await wrapper.get('.settings-button').trigger('click')
    expect(wrapper.get('.settings-panel').text()).toContain('version 0.1-rc1')
    expect(packageManifest.name).toBe('memolock')
    expect(packageManifest.version).toBe('0.1.0-rc.2')
    expect(neutralinoConfig.version).toBe('0.1.0-rc.2')
    expect(neutralinoConfig.modes.window.title).toBe('Memolock')
    expect(neutralinoConfig.cli.binaryName).toBe('memolock')
    expect(indexHtml).toContain('<title>Memolock</title>')
    expect(neutralinoConfig.applicationId).toBe('js.yearindata.app')
  })
})
