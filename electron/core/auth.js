/**
 * auth.js — 微軟 OAuth 2.0 + Xbox + Minecraft 正版驗證
 *
 * 流程：
 * 1. 開啟微軟登入頁面（BrowserWindow）
 * 2. 取得 Microsoft Token
 * 3. 用 MS Token 換取 Xbox Live Token
 * 4. 用 XBL Token 換取 XSTS Token
 * 5. 用 XSTS Token 取得 Minecraft Token
 * 6. 取得 Minecraft Profile（UUID + 玩家名稱）
 */

const { BrowserWindow, session } = require('electron');
const https = require('https');

// ── 你需要在 Azure Portal 申請一個 Client ID ──────────────────────────────────
// 申請步驟：https://docs.microsoft.com/azure/active-directory/develop/quickstart-register-app
// 1. 登入 https://portal.azure.com
// 2. Azure Active Directory → App registrations → New registration
// 3. Redirect URI 填 http://localhost:4892/callback
// 4. 複製 Application (client) ID 填入下方
const CLIENT_ID = process.env.MS_CLIENT_ID;
const REDIRECT_URI = 'http://localhost:4892/callback';
const SCOPE = 'XboxLive.signin offline_access';

function httpsPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof data === 'string' ? data : new URLSearchParams(data).toString();
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve(d); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsPostJson(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve(d); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
    };
    https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve(d); }
      });
    }).on('error', reject).end();
  });
}

// ── Step 1: 開啟微軟登入視窗，取得 auth code ──────────────────────────────────
function openMicrosoftLogin() {
  return new Promise((resolve, reject) => {
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
      + `?client_id=${CLIENT_ID}`
      + `&response_type=code`
      + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
      + `&scope=${encodeURIComponent(SCOPE)}`
      + `&prompt=select_account`;

    const win = new BrowserWindow({
      width: 520,
      height: 680,
      title: '使用 Microsoft 帳號登入',
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    win.loadURL(authUrl);

    win.webContents.on('will-redirect', (event, url) => {
      if (url.startsWith(REDIRECT_URI)) {
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get('code');
        const error = urlObj.searchParams.get('error');
        win.close();
        if (error) reject(new Error(error));
        else if (code) resolve(code);
        else reject(new Error('未取得授權碼'));
      }
    });

    win.on('closed', () => reject(new Error('使用者關閉了登入視窗')));
  });
}

// ── Step 2: auth code → MS access token ──────────────────────────────────────
async function getMicrosoftToken(authCode) {
  const res = await httpsPost(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    {
      client_id: CLIENT_ID,
      code: authCode,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
    }
  );
  if (!res.access_token) throw new Error('無法取得 Microsoft Token: ' + JSON.stringify(res));
  return res;
}

// ── Step 3: MS token → Xbox Live token ───────────────────────────────────────
async function getXboxLiveToken(msAccessToken) {
  const res = await httpsPostJson(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }
  );
  if (!res.Token) throw new Error('無法取得 Xbox Live Token');
  return { token: res.Token, userHash: res.DisplayClaims.xui[0].uhs };
}

// ── Step 4: XBL token → XSTS token ───────────────────────────────────────────
async function getXSTSToken(xblToken) {
  const res = await httpsPostJson(
    'https://xsts.auth.xboxlive.com/xsts/authorize',
    {
      Properties: {
        SandboxId: 'RETAIL',
        UserTokens: [xblToken],
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }
  );
  if (res.XErr) {
    const errors = {
      2148916233: '此 Microsoft 帳號沒有 Xbox 帳號，請先在 Xbox 網站建立',
      2148916238: '此帳號是未成年帳號，需要家長同意',
    };
    throw new Error(errors[res.XErr] || `XSTS 錯誤: ${res.XErr}`);
  }
  if (!res.Token) throw new Error('無法取得 XSTS Token');
  return res.Token;
}

// ── Step 5: XSTS → Minecraft token ───────────────────────────────────────────
async function getMinecraftToken(xstsToken, userHash) {
  const res = await httpsPostJson(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    { identityToken: `XBL3.0 x=${userHash};${xstsToken}` }
  );
  if (!res.access_token) throw new Error('無法取得 Minecraft Token');
  return res.access_token;
}

// ── Step 6: 取得 Minecraft 玩家資訊 ──────────────────────────────────────────
async function getMinecraftProfile(mcToken) {
  const res = await httpsGet(
    'https://api.minecraftservices.com/minecraft/profile',
    { Authorization: `Bearer ${mcToken}` }
  );
  if (!res.id) throw new Error('無法取得 Minecraft 資料（此帳號可能沒有購買 Minecraft）');
  return { uuid: res.id, username: res.name };
}

// ── 完整登入流程 ──────────────────────────────────────────────────────────────
async function microsoftLogin() {
  const authCode   = await openMicrosoftLogin();
  const msTokens   = await getMicrosoftToken(authCode);
  const { token: xblToken, userHash } = await getXboxLiveToken(msTokens.access_token);
  const xstsToken  = await getXSTSToken(xblToken);
  const mcToken    = await getMinecraftToken(xstsToken, userHash);
  const profile    = await getMinecraftProfile(mcToken);

  return {
    username: profile.username,
    uuid: profile.uuid,
    accessToken: mcToken,
    refreshToken: msTokens.refresh_token,
    expiresAt: Date.now() + (msTokens.expires_in * 1000),
  };
}

// ── Refresh token (靜默重新登入) ──────────────────────────────────────────────
async function refreshAuth(savedAuth) {
  try {
    if (!savedAuth?.refreshToken) throw new Error('無 refresh token');
    const msTokens = await httpsPost(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        client_id: CLIENT_ID,
        refresh_token: savedAuth.refreshToken,
        grant_type: 'refresh_token',
        scope: SCOPE,
      }
    );
    if (!msTokens.access_token) throw new Error('refresh 失敗');
    const { token: xblToken, userHash } = await getXboxLiveToken(msTokens.access_token);
    const xstsToken = await getXSTSToken(xblToken);
    const mcToken   = await getMinecraftToken(xstsToken, userHash);
    const profile   = await getMinecraftProfile(mcToken);
    return {
      username: profile.username,
      uuid: profile.uuid,
      accessToken: mcToken,
      refreshToken: msTokens.refresh_token || savedAuth.refreshToken,
      expiresAt: Date.now() + (msTokens.expires_in * 1000),
    };
  } catch(e) {
    throw new Error('自動重新登入失敗，請重新登入: ' + e.message);
  }
}

module.exports = { microsoftLogin, refreshAuth };
