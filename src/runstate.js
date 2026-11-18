'use strict'
// Suivi de l'état d'exécution du client (18/11/2026). Les surveillants signalaient « l'application se ferme sans action de l'étudiant » sans qu'aucune
// trace ne dise pourquoi : une application qui meurt ne peut rien signaler. On écrit donc un petit fichier d'état : « en cours » au lancement, « terminé
// proprement » à la sortie normale. Au lancement suivant, un état resté « en cours » = arrêt anormal (plantage, processus tué, coupure de courant) :
// il est signalé au serveur à l'entrée en examen, avec l'heure du dernier battement et si l'examen était en cours.
const fs = require('fs')

function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
function write(file, st) { try { fs.writeFileSync(file, JSON.stringify(st)) } catch { /* disque en lecture seule : sans importance */ } }

/** À appeler au lancement : renvoie l'arrêt anormal précédent ({ at, examActive, examId, version, secondsAgo }) ou null, puis marque ce lancement « en cours ». */
function begin(file, { pid, version, now = Date.now() }) {
  const prev = read(file)
  let unclean = null
  if (prev && prev.running === true && prev.pid !== pid) {
    unclean = { at: prev.lastBeat || prev.startedAt || null, examActive: !!prev.examActive, examId: prev.examId || null, version: prev.version || '', secondsAgo: prev.lastBeat ? Math.round((now - prev.lastBeat) / 1000) : null }
  }
  write(file, { running: true, pid, version, startedAt: now, lastBeat: now, examActive: false, examId: null })
  return unclean
}

/** Battement périodique : l'heure du dernier signe de vie et l'état de l'examen. */
function beat(file, { examActive, examId, now = Date.now() }) {
  const st = read(file)
  if (!st || st.running !== true) return
  st.lastBeat = now; st.examActive = !!examActive; st.examId = examId || null
  write(file, st)
}

/** Sortie normale (fermeture voulue, code de sortie, fin de session Windows, mise à jour). */
function end(file) {
  const st = read(file)
  if (st) { st.running = false; st.endedAt = Date.now(); write(file, st) }
}

/** Raisons de plantage du moteur qui justifient un rechargement automatique de la page d'examen (et non une simple fermeture voulue). */
const RELOAD_REASONS = new Set(['crashed', 'oom', 'killed', 'launch-failed', 'integrity-failure', 'abnormal-exit'])
const shouldReload = reason => RELOAD_REASONS.has(String(reason || ''))

module.exports = { begin, beat, end, shouldReload, RELOAD_REASONS }
