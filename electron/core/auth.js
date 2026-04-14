/**
 * auth.js — 微軟 OAuth 2.0 + Xbox + Minecraft 正版驗證
 * 使用官方 Minecraft Client ID (live.com 端點)
 */

const { BrowserWindow } = require('electron');
const https = require('https');
const http  = require('http');

const CLIENT_ID    = '00000000402b5328';
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';
const SCOPE        = 'service::user.auth.xboxlive.com::MBI_SSL';

// ── HTTP 工具 ─────────────────────────────────────────────────────────────────
function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const body   = new URLSearchParams(data).toString();
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('[httpPost]', url, 'status:', res.statusCode, 'body:', d.substring(0, 300));
        try { resolve(JSON.parse(d)); } catch(e) { resolve(d); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpPostJson(url, data) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(data);
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Accept':         'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('[httpPostJson]', url, 'status:', res.statusCode, 'body:', d.substring(0, 300));
        try { resolve(JSON.parse(d)); } catch(e) { resolve(d); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.request({
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'GET',
      headers:  extraHeaders,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('[httpGet]', url, 'status:', res.statusCode);
        try { resolve(JSON.parse(d)); } catch(e) { resolve(d); }
      });
    }).on('error', reject).end();
  });
}

// ── Step 1: 開啟登入視窗，攔截 code ──────────────────────────────────────────
function openMicrosoftLogin() {
  return new Promise((resolve, reject) => {
    const authUrl = new URL('https://login.live.com/oauth20_authorize.srf');
    authUrl.searchParams.set('client_id',     CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri',  REDIRECT_URI);
    authUrl.searchParams.set('scope',         SCOPE);
    authUrl.searchParams.set('prompt',        'select_account');

    const win = new BrowserWindow({
      width: 500, height: 660,
      title: '使用 Microsoft 帳號登入',
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    win.loadURL(authUrl.toString());

    const handleUrl = (url) => {
      if (!url || !url.startsWith('https://login.live.com/oauth20_desktop.srf')) return false;
      console.log('[Auth] 攔截到 callback:', url.substring(0, 120));
      const urlObj = new URL(url);
      const code   = urlObj.searchParams.get('code');
      const error  = urlObj.searchParams.get('error');
      try { win.close(); } catch(e) {}
      if (error) reject(new Error(error));
      else if (code) resolve(code);
      else reject(new Error('未取得授權碼'));
      return true;
    };

    win.webContents.on('will-redirect', (e, url) => { if (handleUrl(url)) e.preventDefault(); });
    win.webContents.on('will-navigate',  (e, url) => { if (handleUrl(url)) e.preventDefault(); });
    win.webContents.on('did-navigate',   (e, url) => { handleUrl(url); });
    win.on('closed', () => reject(new Error('使用者關閉了登入視窗')));
  });
}

// ── Step 2: code → MS Token ───────────────────────────────────────────────────
async function getMicrosoftToken(authCode) {
  const res = await httpPost(
    'https://login.live.com/oauth20_token.srf',
    {
      client_id:     CLIENT_ID,
      code:          authCode,
      grant_type:    'authorization_code',
      redirect_uri:  REDIRECT_URI,
      scope:         SCOPE,
    }
  );
  if (!res.access_token) throw new Error('無法取得 Microsoft Token: ' + (res.error_description || JSON.stringify(res)));
  return res;
}

// ── Step 3: MS Token → Xbox Live Token ───────────────────────────────────────
async function getXboxLiveToken(msAccessToken) {
  const res = await httpPostJson(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      Properties: {
        AuthMethod: 'RPS',
        SiteName:   'user.auth.xboxlive.com',
       RpsTicket: msAccessToken,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType:    'JWT',
    }
  );
  if (!res.Token) throw new Error('無法取得 Xbox Live Token: ' + JSON.stringify(res));
  return { token: res.Token, userHash: res.DisplayClaims.xui[0].uhs };
}

// ── Step 4: XBL Token → XSTS Token ───────────────────────────────────────────
async function getXSTSToken(xblToken) {
  const res = await httpPostJson(
    'https://xsts.auth.xboxlive.com/xsts/authorize',
    {
      Properties:   { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType:    'JWT',
    }
  );
  if (res.XErr) {
    const errors = {
      2148916233: '此帳號沒有 Xbox 帳號，請先至 xbox.com 建立',
      2148916238: '此為未成年帳號，需要家長同意',
    };
    throw new Error(errors[res.XErr] || `XSTS 錯誤代碼: ${res.XErr}`);
  }
  if (!res.Token) throw new Error('無法取得 XSTS Token: ' + JSON.stringify(res));
  return res.Token;
}

// ── Step 5: XSTS → Minecraft Token ───────────────────────────────────────────
async function getMinecraftToken(xstsToken, userHash) {
  const res = await httpPostJson(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    { identityToken: `XBL3.0 x=${userHash};${xstsToken}` }
  );
  if (!res.access_token) throw new Error('無法取得 Minecraft Token: ' + JSON.stringify(res));
  return res.access_token;
}

// ── Step 6: Minecraft Profile ─────────────────────────────────────────────────
async function getMinecraftProfile(mcToken) {
  const res = await httpGet(
    'https://api.minecraftservices.com/minecraft/profile',
    { Authorization: `Bearer ${mcToken}` }
  );
  if (res.error || !res.id) throw new Error('此帳號未購買 Minecraft Java Edition');
  return { uuid: res.id, username: res.name };
}

// ── 完整登入流程 ──────────────────────────────────────────────────────────────
async function microsoftLogin() {
  console.log('[Auth] 啟動登入...');
  const authCode = await openMicrosoftLogin();
  console.log('[Auth] 取得 authCode，換 token...');

  const msTokens                      = await getMicrosoftToken(authCode);
  const { token: xblToken, userHash } = await getXboxLiveToken(msTokens.access_token);
  const xstsToken                     = await getXSTSToken(xblToken);
  const mcToken                       = await getMinecraftToken(xstsToken, userHash);
  const profile                       = await getMinecraftProfile(mcToken);

  console.log('[Auth] 登入成功:', profile.username);
  return {
    username:     profile.username,
    uuid:         profile.uuid,
    accessToken:  mcToken,
    refreshToken: msTokens.refresh_token,
    expiresAt:    Date.now() + (msTokens.expires_in * 1000),
  };
}

// ── Refresh ───────────────────────────────────────────────────────────────────
async function refreshAuth(savedAuth) {
  if (!savedAuth?.refreshToken) throw new Error('無 refresh token，請重新登入');
  const msTokens = await httpPost(
    'https://login.live.com/oauth20_token.srf',
    {
      client_id:     CLIENT_ID,
      refresh_token: savedAuth.refreshToken,
      grant_type:    'refresh_token',
      scope:         SCOPE,
    }
  );
  if (!msTokens.access_token) throw new Error('自動重新登入失敗，請手動登入');
  const { token: xblToken, userHash } = await getXboxLiveToken(msTokens.access_token);
  const xstsToken = await getXSTSToken(xblToken);
  const mcToken   = await getMinecraftToken(xstsToken, userHash);
  const profile   = await getMinecraftProfile(mcToken);
  return {
    username:     profile.username,
    uuid:         profile.uuid,
    accessToken:  mcToken,
    refreshToken: msTokens.refresh_token || savedAuth.refreshToken,
    expiresAt:    Date.now() + (msTokens.expires_in * 1000),
  };
}

module.exports = { microsoftLogin, refreshAuth };
