# Memolock

Memolock is a private, offline desktop application for recording, preserving,
and reviewing an annual personal report. It does not require an account, cloud
service, or installer.

Private by design. Memolock never connects to the internet. Your reports remain
on your computer and are stored in plain JSON files that you control.

## Warning

This project was vibecoded. Its source and generated executable should be
reviewed and tested before being trusted with important or irreplaceable data.
Keep independent backups of the local `data` folder. The application is
provided without a warranty.

## Features

- Separate reports for completed calendar years
- Books and visited places with detailed entries
- Daily steps, albums listened, sleep, and exercise statistics
- Light, dark, and true-black OLED themes with 30 accent colors
- Local JSON storage
- Permanent annual locking: once a year's report is locked, it becomes
  read-only forever. This preserves an authentic snapshot of that year and
  prevents accidental or intentional edits later.
- Portable `.memolock` report export and import
- Portable Windows executable

## Local data

On first launch, the portable application creates a `data` folder beside
`memolock-win_x64.exe`. Reports are stored in:

```text
data/annual-report.json
```

Back up this file before moving, replacing, or deleting the application.

## Memolock report files

Locking a report creates a readable JSON file in:

```text
Documents\Memolock\2025_report.memolock
```

Each file contains one annual report plus an explicit `LOCKED` or `UNLOCKED`
status code and lock timestamp. Import accepts `.memolock` files through the
native picker or drag and drop. An existing permanently locked year cannot be
replaced by an import.

## Technology

- Vue 3
- TypeScript
- Vite
- Neutralinojs
- Vitest

Electron is not used.

## Development

Install dependencies:

```powershell
npm install
```

Run the web development view:

```powershell
npm run dev
```

Run the tests:

```powershell
npm test
```

Build the portable Neutralino executable:

```powershell
npm run native:portable
```

## Release

The current release is `0.1.1`. Versioned build folders and release archives use
names such as `memolock-v0.1.1`. The portable archive contains
`memolock-win_x64.exe` at its root. Windows Defender SmartScreen may display an
"unrecognized app" warning the first time you run it because Memolock is not
yet digitally signed.

## Project agents

The `.codex` directory defines a four-agent workflow:

- `implementation` owns application source changes.
- `vitest` maintains and runs focused tests.
- `artifact_fixer` handles lockfiles and generated release artifacts.
- `ui_ux_reviewer` reviews usability, accessibility, responsiveness, and
  visual consistency.

The workflow is documented in `.codex/multi-agent-workflow.md`.
