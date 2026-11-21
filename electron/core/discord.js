/**
 * discord.js — Discord Rich Presence
 */

const DISCORD_CLIENT_ID = '1492380713083998301';

let rpc = null;
let connected = false;
let startTime = null;

function getDiscordRPC() {
  try {
    return require('discord-rpc');
  } catch(e) {
    console.log('[Discord] discord-rpc 未安裝，跳過 RPC 功能');
    return null;
  }
}

async function connect() {
  const DiscordRPC = getDiscordRPC();
  if (!DiscordRPC) return false;
  try {
    rpc = new DiscordRPC.Client({ transport: 'ipc' });
    rpc.on('ready', () => {
      connected = true;
      console.log('[Discord] RPC 連線成功');
      setLauncherActivity();
    });
    rpc.on('disconnected', () => {
      connected = false;
      console.log('[Discord] RPC 已斷線');
    });
    await rpc.login({ clientId: DISCORD_CLIENT_ID });
    return true;
  } catch(e) {
    console.log('[Discord] RPC 連線失敗:', e.message);
    connected = false;
    return false;
  }
}

function setLauncherActivity() {
  if (!rpc || !connected) return;
  try {
    rpc.setActivity({
      details:        '在啟動器中',
      state:          '選擇遊戲版本',
      largeImageKey:  'logo',
      largeImageText: '黑貓啟動器',
      smallImageKey:  'logo',
      smallImageText: '黑貓啟動器 v1.0.0',
      startTimestamp: startTime || new Date(),
      buttons: [
        { label: '下載啟動器', url: 'https://github.com/blackcat1632/black-cat-launcher' },
      ],
    });
  } catch(e) {
    console.log('[Discord] 設定 activity 失敗:', e.message);
  }
}

function setPlayingActivity(profileName, mcVersion, loader) {
  if (!rpc || !connected) return;
  startTime = new Date();
  try {
    const loaderText = loader && loader !== 'Vanilla' ? ` (${loader})` : '';
    rpc.setActivity({
      details:        `正在遊玩 Minecraft ${mcVersion}${loaderText}`,
      state:          `安裝檔：${profileName}`,
      largeImageKey:  'logo',
      largeImageText: `Minecraft ${mcVersion}`,
      smallImageKey:  'logo',
      smallImageText: '黑貓啟動器',
      startTimestamp: startTime,
      buttons: [
        { label: '下載啟動器', url: 'https://github.com/const GITHUB_REPO = blackcat1632/black-cat-launcher' },
      ],
    });
  } catch(e) {
    console.log('[Discord] 設定遊戲 activity 失敗:', e.message);
  }
}

function setInstallingActivity(mcVersion) {
  if (!rpc || !connected) return;
  try {
    rpc.setActivity({
      details:        `安裝 Minecraft ${mcVersion}`,
      state:          '下載遊戲檔案中...',
      largeImageKey:  'logo',
      largeImageText: '黑貓啟動器',
      startTimestamp: new Date(),
    });
  } catch(e) {}
}

function setIdleActivity() {
  if (!rpc || !connected) return;
  startTime = null;
  setLauncherActivity();
}

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
