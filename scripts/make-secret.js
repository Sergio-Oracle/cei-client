'use strict'
// Génère les secrets d'UNE génération de l'application : src/secret.json (embarqué dans le client) + build/server.env (à poser sur le serveur).
// Ne jamais versionner ces deux fichiers. Le secret du client et CEI_CLIENT_SECRET du serveur DOIVENT être identiques.
const crypto = require('crypto'), fs = require('fs'), path = require('path')
const root = path.join(__dirname, '..')
const clientSecret = crypto.randomBytes(32).toString('hex')
const quitCode = String(crypto.randomInt(100000, 999999)) + '-' + String(crypto.randomInt(1000, 9999))
const quitHash = crypto.createHash('sha256').update(quitCode).digest('hex')
fs.writeFileSync(path.join(root, 'src', 'secret.json'), JSON.stringify({ clientSecret, quitHash }))
fs.mkdirSync(path.join(root, 'build'), { recursive: true })
fs.writeFileSync(path.join(root, 'build', 'server.env'), `CEI_CLIENT_SECRET=${clientSecret}\n`, { mode: 0o600 })
fs.writeFileSync(path.join(root, 'build', 'quit-code.txt'), quitCode + '\n', { mode: 0o600 })
console.log('Secrets générés : src/secret.json, build/server.env (serveur), build/quit-code.txt (code de sortie d\'urgence à confier aux surveillants).')
