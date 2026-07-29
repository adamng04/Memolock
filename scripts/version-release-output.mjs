import { access, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import packageManifest from '../package.json' with { type: 'json' }

const distributionDirectory = resolve('dist')
const baseName = packageManifest.name
const versionedName = `${baseName}-v${packageManifest.version}`
const sourceFolder = resolve(distributionDirectory, baseName)
const versionedFolder = resolve(distributionDirectory, versionedName)
const sourceZip = resolve(distributionDirectory, `${baseName}-release.zip`)
const versionedZip = resolve(distributionDirectory, `${versionedName}.zip`)

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

if (!await exists(sourceFolder)) throw new Error(`Build folder missing: ${sourceFolder}`)
if (await exists(versionedFolder)) throw new Error(`Versioned build folder already exists: ${versionedFolder}`)

await rename(sourceFolder, versionedFolder)
console.log(`Versioned build folder: dist/${versionedName}`)

if (await exists(sourceZip)) {
  if (await exists(versionedZip)) throw new Error(`Versioned release ZIP already exists: ${versionedZip}`)
  await rename(sourceZip, versionedZip)
  console.log(`Versioned release ZIP: dist/${versionedName}.zip`)
}
