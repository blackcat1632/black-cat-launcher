/**
 * fabric.js — Fabric 載入器安裝
 * 修復版：正確下載所有 Fabric libraries
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { downloadFile } = require('./installer');

const FABRIC_META    = 'https://meta.fabricmc.net/v2';
const FABRIC_MAVEN   = 'https://maven.fabricmc.net/';

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': '黑貓啟動器/1.0.0' } };
    const handleRes = (res) => {
      if ([301,302,307].includes(res.statusCode)) {
        https.get(res.headers.location, opts, handleRes).on('error', reject);
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    };
    https.get(url, opts, handleRes).on('error', reject);
  });
}

async function getFabricLoaderVersions() {
  const data = await httpsGetJson(`${FABRIC_META}/versions/loader`);
  return data.filter(v => v.stable).map(v => v.version);
}

async function getFabricMcVersions() {
  const data = await httpsGetJson(`${FABRIC_META}/versions/game`);
  return data.filter(v => v.stable).map(v => v.version);
}

function mavenToPath(name) {
  const parts = name.split(':');
  const [group, artifact, version, classifier] = parts;
  const groupPath = group.replace(/\./g, '/');
  const jar = classifier
    ? `${artifact}-${version}-${classifier}.jar`
    : `${artifact}-${version}.jar`;
  return `${groupPath}/${artifact}/${version}/${jar}`;
}

async function installFabric(mcVersion, loaderVersion, baseDir, onProgress) {
  onProgress && onProgress({ pct: 5, msg: `取得 Fabric ${loaderVersion} 資訊...` });

  // 取得 Fabric 版本 profile
  const profileUrl  = `${FABRIC_META}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
  const profileData = await httpsGetJson(profileUrl);

  const fabricId = profileData.id;
  const versionDir = path.join(baseDir, 'versions', fabricId);
  fs.mkdirSync(versionDir, { recursive: true });

  // 儲存 version JSON
  fs.writeFileSync(
    path.join(versionDir, `${fabricId}.json`),
    JSON.stringify(profileData, null, 2)
  );

  // 收集需要下載的 libraries
  const tasks = [];
  for (const lib of (profileData.libraries || [])) {
    const relPath = mavenToPath(lib.name);
    const dest    = path.join(baseDir, 'libraries', relPath);

    // 已存在就跳過
    if (fs.existsSync(dest)) continue;

    // 決定下載來源
    let url = lib.url ? `${lib.url.replace(/\/$/, '')}/${relPath}` : `${FABRIC_MAVEN}${relPath}`;

    tasks.push({ url, dest, sha1: lib.sha1 });
  }

  const total = tasks.length;
  let done = 0;

  onProgress && onProgress({ pct: 10, msg: `下載 Fabric libraries (${total} 個)...` });

  // 序列下載（避免同時太多連線到 fabric maven）
  for (const task of tasks) {
    try { await downloadFile(task.url, task.dest, task.sha1); }
    catch(e) { console.error(`Fabric lib 下載失敗: ${task.url}`, e.message); }
    done++;
    onProgress && onProgress({
      pct: 10 + Math.floor(done / total * 85),
      msg: `Fabric libraries ${done}/${total}`,
    });
  }

  onProgress && onProgress({ pct: 100, msg: `Fabric ${loaderVersion} 安裝完成！` });
  return { fabricId, profileData };
}

module.exports = { installFabric, getFabricLoaderVersions, getFabricMcVersions };
