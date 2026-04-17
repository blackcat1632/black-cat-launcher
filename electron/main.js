const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

const BASE_DIR = isDev
  ? path.join(__dirname, '../../game-data')
  : path.join(path.dirname(process.execPath), 'game-data');

fs.mkdirSync(BASE_DIR, { recursive: true });

const { ensureJava }       = require('./core/java');
const { getReleaseVersions } = require('./core/versions');
const { installVersion }   = require('./core/installer');
const { installFabric, getFabricLoaderVersions } = require('./core/fabric');
const { installForge, getForgeVersions, installNeoForge, getNeoForgeVersions } = require('./core/forge');
const { launchGame }       = require('./core/launcher');
const discord              = require('./core/discord');

let mainWindow;
let runningGame = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 780, minWidth: 900, minHeight: 600,
    title: '黑貓啟動器',
    icon: path.join(__dirname, '../public/icon.ico'),
    frame: false,
    backgroundColor: '#1a1d2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });
  if (isDev) mainWindow.loadURL('http://localhost:5173');
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(() => {
  createWindow();
  discord.connect();
});
app.on('window-all-closed', () => { discord.disconnect(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function send(ch, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, ...args);
}

// Window controls
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close',    () => mainWindow.close());

// Profiles
const profilesFile = path.join(BASE_DIR, 'profiles.json');
ipcMain.handle('load-profiles', async () => {
  try { if (fs.existsSync(profilesFile)) return JSON.parse(fs.readFileSync(profilesFile,'utf-8')); } catch(e) {}
  return [];
});
ipcMain.handle('save-profiles', async (_, p) => {
  try { fs.writeFileSync(profilesFile, JSON.stringify(p,null,2)); return true; } catch(e) { return false; }
});

// Auth
const authFile = path.join(BASE_DIR, 'auth.json');
ipcMain.handle('load-auth', async () => {
  try { if (fs.existsSync(authFile)) return JSON.parse(fs.readFileSync(authFile,'utf-8')); } catch(e) {}
  return null;
});
ipcMain.handle('save-auth', async (_, a) => {
  try { fs.writeFileSync(authFile, JSON.stringify(a,null,2)); return true; } catch(e) { return false; }
});

// Version lists
ipcMain.handle('get-versions', async () => {
  try { return await getReleaseVersions(); } catch(e) { return []; }
});
ipcMain.handle('get-fabric-loaders', async () => {
  try { return await getFabricLoaderVersions(); } catch(e) { return []; }
});
ipcMain.handle('get-forge-versions', async (_, mcVer) => {
  try { return await getForgeVersions(mcVer); } catch(e) { return []; }
});
ipcMain.handle('get-neoforge-versions', async (_, mcVer) => {
  try { return await getNeoForgeVersions(mcVer); } catch(e) { return []; }
});

// Install
ipcMain.handle('install-version', async (_, { profileId, mcVersion, loader, loaderVer }) => {
  try {
    send('install-progress', { profileId, stage:'java', pct:0, msg:'準備 Java...' });
    discord.setInstallingActivity(mcVersion);
    const javaExe = await ensureJava(BASE_DIR, mcVersion, (pct,_t,msg) => {
      send('install-progress', { profileId, stage:'java', pct, msg });
    });

    await installVersion(mcVersion, BASE_DIR, (info) => {
      send('install-progress', { profileId, ...info });
    });

    let installedVersionId = mcVersion;

    if (loader === 'Fabric') {
      const lv = loaderVer && loaderVer !== '—' ? loaderVer : (await getFabricLoaderVersions())[0];
      send('install-progress', { profileId, stage:'loader', pct:0, msg:`安裝 Fabric ${lv}...` });
      const res = await installFabric(mcVersion, lv, BASE_DIR, (info) => {
        send('install-progress', { profileId, stage:'loader', ...info });
      });
      installedVersionId = res.fabricId;
    }
    if (loader === 'Forge') {
      const list = await getForgeVersions(mcVersion);
      const fv = loaderVer && loaderVer !== '—' ? loaderVer : (list[0]?.value||'');
      if (fv) {
        send('install-progress', { profileId, stage:'loader', pct:0, msg:`安裝 Forge ${fv}...` });
        await installForge(mcVersion, fv, BASE_DIR, javaExe, (info) => {
          send('install-progress', { profileId, stage:'loader', ...info });
        });
        installedVersionId = `${mcVersion}-forge-${fv.replace(`${mcVersion}-`,'')}`;
      }
    }
    if (loader === 'NeoForge') {
      const list = await getNeoForgeVersions(mcVersion);
      const nv = loaderVer && loaderVer !== '—' ? loaderVer : (list[0]||'');
      if (nv) {
        send('install-progress', { profileId, stage:'loader', pct:0, msg:`安裝 NeoForge ${nv}...` });
        await installNeoForge(mcVersion, nv, BASE_DIR, javaExe, (info) => {
          send('install-progress', { profileId, stage:'loader', ...info });
        });
        installedVersionId = `neoforge-${nv}`;
      }
    }

    discord.setIdleActivity();
    send('install-progress', { profileId, stage:'done', pct:100, msg:'安裝完成！' });
    return { success:true, installedVersionId };
  } catch(e) {
    send('install-progress', { profileId, stage:'error', pct:0, msg:`安裝失敗: ${e.message}` });
    return { success:false, error:e.message };
  }
});

// Launch
ipcMain.handle('launch-game', async (_, { profile, auth }) => {
  if (runningGame) return { success:false, error:'遊戲已在執行中' };
  try {
    const javaExe = await ensureJava(BASE_DIR, profile.ver, (pct,_t,msg) => send('launch-log', `[Java] ${msg}`));
    send('launch-log', `▶ 正在啟動 ${profile.name}...`);
    discord.setPlayingActivity(profile.name, profile.ver, profile.loader);
    const proc = await launchGame({
      profile, baseDir:BASE_DIR, javaExe,
      accessToken: auth?.accessToken||null,
      uuid: auth?.uuid||null,
      username: auth?.username||profile.name,
      onLog: (msg) => send('launch-log', msg),
      onExit: (code) => {
        runningGame = null;
        discord.setIdleActivity();
        if (code === 0) { send('game-exited', { code:0 }); return; }
        const crashDir = path.join(BASE_DIR,'instances',profile.name.replace(/[^a-zA-Z0-9_\-]/g,'_'),'crash-reports');
        let crashLog = '';
        if (fs.existsSync(crashDir)) {
          const files = fs.readdirSync(crashDir).sort().reverse();
          if (files.length > 0) crashLog = fs.readFileSync(path.join(crashDir,files[0]),'utf-8');
        }
        send('game-crashed', { code, crashLog: crashLog||`遊戲以代碼 ${code} 退出` });
      },
    });
    runningGame = proc;
    return { success:true };
  } catch(e) { return { success:false, error:e.message }; }
});

// Shortcut
ipcMain.handle('create-shortcut', async (_, name) => {
  try {
    if (process.platform === 'win32') {
      shell.writeShortcutLink(path.join(os.homedir(),'Desktop',`${name||'黑貓啟動器'}.lnk`), {
        target: process.execPath, description:`黑貓啟動器 - ${name}`,
        icon: path.join(__dirname,'../public/icon.ico'), iconIndex:0,
      });
    }
    return { success:true };
  } catch(e) { return { success:false, error:e.message }; }
});

ipcMain.handle('open-crash-folder', async (_, name) => {
  const dir = name
    ? path.join(BASE_DIR,'instances',name.replace(/[^a-zA-Z0-9_\-]/g,'_'),'crash-reports')
    : BASE_DIR;
  fs.mkdirSync(dir,{recursive:true});
  shell.openPath(dir);
});

ipcMain.handle('copy-text', async (_, text) => {
  require('electron').clipboard.writeText(text); return true;
});

// check-update handled by updater module below

// ── Auth (Microsoft OAuth) ────────────────────────────────────────────────────
const { microsoftLogin, refreshAuth } = require('./core/auth');
const { checkForUpdate, performUpdate } = require('./core/updater');

ipcMain.handle('microsoft-login', async () => {
  try {
    const auth = await microsoftLogin();
    return { success: true, auth };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('refresh-auth', async (_, savedAuth) => {
  try {
    const auth = await refreshAuth(savedAuth);
    return { success: true, auth };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// ── Updater ───────────────────────────────────────────────────────────────────
ipcMain.handle('check-update', async () => {
  return await checkForUpdate();
});

ipcMain.handle('perform-update', async (_, downloadUrl) => {
  try {
    await performUpdate(downloadUrl, (pct, msg) => {
      send('update-progress', { pct, msg });
    });
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});