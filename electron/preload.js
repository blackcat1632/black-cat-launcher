const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),

  // Profiles & auth
  loadProfiles:  ()    => ipcRenderer.invoke('load-profiles'),
  saveProfiles:  (p)   => ipcRenderer.invoke('save-profiles', p),
  loadAuth:      ()    => ipcRenderer.invoke('load-auth'),
  saveAuth:      (a)   => ipcRenderer.invoke('save-auth', a),

  // Microsoft login
  microsoftLogin: ()    => ipcRenderer.invoke('microsoft-login'),
  refreshAuth:    (a)   => ipcRenderer.invoke('refresh-auth', a),

  // Version lists
  getVersions:          ()  => ipcRenderer.invoke('get-versions'),
  getFabricLoaders:     (v) => ipcRenderer.invoke('get-fabric-loaders', v),
  getForgeVersions:     (v) => ipcRenderer.invoke('get-forge-versions', v),
  getNeoForgeVersions:  (v) => ipcRenderer.invoke('get-neoforge-versions', v),

  // Install
  installVersion:     (opts) => ipcRenderer.invoke('install-version', opts),
  onInstallProgress:  (cb)   => ipcRenderer.on('install-progress', (_, d) => cb(d)),

  // Launch
  launchGame:    (opts) => ipcRenderer.invoke('launch-game', opts),
  onLaunchLog:   (cb)   => ipcRenderer.on('launch-log',   (_, d) => cb(d)),
  onGameExited:  (cb)   => ipcRenderer.on('game-exited',  (_, d) => cb(d)),
  onGameCrashed: (cb)   => ipcRenderer.on('game-crashed', (_, d) => cb(d)),

  // Update
  checkUpdate:    ()    => ipcRenderer.invoke('check-update'),
  performUpdate:  (url) => ipcRenderer.invoke('perform-update', url),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_, d) => cb(d)),

  // Utils
  createShortcut:  (name) => ipcRenderer.invoke('create-shortcut', name),
  openCrashFolder: (name) => ipcRenderer.invoke('open-crash-folder', name),
  copyText:        (text) => ipcRenderer.invoke('copy-text', text),

  platform: process.platform,
});
