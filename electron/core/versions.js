/**
 * versions.js — 從 Mojang API 取得版本清單與版本資訊
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const handleRes = (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        https.get(res.headers.location, handleRes).on('error', reject);
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    };
    https.get(url, handleRes).on('error', reject);
  });
}

// 取得所有版本清單
async function fetchVersionManifest() {
  return await httpsGet(MANIFEST_URL);
}

// 取得特定版本的詳細 JSON
async function fetchVersionInfo(versionId, baseDir) {
  const cacheDir = path.join(baseDir, 'versions', versionId);
  const cacheFile = path.join(cacheDir, `${versionId}.json`);

  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  }

  const manifest = await fetchVersionManifest();
  const entry = manifest.versions.find(v => v.id === versionId);
  if (!entry) throw new Error(`找不到版本 ${versionId}`);

  const info = await httpsGet(entry.url);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(info, null, 2));
  return info;
}

// 只回傳 release 版本列表（過濾掉 snapshot）
async function getReleaseVersions() {
  const manifest = await fetchVersionManifest();
  return manifest.versions
    .filter(v => v.type === 'release')
    .map(v => v.id);
}

module.exports = { fetchVersionManifest, fetchVersionInfo, getReleaseVersions, httpsGet };
