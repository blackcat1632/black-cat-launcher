/**
 * updater.js — GitHub Releases 自動更新
 *
 * 設定方式：
 * 把 GITHUB_REPO 改成你的 GitHub 帳號/倉庫名稱
 * 例如：'yourname/black-cat-launcher'
 *
 * Release 格式：
 * - Tag: v1.0.1
 * - Asset: 黑貓啟動器-Setup-1.0.1.exe
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { app, shell } = require('electron');

const GITHUB_REPO    = 'biggestlily1632-afk/black-cat-launcher';
const CURRENT_VERSION = app.getVersion(); // 從 package.json 讀取

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': '黑貓啟動器',
        'Accept': 'application/vnd.github.v3+json',
      },
    };
    const handleRes = (res) => {
      if ([301,302,307].includes(res.statusCode)) {
        https.get(res.headers.location, options, handleRes).on('error', reject);
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    };
    https.get(url, options, handleRes).on('error', reject);
  });
}

// 版本比較（semver 簡易版）
function isNewerVersion(current, latest) {
  const parse = v => v.replace(/^v/, '').split('.').map(Number);
  const [ca, cb, cc] = parse(current);
  const [la, lb, lc] = parse(latest);
  if (la > ca) return true;
  if (la === ca && lb > cb) return true;
  if (la === ca && lb === cb && lc > cc) return true;
  return false;
}

// 檢查是否有新版本
async function checkForUpdate() {
  try {
    const releases = await httpsGetJson(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
    );

    if (!releases.tag_name) return { hasUpdate: false };

    const latestVersion = releases.tag_name.replace(/^v/, '');
    const hasUpdate = isNewerVersion(CURRENT_VERSION, latestVersion);

    if (!hasUpdate) return { hasUpdate: false, version: CURRENT_VERSION };

    // 找 Windows exe asset
    const asset = releases.assets?.find(a =>
      a.name.endsWith('.exe') || a.name.includes('Setup')
    );

    return {
      hasUpdate: true,
      version: `v${latestVersion}`,
      currentVersion: `v${CURRENT_VERSION}`,
      notes: releases.body || '',
      downloadUrl: asset?.browser_download_url || releases.html_url,
      htmlUrl: releases.html_url,
    };
  } catch(e) {
    console.error('更新檢查失敗:', e.message);
    return { hasUpdate: false };
  }
}

// 下載並安裝更新
function downloadAndInstall(downloadUrl, onProgress) {
  return new Promise((resolve, reject) => {
    const tmpPath = path.join(app.getPath('temp'), 'blackcat-update.exe');

    const handleRes = (res) => {
      if ([301,302,307,308].includes(res.statusCode)) {
        https.get(res.headers.location, { headers: { 'User-Agent': '黑貓啟動器' } }, handleRes)
          .on('error', reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`下載失敗: HTTP ${res.statusCode}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const file = fs.createWriteStream(tmpPath);
      res.on('data', chunk => {
        downloaded += chunk.length;
        file.write(chunk);
        if (total > 0 && onProgress) {
          onProgress(Math.floor(downloaded / total * 100), `正在下載更新... ${Math.floor(downloaded/1024/1024)}MB / ${Math.floor(total/1024/1024)}MB`);
        }
      });
      res.on('end', () => {
        file.end();
        resolve(tmpPath);
      });
      res.on('error', reject);
    };

    https.get(downloadUrl, { headers: { 'User-Agent': '黑貓啟動器' } }, handleRes)
      .on('error', reject);
  });
}

async function performUpdate(downloadUrl, onProgress) {
  const installerPath = await downloadAndInstall(downloadUrl, onProgress);
  // Launch installer then quit
  shell.openPath(installerPath);
  setTimeout(() => app.quit(), 1000);
}

module.exports = { checkForUpdate, performUpdate, CURRENT_VERSION };
