/**
 * forge.js — Forge / NeoForge 安裝
 * 使用官方 installer jar + headless 安裝
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { exec } = require('child_process');
const { downloadFile } = require('./installer');

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const handleRes = (res) => {
      if ([301,302,307,308].includes(res.statusCode)) {
        https.get(res.headers.location, handleRes).on('error', reject);
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    };
    https.get(url, handleRes).on('error', reject);
  });
}

// ── Forge ─────────────────────────────────────────────────────────────────────

const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const FORGE_PROMOTIONS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

async function getForgeVersions(mcVersion) {
  try {
    const data = await httpsGetJson(FORGE_PROMOTIONS_URL);
    const versions = [];
    // recommended first, then latest
    const rec = data.promos[`${mcVersion}-recommended`];
    const lat = data.promos[`${mcVersion}-latest`];
    if (rec) versions.push({ label: `${mcVersion}-${rec} (推薦)`, value: `${mcVersion}-${rec}` });
    if (lat && lat !== rec) versions.push({ label: `${mcVersion}-${lat} (最新)`, value: `${mcVersion}-${lat}` });
    return versions;
  } catch(e) {
    return [];
  }
}

async function installForge(mcVersion, forgeVersion, baseDir, javaExe, onProgress) {
  const fullVersion = forgeVersion.includes(mcVersion) ? forgeVersion : `${mcVersion}-${forgeVersion}`;
  const installerJar = `forge-${fullVersion}-installer.jar`;
  const installerUrl = `${FORGE_MAVEN}/${fullVersion}/${installerJar}`;
  const installerPath = path.join(baseDir, 'tmp', installerJar);

  fs.mkdirSync(path.join(baseDir, 'tmp'), { recursive: true });

  onProgress && onProgress({ pct: 10, msg: `下載 Forge ${fullVersion} 安裝程式...` });
  await downloadFile(installerUrl, installerPath);

  onProgress && onProgress({ pct: 40, msg: '正在安裝 Forge（這可能需要幾分鐘）...' });

  return new Promise((resolve, reject) => {
    const cmd = `"${javaExe}" -jar "${installerPath}" --installClient "${baseDir}"`;
    exec(cmd, { cwd: baseDir, timeout: 300000 }, (err, stdout, stderr) => {
      fs.unlink(installerPath, () => {});
      if (err) {
        reject(new Error(`Forge 安裝失敗: ${stderr || err.message}`));
        return;
      }
      onProgress && onProgress({ pct: 100, msg: `Forge ${fullVersion} 安裝完成！` });
      resolve({ forgeVersion: fullVersion });
    });
  });
}

// ── NeoForge ──────────────────────────────────────────────────────────────────

const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
const NEOFORGE_META  = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';

async function getNeoForgeVersions(mcVersion) {
  try {
    // NeoForge version starts with MC minor version, e.g. 1.21.x -> 21.x.xx
    const mcParts = mcVersion.split('.');
    const prefix = mcParts.length >= 2 ? mcParts.slice(1).join('.') : mcParts[1];

    // Fetch version list via API
    const data = await httpsGetJson(`https://api.github.com/repos/neoforged/neoforge/releases?per_page=20`);
    const versions = data
      .filter(r => r.tag_name.startsWith(prefix))
      .map(r => r.tag_name)
      .slice(0, 5);
    return versions;
  } catch(e) {
    return [];
  }
}

async function installNeoForge(mcVersion, neoVersion, baseDir, javaExe, onProgress) {
  const installerJar = `neoforge-${neoVersion}-installer.jar`;
  const installerUrl = `${NEOFORGE_MAVEN}/${neoVersion}/${installerJar}`;
  const installerPath = path.join(baseDir, 'tmp', installerJar);

  fs.mkdirSync(path.join(baseDir, 'tmp'), { recursive: true });

  onProgress && onProgress({ pct: 10, msg: `下載 NeoForge ${neoVersion} 安裝程式...` });
  await downloadFile(installerUrl, installerPath);

  onProgress && onProgress({ pct: 40, msg: '正在安裝 NeoForge...' });

  return new Promise((resolve, reject) => {
    const cmd = `"${javaExe}" -jar "${installerPath}" --installClient "${baseDir}"`;
    exec(cmd, { cwd: baseDir, timeout: 300000 }, (err, stdout, stderr) => {
      fs.unlink(installerPath, () => {});
      if (err) {
        reject(new Error(`NeoForge 安裝失敗: ${stderr || err.message}`));
        return;
      }
      onProgress && onProgress({ pct: 100, msg: `NeoForge ${neoVersion} 安裝完成！` });
      resolve({ neoVersion });
    });
  });
}

module.exports = {
  getForgeVersions, installForge,
  getNeoForgeVersions, installNeoForge,
};
