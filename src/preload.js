'use strict'
// Pont minimal entre la page CEI et le client : la page peut demander le mode examen et lire les alertes du client.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ceiClient', {
  isCEIClient: true,
  info: () => ipcRenderer.invoke('cei:info'),
  status: () => ipcRenderer.invoke('cei:status'),
  sign: (nonce, userId, examId) => ipcRenderer.invoke('cei:sign', { nonce, userId, examId }),
  askMedia: () => ipcRenderer.invoke('cei:ask-media'),
  listApps: () => ipcRenderer.invoke('cei:apps'),
  closeApps: () => ipcRenderer.invoke('cei:apps-close'),
  enterExamMode: opts => ipcRenderer.invoke('cei:enter', opts || {}),
  configure: opts => ipcRenderer.invoke('cei:configure', opts || {}),      // identité de l'examen, sites d'assistance et applications tolérées (avant l'entrée en mode examen)
  openAssist: url => ipcRenderer.invoke('cei:assist-open', url),
  closeAssist: () => ipcRenderer.invoke('cei:assist-close'),
  leaveExamMode: () => ipcRenderer.invoke('cei:leave'),
})

ipcRenderer.on('cei:event', (_e, d) => {
  window.dispatchEvent(new CustomEvent('cei-client-event', { detail: JSON.stringify(d) }))
})

if (process.env.CEI_TEST === '1') {          // aides d'essai : jamais présentes en exploitation
  contextBridge.exposeInMainWorld('__test', k => ipcRenderer.invoke('cei:test-input', k === 'F12'
    ? { type: 'keyDown', keyCode: 'F12' } : { type: 'keyDown', keyCode: 'W', modifiers: ['control'] }))
  contextBridge.exposeInMainWorld('__testBlur', () => ipcRenderer.invoke('cei:test-blur'))
  contextBridge.exposeInMainWorld('__testClose', () => ipcRenderer.invoke('cei:test-close'))
  contextBridge.exposeInMainWorld('__testQuit', code => ipcRenderer.invoke('cei:test-quit', code))
  contextBridge.exposeInMainWorld('__testKeys', spec => ipcRenderer.invoke('cei:test-input', spec))
}
