// @vitest-environment jsdom
/// <reference path="./env.d.ts" />

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankReport } from './types'

const nativeApi = vi.hoisted(() => ({
  os: { getEnv: vi.fn(), showOpenDialog: vi.fn() },
  filesystem: { createDirectory: vi.fn(), getStats: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() },
}))
vi.mock('@neutralinojs/lib', () => nativeApi)

import {
  exportMemolockReport,
  parseMemolockDocument,
  serializeMemolockDocument,
} from './memolock'

describe('.memolock format', () => {
  beforeEach(() => {
    delete window.NL_PATH
    delete window.NL_OS
    vi.clearAllMocks()
    nativeApi.os.getEnv.mockResolvedValue('C:\\Users\\Ada')
    nativeApi.filesystem.createDirectory.mockResolvedValue(undefined)
    nativeApi.filesystem.getStats.mockRejectedValue({ code: 'NE_FS_NOPATHE' })
    nativeApi.filesystem.writeFile.mockResolvedValue(undefined)
  })

  it('stores a readable status code for locked and unlocked reports', () => {
    const report = { ...createBlankReport(2025), title: 'A portable year', stepsPerDay: 9000 }
    const lockedRaw = serializeMemolockDocument(report, { year: 2025, lockedAt: '2026-01-01T00:00:00.000Z' })
    const unlockedRaw = serializeMemolockDocument(report)

    expect(JSON.parse(lockedRaw)).toMatchObject({
      format: 'memolock-report',
      formatVersion: 1,
      status: { code: 'LOCKED', locked: true, lockedAt: '2026-01-01T00:00:00.000Z' },
      report: { year: 2025, title: 'A portable year' },
    })
    expect(JSON.parse(unlockedRaw).status).toEqual({ code: 'UNLOCKED', locked: false, lockedAt: null })
    expect(parseMemolockDocument(lockedRaw).report.stepsPerDay).toBe(9000)
  })

  it('rejects a status code that disagrees with the locked flag', () => {
    const raw = JSON.stringify({
      format: 'memolock-report',
      formatVersion: 1,
      status: { code: 'UNLOCKED', locked: true, lockedAt: '2026-01-01T00:00:00.000Z' },
      report: createBlankReport(2025),
    })
    expect(() => parseMemolockDocument(raw)).toThrow('inconsistent lock status code')
  })

  it('exports a native file to Documents\\Memolock with the year filename', async () => {
    window.NL_PATH = 'C:\\Portable\\Memolock'
    window.NL_OS = 'Windows'
    const report = { ...createBlankReport(2025), albumsListened: 20 }
    const result = await exportMemolockReport(report, { year: 2025, lockedAt: '2026-01-01T00:00:00.000Z' })

    expect(result).toEqual({ status: 'exported', path: 'Documents\\Memolock\\2025_report.memolock' })
    expect(nativeApi.filesystem.createDirectory).toHaveBeenCalledWith('C:\\Users\\Ada\\Documents\\Memolock')
    expect(nativeApi.filesystem.writeFile).toHaveBeenCalledWith(
      'C:\\Users\\Ada\\Documents\\Memolock\\2025_report.memolock',
      expect.stringContaining('"code": "LOCKED"'),
    )
  })

  it('detects matching files, creates a numbered copy, or overwrites by choice', async () => {
    window.NL_PATH = 'C:\\Portable\\Memolock'
    window.NL_OS = 'Windows'
    const report = { ...createBlankReport(2025), albumsListened: 20 }
    const lock = { year: 2025, lockedAt: '2026-01-01T00:00:00.000Z' }

    nativeApi.filesystem.getStats.mockReset().mockResolvedValue({ isFile: true })
    expect(await exportMemolockReport(report, lock)).toEqual({
      status: 'conflict',
      path: 'Documents\\Memolock\\2025_report.memolock',
    })
    expect(nativeApi.filesystem.writeFile).not.toHaveBeenCalled()

    nativeApi.filesystem.getStats.mockReset()
      .mockResolvedValueOnce({ isFile: true })
      .mockRejectedValueOnce({ code: 'NE_FS_NOPATHE' })
    expect(await exportMemolockReport(report, lock, 'copy')).toEqual({
      status: 'exported',
      path: 'Documents\\Memolock\\2025_report (1).memolock',
    })
    expect(nativeApi.filesystem.writeFile).toHaveBeenLastCalledWith(
      'C:\\Users\\Ada\\Documents\\Memolock\\2025_report (1).memolock',
      expect.any(String),
    )

    nativeApi.filesystem.getStats.mockReset().mockResolvedValue({ isFile: true })
    expect(await exportMemolockReport(report, lock, 'overwrite')).toEqual({
      status: 'exported',
      path: 'Documents\\Memolock\\2025_report.memolock',
    })
    expect(nativeApi.filesystem.writeFile).toHaveBeenLastCalledWith(
      'C:\\Users\\Ada\\Documents\\Memolock\\2025_report.memolock',
      expect.any(String),
    )
  })
})
