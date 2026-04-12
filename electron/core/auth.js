/**
 * auth.js — 微軟 OAuth 2.0 + Xbox + Minecraft 正版驗證
 * 使用公用用戶端流程（PKCE），不需要 client_secret
 */

const { BrowserWindow } = require('electron');
const https = require('https');
const http  = require('http');
const crypto = require('crypto');

const CLIENT_ID    = process.env.MS_CLIENT_ID;
const REDIRECT_URI = 'http://localhost:4892/callback';
const SCOPE        = 'XboxLive.signin offline_access openid profile email';

// ── PKCE 工具 ─────────────────────────────────────────────────────────────────
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ── HTTP 工具 ─────────────────────────────────────────────────────────────────
function httpPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body    = new URLSearchParams(data).toString();
    const urlObj  = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpPostJson(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(data);
    const urlObj  = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Accept':         'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj  = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'GET',
      headers,
    };
    https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    }).on('error', reject).end();
  });
}

// ── 本地 HTTP Server 接收 callback ────────────────────────────────────────────
function startCallbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:4892`);
      const code  = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>${error ? '❌ 登入失敗' : '✅ 登入成功！'}</h2>
        <p>${error ? error : '請回到黑貓啟動器繼續。'}</p>
        <script>window.close();</script>
      </body></html>`);

      server.close();
      if (error) reject(new Error(error));
      else if (code) resolve(code);
      else reject(new Error('未取得授權碼'));
    });

    server.listen(4892, '127.0.0.1', () => {});
    server.on('error', reject);

    // 30 秒逾時
    setTimeout(() => {
      server.close();
      reject(new Error('登入逾時，請重試'));
    }, 30000);
  });
}

// ── Step 1: 開啟登入視窗 ──────────────────────────────────────────────────────
async function openMicrosoftLogin(codeChallenge) {
  const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  authUrl.searchParams.set('client_id',             CLIENT_ID);
  authUrl.searchParams.set('response_type',         'code');
  authUrl.searchParams.set('redirect_uri',          REDIRECT_URI);
  authUrl.searchParams.set('scope',                 SCOPE);
  authUrl.searchParams.set('code_challenge',        codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('prompt',                'select_account');

  const win = new BrowserWindow({
    width: 520, height: 680,
    title: '使用 Microsoft 帳號登入',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  win.loadURL(authUrl.toString());

  return new Promise((resolve, reject) => {
    win.on('closed', () => reject(new Error('使用者關閉了登入視窗')));
  });
}

// ── Step 2: 換取 MS Token（PKCE，不需要 client_secret）───────────────────────
async function getMicrosoftToken(authCode, codeVerifier) {
  const res = await httpPost(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    {
      client_id:     CLIENT_ID,
      code:          authCode,
      grant_type:    'authorization_code',
      redirect_uri:  REDIRECT_URI,
      code_verifier: codeVerifier,
      scope:         SCOPE,
    }
  );
  if (!res.access_token) throw new Error('無法取得 Microsoft Token: ' + (res.error_description || JSON.stringify(res)));
  return res;
}

// ── Step 3: Xbox Live ─────────────────────────────────────────────────────────
async function getXboxLiveToken(msAccessToken) {
  const res = await httpPostJson(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }
  );
  if (!res.Token) throw new Error('無法取得 Xbox Live Token');
  return { token: res.Token, userHash: res.DisplayClaims.xui[0].uhs };
}

// ── Step 4: XSTS ──────────────────────────────────────────────────────────────
async function getXSTSToken(xblToken) {
  const res = await httpPostJson(
    'https://xsts.auth.xboxlive.com/xsts/authorize',
    {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }
  );
  if (res.XErr) {
    const errors = {
      2148916233: '此帳號沒有 Xbox 帳號，請先至 xbox.com 建立',
      2148916238: '此為未成年帳號，需要家長同意',
    };
    throw new Error(errors[res.XErr] || `XSTS 錯誤: ${res.XErr}`);
  }
  if (!res.Token) throw new Error('無法取得 XSTS Token');
  return res.Token;
}

// ── Step 5: Minecraft Token ───────────────────────────────────────────────────
async function getMinecraftToken(xstsToken, userHash) {
  const res = await httpPostJson(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    { identityToken: `XBL3.0 x=${userHash};${xstsToken}` }
  );
  if (!res.access_token) throw new Error('無法取得 Minecraft Token');
  return res.access_token;
}

// ── Step 6: Minecraft Profile ─────────────────────────────────────────────────
async function getMinecraftProfile(mcToken) {
  const res = await httpGet(
    'https://api.minecraftservices.com/minecraft/profile',
    { Authorization: `Bearer ${mcToken}` }
  );
  if (res.error) throw new Error('此帳號未購買 Minecraft Java Edition');
  if (!res.id)   throw new Error('無法取得玩家資料');
  return { uuid: res.id, username: res.name };
}

// ── 完整登入流程 ──────────────────────────────────────────────────────────────
async function microsoftLogin() {
  if (!CLIENT_ID) throw new Error('未設定 MS_CLIENT_ID，請確認 .env 檔案');

  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // 同時啟動本地 server 和登入視窗
  const [authCode] = await Promise.all([
    startCallbackServer(),
    openMicrosoftLogin(codeChallenge),
  ]);

  const msTokens  = await getMicrosoftToken(authCode, codeVerifier);
  const { token: xblToken, userHash } = await getXboxLiveToken(msTokens.access_token);
  const xstsToken = await getXSTSToken(xblToken);
  const mcToken   = await getMinecraftToken(xstsToken, userHash);
  const profile   = await getMinecraftProfile(mcToken);

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
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
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
