/**
 * auth.js — 微軟 OAuth 2.0 + Xbox + Minecraft 正版驗證
 * 使用 PKCE 公用用戶端流程
 */

const { BrowserWindow } = require('electron');
const https  = require('https');
const http   = require('http');
const crypto = require('crypto');

const CLIENT_ID    = '99781bcc-9baf-4b21-b2dc-fb726ac1cd5c';
const REDIRECT_URI = 'http://localhost:4892/callback';
const SCOPE = 'XboxLive.signin offline_access';

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function httpPost(url, data, extraHeaders = {}) {
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
        ...extraHeaders,
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

function httpPostJson(url, data, extraHeaders = {}) {
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
        ...extraHeaders,
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

function startCallbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith('/callback')) return;
      const url   = new URL(req.url, 'http://localhost:4892');
      const code  = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#1a1d2e;color:#f0f0f0">
        <h2 style="color:${error ? '#ef4444' : '#4ade80'}">${error ? '❌ 登入失敗' : '✅ 登入成功！'}</h2>
        <p>${error || '請回到黑貓啟動器繼續。'}</p>
        <script>setTimeout(()=>window.close(),2000);</script>
      </body></html>`);

      server.close();
      if (error) reject(new Error(error));
      else if (code) resolve(code);
      else reject(new Error('未取得授權碼'));
    });

    server.listen(4892, '127.0.0.1', () => {
      console.log('[Auth] callback server 啟動於 port 4892');
    });
    server.on('error', e => reject(new Error('無法啟動 callback server: ' + e.message)));
    setTimeout(() => { server.close(); reject(new Error('登入逾時，請重試')); }, 30000);
  });
}

function openMicrosoftLogin(codeChallenge) {
  return new Promise((resolve, reject) => {
    const authUrl = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
    authUrl.searchParams.set('client_id',             CLIENT_ID);
    authUrl.searchParams.set('response_type',         'code');
    authUrl.searchParams.set('redirect_uri',          REDIRECT_URI);
    authUrl.searchParams.set('scope',                 SCOPE);
    authUrl.searchParams.set('code_challenge',        codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('prompt',                'select_account');

    const win = new BrowserWindow({
      width: 500, height: 660,
      title: '使用 Microsoft 帳號登入',
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    win.loadURL(authUrl.toString());

    const handleUrl = (url) => {
      if (!url || !url.startsWith('http://localhost:4892/callback')) return false;
      console.log('[Auth] 攔截到 callback URL');
      // 轉發給本地 server
      http.get(url, res => res.resume()).on('error', () => {});
      setTimeout(() => { try { win.close(); } catch(e) {} }, 500);
      return true;
    };

    win.webContents.on('will-redirect',           (e, url) => { if (handleUrl(url)) e.preventDefault(); });
    win.webContents.on('will-navigate',           (e, url) => { if (handleUrl(url)) e.preventDefault(); });
    win.webContents.on('did-redirect-navigation', (e, url) => { handleUrl(url); });

    win.on('closed', () => resolve(undefined));
  });
}

async function getMicrosoftToken(authCode, codeVerifier) {
  const res = await httpPost(
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
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

async function getXboxLiveToken(msAccessToken) {
  const res = await httpPostJson(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      Properties: {
        AuthMethod: 'RPS',
        SiteName:   'user.auth.xboxlive.com',
        RpsTicket:  `d=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType:    'JWT',
    }
  );
  if (!res.Token) throw new Error('無法取得 Xbox Live Token: ' + JSON.stringify(res));
  return { token: res.Token, userHash: res.DisplayClaims.xui[0].uhs };
}

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

async function getMinecraftToken(xstsToken, userHash) {
  const res = await httpPostJson(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    { identityToken: `XBL3.0 x=${userHash};${xstsToken}` }
  );
  if (!res.access_token) throw new Error('無法取得 Minecraft Token: ' + JSON.stringify(res));
  return res.access_token;
}

async function getMinecraftProfile(mcToken) {
  const res = await httpGet(
    'https://api.minecraftservices.com/minecraft/profile',
    { Authorization: `Bearer ${mcToken}` }
  );
  if (res.error || !res.id) throw new Error('此帳號未購買 Minecraft Java Edition');
  return { uuid: res.id, username: res.name };
}

async function microsoftLogin() {
  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  console.log('[Auth] 啟動登入...');
  const serverPromise = startCallbackServer();
  await openMicrosoftLogin(codeChallenge);

  console.log('[Auth] 等待 callback...');
  const authCode = await serverPromise;
  console.log('[Auth] 取得 authCode，換 token...');

  const msTokens                      = await getMicrosoftToken(authCode, codeVerifier);
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

async function refreshAuth(savedAuth) {
  if (!savedAuth?.refreshToken) throw new Error('無 refresh token，請重新登入');
  const msTokens = await httpPost(
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
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
