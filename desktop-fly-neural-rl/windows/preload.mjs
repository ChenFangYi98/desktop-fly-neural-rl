// preload.mjs — the only bridge between the main process and the two renderers.
// The renderers get exactly the channels they need and nothing else.

import { contextBridge, ipcRenderer } from 'electron';

const on = (channel) => (fn) => {
  ipcRenderer.on(channel, (_e, payload) => fn(payload));
};

contextBridge.exposeInMainWorld('flyAPI', {
  getBrainData: () => ipcRenderer.invoke('brain-data'),

  // overlay renderer
  onAmbient: on('ambient'),
  onTerrain: on('terrain'),
  onTap: on('tap'),
  onCommand: on('cmd'),
  onRetarget: on('retarget'),
  onStimulate: on('stimulate'),
  sendSpikes: (list) => ipcRenderer.send('spikes', list),
  sendNeuralTelemetry: (snapshot) => ipcRenderer.send('neural-telemetry', snapshot),
  onTrainedSkill: on('trained-skill'),

  // brain renderer
  onSpikes: on('spikes'),
  onNeuralTelemetry: on('neural-telemetry'),
  stimulate: (req) => ipcRenderer.send('stimulate', req),
  applySkill: (skill) => ipcRenderer.send('apply-skill', skill),
  showWindow: (name) => ipcRenderer.send('show-window', name),
  saveOpenPolicy: (manifest) => ipcRenderer.invoke('open-policy-save', manifest),
  getLatestOpenPolicy: () => ipcRenderer.invoke('open-policy-latest'),
  onOpenPolicyAvailable: on('open-policy-available'),
});
