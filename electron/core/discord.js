/**
 * discord.js — Discord Rich Presence
 * 顯示遊戲狀態在 Discord 個人資料上
 */

const { BrowserWindow } = require('electron');

// Discord Application ID
// 申請：https://discord.com/developers/applications
// 建立新應用程式 → 複製 Application ID 填入下方
const DISCORD_CLIENT_ID = '1492380713083998301';

let rpc = null;
let connected = false;
let startTime = null;

// 嘗試載入 discord-rpc 套件
function getDiscordRPC() {
  try {
    return require('discord-rpc');
  } catch(e) {
    console.log('[Discord] discord-rpc 未安裝，跳過 RPC 功能');
    return null;
  }
}

// 連線到 Discord
async function connect() {
  const DiscordRPC = getDiscordRPC();
  if (!DiscordRPC) return false;

  try {
    rpc = new DiscordRPC.Client({ transport: 'ipc' });

    rpc.on('ready', () => {
      connected = true;
      console.log('[Discord] RPC 連線成功');
      // 設定預設狀態（啟動器開啟）
      setLauncherActivity();
    });

    rpc.on('disconnected', () => {
      connected = false;
      console.log('[Discord] RPC 已斷線');
    });

    await rpc.login({ clientId: DISCORD_CLIENT_ID });
    return true;
  } catch(e) {
    console.log('[Discord] RPC 連線失敗（Discord 未開啟或未登入）:', e.message);
    connected = false;
    return false;
  }
}

// 設定啟動器狀態
function setLauncherActivity() {
  if (!rpc || !connected) return;
  try {
    rpc.setActivity({
      details:    '使用黑貓啟動器遊玩Minecraft中',
      state:      '遊玩世界',
      largeImageKey:  'logo',
      largeImageText: '黑貓啟動器',
      smallImageKey:  'cat_icon',
      smallImageText: 'BlackCatLauncher v1.0.0',
      startTimestamp: startTime || new Date(),
      buttons: [
        { label: '下載啟動器', url: 'https://github.com/biggestlily1632/black-cat-launcher' },
      ],
    });
  } catch(e) {
    console.log('[Discord] 設定 activity 失敗:', e.message);
  }
}

// 設定遊戲中狀態
function setPlayingActivity(profileName, mcVersion, loader) {
  if (!rpc || !connected) return;
  startTime = new Date();
  try {
    const loaderText = loader && loader !== 'Vanilla' ? ` (${loader})` : '';
    rpc.setActivity({
      details:    `正在遊玩 Minecraft ${mcVersion}${loaderText}`,
      state:      `安裝檔：${profileName}`,
      largeImageKey:  'minecraft_icon',
      largeImageText: `Minecraft ${mcVersion}`,
      smallImageKey:  'launcher_icon',
      smallImageText: '黑貓啟動器',
      startTimestamp: startTime,
      buttons: [
        { label: '下載啟動器', url: 'https://github.com/biggestlily1632/black-cat-launcher' },
      ],
    });
  } catch(e) {
    console.log('[Discord] 設定遊戲 activity 失敗:', e.message);
  }
}

// 設定安裝中狀態
function setInstallingActivity(mcVersion) {
  if (!rpc || !connected) return;
  try {
    rpc.setActivity({
      details:    `安裝 Minecraft ${mcVersion}`,
      state:      '下載遊戲檔案中...',
      largeImageKey:  'launcher_icon',
      largeImageText: '黑貓啟動器',
      startTimestamp: new Date(),
    });
  } catch(e) {}
}

// 回到啟動器狀態
function setIdleActivity() {
  if (!rpc || !connected) return;
  startTime = null;
  setLauncherActivity();
}

// 斷線
function disconnect() {
  if (rpc) {
    try { rpc.clearActivity(); } catch(e) {}
    setTimeout(() => {
      try { rpc.destroy(); } catch(e) {}
      rpc = null;
      connected = false;
    }, 500);
  }
}

module.exports = { connect, disconnect, setLauncherActivity, setPlayingActivity, setInstallingActivity, setIdleActivity };