'use strict'
/**
 * Mise à jour automatique de CEI Examen — logique pure (sans Electron), testée seule.
 *
 * Principe : le serveur publie `GET /api/exam-client/releases` ; la partie `updates` liste, pour chaque système, le fichier
 * qui permet de se mettre à jour SANS intervention (Windows : installateur silencieux ; Linux AppImage : remplacement du fichier ;
 * macOS : archive .zip qui remplace l'application). Chaque entrée porte sa somme SHA-256 ET une signature HMAC calculée avec le secret
 * embarqué dans l'application : un fichier déposé sur le serveur sans ce secret n'est jamais installé.
 *
 * Jamais pendant un examen : la décision est prise par main.js (qui connaît l'état du mode examen).
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

/** Compare deux versions « 1.2.10 » : 1 si a > b, -1 si a < b, 0 si égales. */
function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(x => parseInt(x, 10) || 0), pb = String(b || '0').split('.').map(x => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1 }
  return 0
}

/** Signature d'un fichier de mise à jour (même formule côté publication : scripts/publish.js). */
function signUpdate(secret, version, name, sha256) {
  return crypto.createHmac('sha256', String(secret)).update(`update|${version}|${name}|${sha256}`).digest('hex')
}

function sigOk(secret, version, entry) {
  if (!entry || !entry.sig || !entry.sha256 || !entry.name) return false
  const want = Buffer.from(signUpdate(secret, version, entry.name, entry.sha256), 'hex'), got = Buffer.from(String(entry.sig), 'hex')
  return want.length === got.length && crypto.timingSafeEqual(want, got)
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

/**
 * Quelle mise à jour proposer à CE poste ? Retourne { version, entry, mode } ou { version, manual: true } (plus récent mais pas
 * installable automatiquement : paquet .deb, macOS sans archive…) ou null (à jour / rien de publié).
 * `ctx` : { platform, arch, current, appImage (chemin si lancé depuis un AppImage), secret }
 */
function selectUpdate(rel, ctx) {
  if (!rel || !rel.version || cmpVersion(rel.version, ctx.current) <= 0) return null
  const list = (rel.updates || []).filter(u => u && u.platform === ctx.platform && SAFE_NAME.test(String(u.name || '')) &&
    (u.arch === ctx.arch || u.arch === 'universal' || (ctx.platform === 'win32' && u.arch === 'x64')))
  const want = ctx.platform === 'win32' ? 'nsis' : ctx.platform === 'darwin' ? 'mac-zip' : (ctx.appImage ? 'appimage' : '')
  const entry = list.find(u => u.mode === want)
  if (!entry || !sigOk(ctx.secret, rel.version, entry)) return { version: rel.version, manual: true }
  return { version: rel.version, entry, mode: want }
}

/** Télécharge `url` dans `dest` en calculant la somme SHA-256 au fil de l'eau. `fetchFn` : fetch compatible (net.fetch d'Electron en production). */
async function download({ fetchFn, url, dest, expectedSha256, expectedSize, onProgress, signal }) {
  const res = await fetchFn(url, { signal })
  if (!res.ok || !res.body) throw new Error(`téléchargement refusé (${res.status})`)
  const total = Number(res.headers.get('content-length')) || expectedSize || 0
  const hash = crypto.createHash('sha256')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const out = fs.createWriteStream(dest, { mode: 0o755 })
  let got = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value); got += value.length
      if (!out.write(value)) await new Promise(r => out.once('drain', r))
      if (onProgress && total) onProgress(Math.min(1, got / total))
    }
    await new Promise((res2, rej) => out.end(err => err ? rej(err) : res2()))
  } catch (e) { try { out.destroy() } catch { /* flux déjà fermé */ } try { fs.rmSync(dest, { force: true }) } catch { /* rien */ } throw e }
  const sha = hash.digest('hex')
  if (expectedSha256 && sha !== expectedSha256) { try { fs.rmSync(dest, { force: true }) } catch { /* rien */ } throw new Error('somme de contrôle incorrecte : fichier refusé') }
  return sha
}

/** Windows : commande exécutée APRÈS la fermeture de l'application — installateur silencieux (/S, sans droits administrateur) puis relance. */
function winRelaunchCommand(setupPath, exePath) {
  const q = s => `"${String(s).replace(/"/g, '')}"`
  return `ping -n 4 127.0.0.1 >nul & ${q(setupPath)} /S & start "" ${q(exePath)}`
}

/** macOS : script exécuté après la fermeture de l'application — remplace le paquet .app par celui de l'archive, retire la quarantaine, relance. */
function macReplaceScript() {
  return [
    '#!/bin/sh',
    '# $1 = pid de l\'application, $2 = archive .zip, $3 = chemin de CEI Examen.app',
    'PID="$1"; ZIP="$2"; APP="$3"',
    'i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 60 ]; do sleep 0.5; i=$((i+1)); done',
    'TMP="$(mktemp -d)" || exit 1',
    'ditto -x -k "$ZIP" "$TMP" || { rm -rf "$TMP"; open "$APP"; exit 1; }',
    'NEW="$(ls -d "$TMP"/*.app 2>/dev/null | head -n 1)"',
    '[ -n "$NEW" ] || { rm -rf "$TMP"; open "$APP"; exit 1; }',
    'rm -rf "$APP.old"',
    'if mv "$APP" "$APP.old" && mv "$NEW" "$APP"; then xattr -cr "$APP" 2>/dev/null; rm -rf "$APP.old" "$TMP" "$ZIP"; else rm -rf "$APP"; mv "$APP.old" "$APP"; rm -rf "$TMP"; fi',
    'open "$APP"',
  ].join('\n') + '\n'
}

/** Linux : commande exécutée après la fermeture — relance du nouvel AppImage (variables du lanceur AppImage retirées par main.js). */
function linuxRelaunchCommand(target) { return `sleep 2; exec "${String(target).replace(/"/g, '')}"` }

module.exports = { cmpVersion, signUpdate, sigOk, selectUpdate, download, winRelaunchCommand, macReplaceScript, linuxRelaunchCommand, SAFE_NAME }
