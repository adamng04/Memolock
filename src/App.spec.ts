// @vitest-environment jsdom
/// <reference path="./env.d.ts" />

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import seedReport from './data/annual-report.json'
import countries from './data/countries.json'
import { createBlankReport } from './types'

const styles = readFileSync('src/styles.css', 'utf8')
const packageManifest = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string; version: string }
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
  name: string
  version: string
  packages: Record<string, { name?: string; version?: string }>
}
const neutralinoConfig = JSON.parse(readFileSync('neutralino.config.json', 'utf8')) as {
  applicationId: string
  version: string
  applicationName: string
  author: string
  description: string
  copyright: string
  cli: { binaryName: string }
  modes: { window: { title: string } }
}
const indexHtml = readFileSync('index.html', 'utf8')
const readme = readFileSync('README.md', 'utf8')

const nativeApi = vi.hoisted(() => ({
  app: { exit: vi.fn() },
  os: { open: vi.fn(), getEnv: vi.fn(), showOpenDialog: vi.fn() },
  window: { minimize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn() },
  events: { on: vi.fn(), off: vi.fn() },
  filesystem: {
    createDirectory: vi.fn(),
    getStats: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}))
vi.mock('@neutralinojs/lib', () => nativeApi)

const archiveKey = 'personal-annual-report-archive'
const lockKey = `${archiveKey}:lock`
const draftKey = `${archiveKey}:draft`
const settingsKey = `${archiveKey}:settings`
const mountedWrappers: Array<{ unmount: () => void }> = []

async function mountApp(search = '', dismissNewYear = true) {
  window.history.replaceState({}, '', `/${search}`)
  vi.resetModules()
  const { default: App } = await import('./App.vue')
  const wrapper = mount(App)
  mountedWrappers.push(wrapper)
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
    nativeApi.os.getEnv.mockResolvedValue('C:\\Users\\Ada')
    nativeApi.os.showOpenDialog.mockResolvedValue([])
    nativeApi.filesystem.createDirectory.mockResolvedValue(undefined)
    nativeApi.filesystem.getStats.mockRejectedValue({ code: 'NE_FS_NOPATHE' })
    nativeApi.filesystem.writeFile.mockResolvedValue(undefined)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    mountedWrappers.splice(0).reverse().forEach((wrapper) => wrapper.unmount())
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    window.history.replaceState({}, '', '/')
  })

  it('starts with a zeroed 2025 report and a clear empty-state action', async () => {
    expect(seedReport).toEqual(createBlankReport(2025))
    const wrapper = await mountApp()
    expect(wrapper.find('.export-report-button').exists()).toBe(false)

    expect(wrapper.get('.topbar').text()).toContain('Untitled')
    expect(wrapper.get('.empty-callout').text()).toContain("You haven't added an entry in 2025 yet")
    expect(wrapper.get('.empty-callout button').text()).toBe('Add an entry')
    expect(wrapper.findAll('.metric-card')).toHaveLength(7)
    expect(wrapper.findAll('.metric-card').slice(0, 6).every((card) => /^0h?$/.test(card.get('strong').text()))).toBe(true)
    expect(wrapper.get('.add-more-card').text()).toContain('Add more entries')
  })

  it('shows a 2026 reminder for completed year 2025 and dismisses without creating 2026', async () => {
    const wrapper = await mountApp('', false)
    const prompt = document.querySelector<HTMLElement>('.new-year-dialog')!

    expect(prompt.getAttribute('role')).toBe('dialog')
    expect(prompt.getAttribute('aria-modal')).toBe('true')
    expect(prompt.textContent).toContain("It's 2026")
    expect(prompt.textContent).toContain('Start 2025 report')
    expect(wrapper.get('nav button[aria-current="page"]').text()).toContain('2025')

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
    expect(wrapper.get('.topbar').text()).toContain('Untitled')
    expect(wrapper.findAll('nav button').some((button) => button.text().includes('2026'))).toBe(false)
    expect(wrapper.get('nav').text()).not.toContain('logged')
    expect(wrapper.get('nav button[aria-current="page"]').text()).toContain('2025')
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
    expect(meaningful.get('nav button[aria-current="page"]').text()).toContain('2026')
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

    expect(wrapper.get('nav button[aria-current="page"]').text()).toContain('2026')
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
    await first.get('.sidebar > .settings-button').trigger('click')
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
    await restored.get('.sidebar > .settings-button').trigger('click')
    expect(buttonWithText(restored, 'Dark').attributes('aria-pressed')).toBe('true')
  })

  it('persists and restores the true-black OLED theme', async () => {
    const first = await mountApp()
    await first.get('.sidebar > .settings-button').trigger('click')
    await buttonWithText(first, 'OLED').trigger('click')
    await flushPromises()

    expect(document.documentElement.dataset.theme).toBe('oled')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(buttonWithText(first, 'OLED').attributes('aria-pressed')).toBe('true')
    expect(JSON.parse(localStorage.getItem(settingsKey) ?? '{}')).toEqual({ theme: 'oled', accent: 'leaf' })
    first.unmount()

    const restored = await mountApp()
    expect(document.documentElement.dataset.theme).toBe('oled')
    await restored.get('.sidebar > .settings-button').trigger('click')
    expect(buttonWithText(restored, 'OLED').attributes('aria-pressed')).toBe('true')
    expect(styles).toContain('[data-theme="oled"]')
    expect(styles).toContain('--page: #000;')
    expect(styles).toContain('--surface: #000;')
    expect(styles).toContain('[data-theme="oled"] body,')
    expect(styles).toContain('[data-theme="oled"] .loading-state,')
    expect(styles).toContain('[data-theme="oled"] .content {')
    expect(styles).toContain('[data-theme="oled"] .overlay')
    expect(styles).toContain('background: #000d;')
    expect(styles).not.toContain('[data-theme="oled"] .lock-status')
    expect(styles).toMatch(/\.lock-status \{[\s\S]*?padding: 12px 16px;[\s\S]*?color: #fff;[\s\S]*?background: #a83627;/)
    expect(styles).toContain('[data-theme="oled"] .saved-status')
    expect(styles).toContain('color: var(--success-text);')
    expect(styles).toContain('background: var(--success-surface)')
    expect(styles).not.toContain('.lock-date')
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
    const trigger = wrapper.get<HTMLButtonElement>('.sidebar > .settings-button')

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
    await first.get('.sidebar > .settings-button').trigger('click')
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
    await restored.get('.sidebar > .settings-button').trigger('click')
    expect(restored.get('button[aria-label="Navy accent"]').attributes('aria-pressed')).toBe('true')
  })

  it('opens the exact help URL with the Neutralino OS API in native mode', async () => {
    const wrapper = await mountApp()
    window.NL_PATH = 'C:\\Portable\\YearInData'
    await wrapper.get('.sidebar > .settings-button').trigger('click')
    await wrapper.get('.help-button').trigger('click')
    await flushPromises()

    expect(nativeApi.os.open).toHaveBeenCalledOnce()
    expect(nativeApi.os.open).toHaveBeenCalledWith('https://adamngshrine.com/index/miscs/memolock')
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
    await wrapper.get('.sidebar > .settings-button').trigger('click')
    expect(wrapper.get('.settings-panel').text()).toContain('Memolock · version 0.1.1')
    expect(wrapper.get('.settings-panel').text()).not.toMatch(/0\.1-rc1|0\.1\.0-rc\.2|prerelease/i)
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
    expect(styles).toContain(':root {\n  font-size: 16px;')
    expect(styles).toMatch(/\.topbar p,[\s\S]*?\.empty-callout small \{\s*font-size: 12px;/)
    expect(styles).toMatch(/\.secondary,[\s\S]*?\.new-year-dialog > \.primary \{\s*font-size: 13px;/)
    expect(styles).toMatch(/label,[\s\S]*?\.confirmation-check \{\s*font-size: 13px;/)
    expect(styles).toContain('.metric-card h2 {\n  font-size: 16px;')
    expect(styles).toMatch(/\.field-grid label > span,[\s\S]*?\.rating-suffix \{\s*font-size: 12px;/)
  })

  it('uses the borderless active, muted, hover, and disabled button tokens', () => {
    expect(styles).toContain('--button-active: #26352d;')
    expect(styles).toContain('--button-muted: #e2e4df;')
    expect(styles).toContain('--button-hover: #d5d8d2;')
    expect(styles).toMatch(/button,\s*\.help-button \{\s*border: 0 !important;/)
    expect(styles).toMatch(/button:not\(:disabled\):not\(\.sidebar-scrim\):hover,\s*\.help-button:hover/)
    expect(styles).toMatch(/button:not\(:disabled\):active,\s*\.help-button:active/)
    expect(styles).toMatch(/button:disabled \{\s*cursor: not-allowed;\s*opacity: 0?\.48;/)
    expect(styles).toMatch(/transition:\s*background-color 0?\.16s ease,\s*color 0?\.16s ease;/)
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

  it('shows the report editor without a subtitle input and separates saving from locking', async () => {
    const wrapper = await mountApp()
    expect(wrapper.get('.edit-button').text()).toBe('Edit report')
    expect(wrapper.get('.lock-button').text()).toBe('Lock report')
    await wrapper.get('.edit-button').trigger('click')
    expect(wrapper.get('.editor').text()).not.toContain('Subtitle')
    expect(inputFor(wrapper, 'Report title').element.parentElement?.classList).toContain('wide')
    expect(wrapper.get('.editor-guidance').text()).toBe("These default entries are used for chart comparisons and cannot be deleted. You can add custom entries, but they won't appear in the chart.")

    expect(wrapper.findAll('.entry-launcher').map((button) => button.text())).toEqual([
      expect.stringContaining("Add books you've read"),
      expect.stringContaining("Add places & countries you've visited"),
    ])
    expect(wrapper.findAll('label').some((label) => label.text() === 'Books read')).toBe(false)
    expect(wrapper.findAll('label').some((label) => label.text() === 'Places visited')).toBe(false)
    expect(wrapper.get('nav button[aria-current="page"]').text()).toContain('2025')
    expect(wrapper.find('.editor input[type="number"][min="1900"]').exists()).toBe(false)
    expect(inputFor(wrapper, 'Average steps per day').attributes('required')).toBeDefined()
    expect(inputFor(wrapper, 'Albums listened').attributes('required')).toBeDefined()
    expect(inputFor(wrapper, 'Average sleep').attributes('required')).toBeDefined()
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
    expect(styles).toContain('.rating-input::-webkit-inner-spin-button')
    expect(styles).toContain('.rating-input::-webkit-outer-spin-button')

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
    expect(styles).toMatch(/\.rating-input \{\s*padding-right: 12px;\s*}\s*\.rating-input\.empty \{\s*padding-right: 72px;/)

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
    expect(styles).toMatch(/\.delete-entry \{\s*grid-column: 2 \/ -1;[\s\S]*?margin-top: 4px;/)
    expect(styles).toMatch(/\.delete-entry:hover,\s*\.delete-entry:focus,\s*\.delete-entry:active \{\s*color: #b43f31 !important;\s*background: transparent !important;/)
    expect(styles).toMatch(/@media \(max-width: 850px\)[\s\S]*?grid-template-columns: 28px minmax\(0, 1fr\) minmax\(0, 1fr\);/)
    expect(styles).toMatch(/\.entry-dialog \.delete-entry \{\s*grid-column: 2 \/ -1;\s*width: 100%;\s*justify-self: stretch;\s*text-align: left;/)
    expect(styles).toMatch(/@media \(max-width: 560px\)[\s\S]*?grid-template-columns: 24px minmax\(0, 1fr\);/)
    expect(styles).toMatch(/\.entry-dialog \.entry-row label,[\s\S]*?\.entry-dialog \.entry-row \.country-field \{\s*grid-column: 2;/)
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

  it('downloads a .memolock file and confirms export after a browser lock', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    localStorage.setItem(archiveKey, JSON.stringify({
      2025: { ...createBlankReport(2025), stepsPerDay: 4321 },
    }))
    const wrapper = await mountApp()
    await wrapper.get('.lock-button').trigger('click')
    expect(wrapper.get('.lock-panel').text()).toContain('FINALIZE 2025 FOREVER')
    expect(wrapper.get('.lock-panel').text()).toContain('cannot be edited or unlocked later')
    expect(wrapper.get('.lock-panel').text()).not.toContain('Unlock date')
    expect(wrapper.get('.lock-panel').text()).not.toContain('Next year')
    expect(styles).toMatch(/\.confirmation-check \{[\s\S]*?width: fit-content;[\s\S]*?margin-inline: auto;[\s\S]*?justify-content: center;/)
    await wrapper.get('.confirmation-check input').setValue(true)
    await wrapper.get('#lock-form').trigger('submit')
    await flushPromises()

    expect(JSON.parse(localStorage.getItem(lockKey) ?? '{}')).toMatchObject({
      2025: { year: 2025 },
    })
    expect(localStorage.getItem(draftKey)).toBeNull()
    expect(open).not.toHaveBeenCalled()
    expect(document.querySelector('.export-dialog')?.textContent).toContain('2025 report exported')
    expect(document.querySelector('.export-dialog')?.textContent).toContain('2025_report.memolock')
  })

  it('never calls window.open after a native final lock, avoiding NL_TOKEN errors', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('NL_TOKEN is missing')
    })
    localStorage.setItem(archiveKey, JSON.stringify({
      2025: { ...createBlankReport(2025), albumsListened: 12 },
    }))
    const wrapper = await mountApp()
    window.NL_PATH = 'C:\\Portable\\YearInData'
    window.NL_OS = 'Windows'

    await wrapper.get('.lock-button').trigger('click')
    await wrapper.get('.confirmation-check input').setValue(true)
    await wrapper.get('#lock-form').trigger('submit')
    await flushPromises()

    expect(open).not.toHaveBeenCalled()
    expect(nativeApi.filesystem.writeFile).toHaveBeenCalledTimes(2)
    const storedArchive = JSON.parse(nativeApi.filesystem.writeFile.mock.calls[0][1])
    const exportedReport = JSON.parse(nativeApi.filesystem.writeFile.mock.calls[1][1])
    expect(storedArchive).toMatchObject({ locks: { 2025: { year: 2025 } }, version: 5 })
    expect(nativeApi.os.getEnv).toHaveBeenCalledWith('USERPROFILE')
    expect(nativeApi.filesystem.writeFile.mock.calls[1][0]).toBe('C:\\Users\\Ada\\Documents\\Memolock\\2025_report.memolock')
    expect(exportedReport).toMatchObject({
      format: 'memolock-report',
      formatVersion: 1,
      status: { code: 'LOCKED', locked: true },
      report: { year: 2025, albumsListened: 12 },
    })
    expect(document.querySelector('.export-dialog')?.textContent).toContain('Exported to Documents\\Memolock\\2025_report.memolock.')
    expect(wrapper.text()).toContain('Locked permanently')
    expect(wrapper.find('.export-report-button').exists()).toBe(true)

    expect(document.querySelector('.export-dialog')?.textContent).not.toContain('Done')
    document.querySelector<HTMLElement>('.export-dialog')!.parentElement!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.get('.export-report-button').trigger('click')
    await flushPromises()
    expect(nativeApi.filesystem.writeFile).toHaveBeenCalledTimes(3)
    expect(nativeApi.filesystem.writeFile.mock.calls[2][0]).toBe('C:\\Users\\Ada\\Documents\\Memolock\\2025_report.memolock')
    expect(document.querySelector('.export-dialog')?.textContent).toContain('2025 report exported')
  })

  it('asks before replacing a matching export and can create a numbered copy', async () => {
    localStorage.setItem(archiveKey, JSON.stringify({
      2025: { ...createBlankReport(2025), stepsPerDay: 7000 },
    }))
    const wrapper = await mountApp()
    window.NL_PATH = 'C:\\Portable\\Memolock'
    window.NL_OS = 'Windows'
    nativeApi.filesystem.getStats
      .mockResolvedValueOnce({ isFile: true })
      .mockResolvedValueOnce({ isFile: true })
      .mockRejectedValueOnce({ code: 'NE_FS_NOPATHE' })

    await wrapper.get('.lock-button').trigger('click')
    await wrapper.get('.confirmation-check input').setValue(true)
    await wrapper.get('#lock-form').trigger('submit')
    await flushPromises()

    const conflictDialog = document.querySelector<HTMLElement>('.export-conflict-dialog')!
    expect(conflictDialog.textContent).toContain('Matching file found')
    expect(conflictDialog.textContent).toContain('2025_report.memolock')
    expect([...conflictDialog.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Skip',
      'Make (1)',
      'Overwrite',
    ])
    expect(nativeApi.filesystem.writeFile).toHaveBeenCalledTimes(1)

    conflictDialog.querySelectorAll<HTMLButtonElement>('button')[1].click()
    await flushPromises()
    expect(nativeApi.filesystem.writeFile).toHaveBeenCalledTimes(2)
    expect(nativeApi.filesystem.writeFile.mock.calls[1][0]).toBe('C:\\Users\\Ada\\Documents\\Memolock\\2025_report (1).memolock')
    expect(document.querySelector('.export-dialog')?.textContent).toContain('2025_report (1).memolock')
  })

  it('keeps a legacy year lock permanent while the newly completed year remains editable', async () => {
    vi.setSystemTime(new Date('2027-07-23T10:00:00Z'))
    localStorage.setItem(archiveKey, JSON.stringify({
      2025: { ...createBlankReport(2025), stepsPerDay: 5000 },
    }))
    localStorage.setItem(lockKey, JSON.stringify({
      year: 2025,
      lockedAt: '2025-12-31T23:59:00.000Z',
      unlockAt: '2026-01-01T00:00:00.000Z',
    }))

    const wrapper = await mountApp('', false)
    expect(wrapper.get('.lock-status').text()).toBe('Locked permanently')
    expect(wrapper.find('.edit-button').exists()).toBe(false)
    expect(wrapper.get('.add-more-card').attributes('disabled')).toBeDefined()

    document.querySelector<HTMLButtonElement>('.new-year-dialog .primary')!.click()
    await flushPromises()
    expect(wrapper.get('.editor').text()).toContain('What did you accomplish in 2026?')
    await wrapper.get('button[aria-label="Close form"]').trigger('click')
    expect(wrapper.get('.edit-button').text()).toBe('Edit report')
    expect(wrapper.get('.add-more-card').attributes('disabled')).toBeUndefined()

    await wrapper.findAll('nav button').find((button) => button.text().includes('2025'))!.trigger('click')
    expect(wrapper.get('.lock-status').text()).toBe('Locked permanently')
    expect(JSON.parse(localStorage.getItem(lockKey) ?? '{}')).toMatchObject({
      2025: { year: 2025, lockedAt: '2025-12-31T23:59:00.000Z' },
    })
  })

  it('chooses, validates, and persists a text custom entry while close discards input', async () => {
    const wrapper = await mountApp()
    document.body.appendChild(wrapper.element)
    const launcher = wrapper.get<HTMLButtonElement>('.add-more-card')
    expect(launcher.classes()).toContain('metric-card')
    expect(launcher.text()).toContain('Add more entries')
    expect(launcher.attributes()).toMatchObject({
      'aria-haspopup': 'dialog',
      'aria-controls': 'custom-entry-flow',
      'aria-expanded': 'false',
    })

    await launcher.trigger('click')
    let chooser = document.querySelector<HTMLElement>('#custom-entry-chooser')!
    expect(chooser.getAttribute('role')).toBe('dialog')
    expect(chooser.getAttribute('aria-modal')).toBe('true')
    expect(chooser.getAttribute('aria-labelledby')).toBe('custom-entry-chooser-title')
    const choices = [...chooser.querySelectorAll<HTMLButtonElement>('.custom-entry-choice')]
    expect(choices.map((choice) => choice.querySelector('strong')?.textContent)).toEqual([
      'Title with textbox',
      'Title with number',
    ])
    expect(document.activeElement).toBe(choices[0])

    choices[0].click()
    await flushPromises()
    let dialog = document.querySelector<HTMLElement>('.custom-entry-dialog')!
    let title = dialog.querySelector<HTMLInputElement>('#custom-entry-title')!
    let content = dialog.querySelector<HTMLTextAreaElement>('#custom-entry-content')!
    expect(dialog.textContent).toContain('Title with textbox')
    expect(document.activeElement).toBe(title)

    ;[...dialog.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Back'))!.click()
    await flushPromises()
    chooser = document.querySelector<HTMLElement>('#custom-entry-chooser')!
    expect(document.activeElement).toBe(chooser.querySelector('[data-custom-entry-choice="text"]'))
    chooser.querySelector<HTMLButtonElement>('[data-custom-entry-choice="text"]')!.click()
    await flushPromises()
    dialog = document.querySelector<HTMLElement>('.custom-entry-dialog')!
    title = dialog.querySelector<HTMLInputElement>('#custom-entry-title')!
    content = dialog.querySelector<HTMLTextAreaElement>('#custom-entry-content')!
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Enter a title')
    expect(title.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(title)
    title.value = 'Garden'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    content.value = 'Grew twelve tomatoes.'
    content.dispatchEvent(new Event('input', { bubbles: true }))
    dialog.querySelector<HTMLButtonElement>('button[aria-label="Close custom entry form"]')!.click()
    await flushPromises()
    expect(wrapper.find('.custom-entry-card').exists()).toBe(false)
    expect(document.activeElement).toBe(launcher.element)

    await launcher.trigger('click')
    document.querySelector<HTMLButtonElement>('[data-custom-entry-choice="text"]')!.click()
    await flushPromises()
    dialog = document.querySelector<HTMLElement>('.custom-entry-dialog')!
    title = dialog.querySelector<HTMLInputElement>('#custom-entry-title')!
    content = dialog.querySelector<HTMLTextAreaElement>('#custom-entry-content')!
    title.value = 'Garden'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    content.value = 'Grew twelve tomatoes.'
    content.dispatchEvent(new Event('input', { bubbles: true }))
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(wrapper.get('.custom-entry-card').text()).toContain('Garden')
    expect(wrapper.get('.custom-entry-card').text()).toContain('Grew twelve tomatoes.')
    expect(JSON.parse(localStorage.getItem(archiveKey) ?? '{}')['2025'].customEntries).toEqual([
      expect.objectContaining({ type: 'text', title: 'Garden', content: 'Grew twelve tomatoes.' }),
    ])

    const clippedContent = wrapper.get<HTMLElement>('.custom-text-card-content').element
    Object.defineProperty(clippedContent, 'clientHeight', { configurable: true, value: 72 })
    Object.defineProperty(clippedContent, 'scrollHeight', { configurable: true, value: 140 })
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(wrapper.get('.custom-entry-card').text()).toContain('Read more')
    expect(styles).toContain('.custom-text-card {\n  height: 205px;')

    const reader = wrapper.get<HTMLButtonElement>('.custom-entry-reader')
    await reader.trigger('click')
    const readingDialog = document.querySelector<HTMLElement>('.custom-entry-reading-dialog')!
    expect(readingDialog.textContent).toContain('Garden')
    expect(readingDialog.textContent).toContain('Grew twelve tomatoes.')
    expect(readingDialog.querySelector('input, textarea, form')).toBeNull()
    readingDialog.querySelector<HTMLButtonElement>('[aria-label="Close custom entry"]')!.click()
    await flushPromises()
    expect(document.activeElement).toBe(reader.element)

    const editButton = wrapper.get<HTMLButtonElement>('.edit-custom-entry')
    expect(editButton.attributes('aria-label')).toBe('Edit Garden')
    await editButton.trigger('click')
    dialog = document.querySelector<HTMLElement>('.custom-entry-dialog')!
    expect(dialog.textContent).toContain('Edit text entry')
    expect(dialog.textContent).toContain('Save changes')
    title = dialog.querySelector<HTMLInputElement>('#custom-entry-title')!
    content = dialog.querySelector<HTMLTextAreaElement>('#custom-entry-content')!
    expect(title.value).toBe('Garden')
    expect(content.value).toBe('Grew twelve tomatoes.')
    title.value = 'Balcony garden'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    content.value = 'Grew fourteen tomatoes.'
    content.dispatchEvent(new Event('input', { bubbles: true }))
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(wrapper.get('.custom-entry-card').text()).toContain('Balcony garden')
    expect(wrapper.get('.custom-entry-card').text()).toContain('Grew fourteen tomatoes.')
    expect(JSON.parse(localStorage.getItem(archiveKey) ?? '{}')['2025'].customEntries).toHaveLength(1)
    expect(styles).not.toMatch(/border-top:\s*(4px|5px)\s+solid/)

    wrapper.unmount()
    const restored = await mountApp()
    expect(restored.get('.custom-entry-card').text()).toContain('Balcony garden')
  })

  it('validates and persists zero, decimal, and negative number custom entries as numbers', async () => {
    expect(styles).toContain('.custom-number-card {\n  --accent: var(--accent-swatch, #72a34f);\n  gap: 0;')
    const wrapper = await mountApp()
    document.body.appendChild(wrapper.element)
    const launcher = wrapper.get<HTMLButtonElement>('.add-more-card')

    async function openNumberForm() {
      await launcher.trigger('click')
      document.querySelector<HTMLButtonElement>('[data-custom-entry-choice="number"]')!.click()
      await flushPromises()
      return document.querySelector<HTMLElement>('.custom-entry-dialog')!
    }

    let dialog = await openNumberForm()
    let title = dialog.querySelector<HTMLInputElement>('#custom-entry-title')!
    let value = dialog.querySelector<HTMLInputElement>('#custom-entry-value')!
    expect(dialog.textContent).toContain('Title with number')
    expect(value.type).toBe('number')
    expect(value.step).toBe('any')

    title.value = 'Net change'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('valid number')
    expect(value.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(value)

    value.value = '0'
    value.dispatchEvent(new Event('input', { bubbles: true }))
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.activeElement).toBe(launcher.element)

    dialog = await openNumberForm()
    title = dialog.querySelector<HTMLInputElement>('#custom-entry-title')!
    value = dialog.querySelector<HTMLInputElement>('#custom-entry-value')!
    title.value = 'Temperature delta'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    value.value = '-12.5'
    value.dispatchEvent(new Event('input', { bubbles: true }))
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    const stored = JSON.parse(localStorage.getItem(archiveKey) ?? '{}')['2025'].customEntries
    expect(stored).toEqual([
      expect.objectContaining({ type: 'number', title: 'Net change', value: 0 }),
      expect.objectContaining({ type: 'number', title: 'Temperature delta', value: -12.5 }),
    ])
    expect(stored.every((entry: { value: unknown }) => typeof entry.value === 'number')).toBe(true)
    expect(wrapper.findAll('.custom-number-card').map((card) => card.text())).toEqual([
      expect.stringContaining('0'),
      expect.stringContaining('-12.5'),
    ])
    expect(wrapper.findAll('.custom-number-card')[0].attributes('aria-label')).toBe('Net change: 0')

    wrapper.unmount()
    const restored = await mountApp()
    expect(restored.findAll('.custom-number-card')).toHaveLength(2)
  })

  it('switches to an offline comparison view with built-in metrics, scaled axes, and custom summaries', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    localStorage.setItem(archiveKey, JSON.stringify({
      2023: {
        ...createBlankReport(2023),
        title: 'Earlier report',
        albumsListened: 1,
        customEntries: [{ id: 'text-2023', type: 'text', title: 'Lesson', content: 'Started slowly.' }],
      },
      2024: {
        ...createBlankReport(2024),
        title: 'Middle report',
        stepsPerDay: 10000,
        customEntries: [{ id: 'number-2024', type: 'number', title: 'Side projects', value: 3 }],
      },
      2025: {
        ...createBlankReport(2025),
        title: 'Latest report',
        stepsPerDay: 20000,
        customEntries: [{ id: 'text-2025', type: 'text', title: 'Theme', content: 'Kept building.' }],
      },
    }))
    const wrapper = await mountApp()
    document.body.appendChild(wrapper.element)
    const chartButton = wrapper.get<HTMLButtonElement>('.chart-button')
    const viewNav = wrapper.get('.view-nav')
    expect(viewNav.attributes('aria-label')).toBe('Report views')
    expect(viewNav.get('.chart-button').element).toBe(chartButton.element)
    expect(viewNav.element.nextElementSibling).toBe(wrapper.get('.sidebar > .settings-button').element)

    await chartButton.trigger('click')
    await flushPromises()
    const comparison = wrapper.get('.comparison-view')
    expect(wrapper.find('.overlay').exists()).toBe(false)
    expect(comparison.find('[role="dialog"]').exists()).toBe(false)
    expect(chartButton.attributes('aria-current')).toBe('page')
    expect(chartButton.classes()).toContain('active')
    expect(document.activeElement).toBe(wrapper.get('.comparison-heading').element)

    const select = comparison.get<HTMLSelectElement>('#comparison-metric')
    expect(select.element.value).toBe('')
    const options = select.findAll('option')
    expect(options[0].text()).toBe('Choose a metric')
    expect(options.slice(1).map((option) => [option.attributes('value'), option.text()])).toEqual([
      ['books', 'Books read'],
      ['places', 'Places visited'],
      ['stepsPerDay', 'Steps per day'],
      ['albumsListened', 'Albums listened'],
      ['averageDailySleepHours', 'Average sleep (hours)'],
      ['dailyExerciseHours', 'Daily exercise (hours)'],
    ])
    expect(options.map((option) => option.text()).join(' ')).not.toMatch(/Lesson|Side projects|Theme/)
    expect(comparison.find('svg').exists()).toBe(false)
    expect(comparison.find('.chart-table').exists()).toBe(false)
    expect(comparison.get('.comparison-chart-section').text()).toContain('Choose a metric')

    await select.setValue('stepsPerDay')
    await flushPromises()
    const svg = comparison.get('svg[role="img"]')
    expect(svg.get('title').text()).toBe('Steps per day by year')
    expect(svg.findAll('.chart-tick').map((tick) => tick.text())).toEqual(['0', '10,000', '20,000'])
    expect(svg.findAll('.chart-grid-line')).toHaveLength(3)
    expect(svg.get('.chart-axis-label').text()).toBe('Steps per day')

    const rows = comparison.findAll('.chart-table tbody tr')
    expect(rows.map((row) => row.text().replace(/\s/g, ''))).toEqual([
      '20230',
      '202410,000',
      '202520,000',
    ])

    const summaries = comparison.findAll('.custom-summary-year')
    expect(summaries.map((summary) => summary.get('h3').text())).toEqual(['2025', '2024', '2023'])
    expect(comparison.get('.custom-summary').text()).toContain('Theme')
    expect(comparison.get('.custom-summary').text()).toContain('Kept building.')
    expect(comparison.get('.custom-summary').text()).toContain('Side projects')
    expect(comparison.get('.custom-summary').text()).toContain('3')
    expect(comparison.get('.custom-summary').text()).toContain('Lesson')

    await wrapper.get('.sidebar > .settings-button').trigger('click')
    await wrapper.get('button[aria-label="Close settings"]').trigger('click')
    expect(wrapper.find('.comparison-view').exists()).toBe(true)
    expect(wrapper.get<HTMLSelectElement>('#comparison-metric').element.value).toBe('stepsPerDay')

    await wrapper.findAll('nav button').find((button) => button.text().includes('2024'))!.trigger('click')
    expect(wrapper.find('.comparison-view').exists()).toBe(false)
    expect(wrapper.get('.topbar').text()).toContain('Middle report')
    expect(chartButton.attributes('aria-current')).toBeUndefined()

    await chartButton.trigger('click')
    await flushPromises()
    expect(wrapper.get<HTMLSelectElement>('#comparison-metric').element.value).toBe('')
    expect(wrapper.find('.comparison-view svg').exists()).toBe(false)
    await wrapper.get('#comparison-metric').setValue('books')
    expect(wrapper.get('.comparison-chart-section').text()).toContain('no recorded values')
    expect(wrapper.find('.comparison-view svg').exists()).toBe(false)
    expect(wrapper.find('.comparison-view .chart-table').exists()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('places import above compare years and processes a locked .memolock file', async () => {
    const wrapper = await mountApp()
    const viewButtons = wrapper.get('.view-nav').findAll('button')
    expect(viewButtons.map((button) => button.text())).toEqual(['⇩ Import report', '▥ Compare years'])

    window.NL_PATH = 'C:\\Portable\\Memolock'
    window.NL_OS = 'Windows'
    nativeApi.os.showOpenDialog.mockResolvedValue(['C:\\Backup\\2024_report.memolock'])
    nativeApi.filesystem.readFile.mockResolvedValue(JSON.stringify({
      format: 'memolock-report',
      formatVersion: 1,
      exportedAt: '2026-01-02T00:00:00.000Z',
      status: { code: 'LOCKED', locked: true, lockedAt: '2025-01-01T00:00:00.000Z' },
      report: { ...createBlankReport(2024), title: 'Imported year', stepsPerDay: 6789 },
    }))

    await wrapper.get('.import-button').trigger('click')
    expect(document.querySelector('.import-dialog')?.textContent).toContain('Select or drag and drop')
    expect(document.querySelector('.import-dialog')?.textContent).not.toContain('Cancel')
    const selectButton = [...document.querySelectorAll<HTMLButtonElement>('.import-dialog button')]
      .find((button) => button.textContent?.includes('Select .memolock file'))!
    selectButton.click()
    await flushPromises()

    expect(nativeApi.os.showOpenDialog).toHaveBeenCalledWith('Import a Memolock report', {
      filters: [{ name: 'Memolock reports', extensions: ['memolock'] }],
      multiSelections: false,
    })
    expect(document.querySelector('.import-result')?.textContent).toContain('2024 report imported')
    expect(document.querySelector('.import-result')?.textContent).toContain('Status code: LOCKED')
    expect(wrapper.get('.topbar').text()).toContain('Imported year')
    expect(wrapper.get('.topbar').text()).toContain('Locked permanently')
  })

  it('processes a dropped unlocked .memolock file', async () => {
    const wrapper = await mountApp()
    await wrapper.get('.import-button').trigger('click')
    const contents = JSON.stringify({
      format: 'memolock-report',
      formatVersion: 1,
      exportedAt: '2026-01-02T00:00:00.000Z',
      status: { code: 'UNLOCKED', locked: false, lockedAt: null },
      report: { ...createBlankReport(2024), title: 'Dropped year', albumsListened: 42 },
    })
    const file = { name: '2024_report.memolock', text: vi.fn().mockResolvedValue(contents) }
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
    document.querySelector<HTMLElement>('.import-dropzone')!.dispatchEvent(event)
    await flushPromises()

    expect(file.text).toHaveBeenCalledOnce()
    expect(document.querySelector('.import-result')?.textContent).toContain('Status code: UNLOCKED')
    expect(wrapper.get('.topbar').text()).toContain('Dropped year')
    expect(wrapper.get('.topbar').text()).toContain('Read-only archive')
  })

  it('never lets import replace an already permanently locked year', async () => {
    localStorage.setItem(archiveKey, JSON.stringify({
      2025: { ...createBlankReport(2025), title: 'Original locked year', stepsPerDay: 5000 },
    }))
    localStorage.setItem(lockKey, JSON.stringify({
      2025: { year: 2025, lockedAt: '2026-01-01T00:00:00.000Z' },
    }))
    const wrapper = await mountApp()
    window.NL_PATH = 'C:\\Portable\\Memolock'
    window.NL_OS = 'Windows'
    nativeApi.os.showOpenDialog.mockResolvedValue(['C:\\Backup\\2025_report.memolock'])
    nativeApi.filesystem.readFile.mockResolvedValue(JSON.stringify({
      format: 'memolock-report',
      formatVersion: 1,
      exportedAt: '2026-01-02T00:00:00.000Z',
      status: { code: 'UNLOCKED', locked: false, lockedAt: null },
      report: { ...createBlankReport(2025), title: 'Replacement attempt', stepsPerDay: 9999 },
    }))

    await wrapper.get('.import-button').trigger('click')
    const selectButton = [...document.querySelectorAll<HTMLButtonElement>('.import-dialog button')]
      .find((button) => button.textContent?.includes('Select .memolock file'))!
    selectButton.click()
    await flushPromises()

    expect(document.querySelector('.import-result')?.textContent).toContain('already permanently locked and cannot be replaced')
    expect(wrapper.get('.topbar').text()).toContain('Original locked year')
    expect(wrapper.get('.topbar').text()).not.toContain('Replacement attempt')
  })

  it('uses 0.1.1 branding and Windows metadata consistently', async () => {
    const wrapper = await mountApp()
    await wrapper.get('.sidebar > .settings-button').trigger('click')
    expect(wrapper.get('.settings-panel').text()).toContain('version 0.1.1')
    expect(wrapper.get('.sidebar').text()).toContain('Memolock 0.1.1')
    expect(packageManifest.name).toBe('memolock')
    expect(packageManifest.version).toBe('0.1.1')
    expect(packageLock.name).toBe('memolock')
    expect(packageLock.version).toBe('0.1.1')
    expect(packageLock.packages['']).toMatchObject({ name: 'memolock', version: '0.1.1' })
    expect(neutralinoConfig.version).toBe('0.1.1')
    expect(neutralinoConfig.applicationName).toBe('Memolock')
    expect(neutralinoConfig.description).toBe('Memolock')
    expect(neutralinoConfig.author).toBe('adamngshrine')
    expect(neutralinoConfig.copyright).toBe('Copyright (c) 2026 adamngshrine. All rights reserved.')
    expect(neutralinoConfig.modes.window.title).toBe('Memolock')
    expect(neutralinoConfig.cli.binaryName).toBe('memolock')
    expect(indexHtml).toContain('<title>Memolock</title>')
    expect(neutralinoConfig.applicationId).toBe('js.yearindata.app')
    expect(readme).toContain('The current release is `0.1.1`.')
    expect([wrapper.text(), packageManifest.version, neutralinoConfig.version, readme].join('\n')).not.toMatch(/0\.1-rc1|0\.1\.0-rc\.2/i)
  })
})
