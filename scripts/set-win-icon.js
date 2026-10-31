#!/usr/bin/env node
'use strict'
/**
 * Incorpore l'icône CEI (et le nom du produit) dans « CEI Examen.exe » de dist/win-unpacked.
 * electron-builder le fait avec rcedit, qui exige Wine hors Windows : ici on modifie les ressources du .exe directement (resedit, sans Wine).
 * Sans cela, Windows affiche l'icône d'Electron dans l'Explorateur, le menu Démarrer et la barre des tâches.
 *   node scripts/set-win-icon.js [dossier win-unpacked]
 */
const fs = require('fs'), path = require('path')
const root = path.join(__dirname, '..')
const pkg = require('../package.json')
const dir = process.argv[2] || path.join(root, 'dist', 'win-unpacked')
const exePath = path.join(dir, 'CEI Examen.exe')
const icoPath = path.join(root, 'build', 'icon.ico')
if (!fs.existsSync(exePath)) { console.error('✘ introuvable : ' + exePath); process.exit(1) }

;(async () => {
  const ResEdit = await import('resedit')
  const R = ResEdit.default && ResEdit.default.NtExecutable ? ResEdit.default : ResEdit
  const exe = R.NtExecutable.from(fs.readFileSync(exePath))
  const res = R.NtExecutableResource.from(exe)
  const icons = R.Data.IconFile.from(fs.readFileSync(icoPath)).icons.map(i => i.data)
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries)
  if (!groups.length) { console.error('✘ aucun groupe d\'icônes dans le .exe'); process.exit(1) }
  for (const g of groups) R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icons)
  const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0]
  if (vi) {
    const v = pkg.version.split('.').map(Number)
    vi.setFileVersion(v[0], v[1], v[2], 0, 1033)
    vi.setProductVersion(v[0], v[1], v[2], 0, 1033)
    const strings = { FileDescription: 'CEI Examen', ProductName: 'CEI Examen', InternalName: 'CEI Examen', OriginalFilename: 'CEI Examen.exe',
      CompanyName: 'UN-CHK', LegalCopyright: 'Université Numérique Cheikh Hamidou Kane' }
    for (const l of vi.getAllLanguagesForStringValues()) vi.setStringValues(l, strings)
    vi.outputToResourceEntries(res.entries)
  }
  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
  console.log(`✔ icône CEI incorporée dans ${exePath}`)
})().catch(e => { console.error(e); process.exit(1) })
