/**
 * installer.js — 下載遊戲本體、libraries、assets
 * 修復版：正確處理 maven path、並行下載、重試機制
 */

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { fetchVersionInfo } = require('./versions');

// ── 下載單一檔案 ──────────────────────────────────────────────────────────────
function downloadFile(url, dest, expectedSha1, retries = 3) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    // 已存在且 hash 正確則跳過
    if (expectedSha1 && fs.existsSync(dest)) {
      try {
        const hash = crypto.createHash('sha1').update(fs.readFileSync(dest)).digest('hex');
        if (hash === expectedSha1) { resolve(); return; }
      } catch(e) {}
    }

    const proto = url.startsWith('https') ? https : http;
    const attempt = (n) => {
      const file = fs.createWriteStream(dest + '.tmp');
      const handleRes = (res) => {
        if ([301,302,307,308].includes(res.statusCode)) {
          file.close(() => fs.unlink(dest + '.tmp', () => {}));
          downloadFile(res.headers.location, dest, expectedSha1, n).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close(() => fs.unlink(dest + '.tmp', () => {}));
          if (n > 1) { setTimeout(() => attempt(n-1), 1000); }
          else reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            // Verify hash
            if (expectedSha1) {
              try {
                const hash = crypto.createHash('sha1').update(fs.readFileSync(dest + '.tmp')).digest('hex');
                if (hash !== expectedSha1 && n > 1) {
                  fs.unlink(dest + '.tmp', () => {});
                  setTimeout(() => attempt(n-1), 500);
                  return;
                }
              } catch(e) {}
            }
            fs.rename(dest + '.tmp', dest, (err) => { if (err) reject(err); else resolve(); });
          });
        });
        file.on('error', (err) => {
          fs.unlink(dest + '.tmp', () => {});
          if (n > 1) setTimeout(() => attempt(n-1), 1000);
          else reject(err);
        });
      };
      proto.get(url, { timeout: 30000 }, handleRes).on('error', (err) => {
        file.close(() => fs.unlink(dest + '.tmp', () => {}));
        if (n > 1) setTimeout(() => attempt(n-1), 1000);
        else reject(err);
      });
    };
    attempt(retries);
  });
}

// ── 並行下載（限制同時連線數）────────────────────────────────────────────────
async function downloadQueue(tasks, concurrency = 10, onProgress) {
  const total = tasks.length;
  let done = 0;
  const queue = [...tasks];

  async function worker() {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      try { await downloadFile(task.url, task.dest, task.sha1); }
      catch(e) { console.error(`[DL FAIL] ${task.url}:`, e.message); }
      done++;
      onProgress && onProgress(done, total);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length || 1) }, worker));
}

// ── Maven name → 相對路徑 ─────────────────────────────────────────────────────
function mavenToRelPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const groupPath = group.replace(/\./g, '/');
  const jar = classifier
    ? `${artifact}-${version}-${classifier}.jar`
    : `${artifact}-${version}.jar`;
  return `${groupPath}/${artifact}/${version}/${jar}`;
}

// ── 下載主 jar ────────────────────────────────────────────────────────────────
async function downloadClientJar(versionInfo, baseDir, onProgress) {
  const { id, downloads } = versionInfo;
  const dest = path.join(baseDir, 'versions', id, `${id}.jar`);
  if (fs.existsSync(dest)) {
    try {
      const hash = crypto.createHash('sha1').update(fs.readFileSync(dest)).digest('hex');
      if (hash === downloads.client.sha1) { onProgress && onProgress(100, 100, `${id}.jar 已是最新`); return; }
    } catch(e) {}
  }
  onProgress && onProgress(0, 100, `下載 ${id}.jar...`);
  await downloadFile(downloads.client.url, dest, downloads.client.sha1);
  onProgress && onProgress(100, 100, `${id}.jar 下載完成`);
}

// ── 下載 Libraries ────────────────────────────────────────────────────────────
async function downloadLibraries(versionInfo, baseDir, onProgress) {
  const tasks = [];

  for (const lib of (versionInfo.libraries || [])) {
    // OS rules
    if (lib.rules) {
      const allowed = lib.rules.some(r => {
        if (r.action !== 'allow') return false;
        if (!r.os) return true;
        return (r.os.name === 'windows' && process.platform === 'win32') ||
               (r.os.name === 'osx'     && process.platform === 'darwin') ||
               (r.os.name === 'linux'   && process.platform === 'linux');
      });
      if (!allowed) continue;
    }

    // Artifact
    if (lib.downloads?.artifact) {
      const a = lib.downloads.artifact;
      tasks.push({ url: a.url, dest: path.join(baseDir, 'libraries', a.path), sha1: a.sha1 });
    }

    // Natives
    if (lib.downloads?.classifiers) {
      const keys = [
        process.platform === 'win32' ? 'natives-windows' : null,
        process.platform === 'darwin' ? 'natives-macos' : null,
        process.platform === 'darwin' ? 'natives-osx' : null,
        process.platform === 'linux'  ? 'natives-linux' : null,
      ].filter(Boolean);
      for (const k of keys) {
        const n = lib.downloads.classifiers[k];
        if (n) tasks.push({ url: n.url, dest: path.join(baseDir, 'libraries', n.path), sha1: n.sha1 });
      }
    }
  }

  onProgress && onProgress(0, tasks.length, `下載 ${tasks.length} 個 libraries...`);
  await downloadQueue(tasks, 10, (d, t) => onProgress && onProgress(d, t, `Libraries ${d}/${t}`));
}

// ── 下載 Assets ───────────────────────────────────────────────────────────────
async function downloadAssets(versionInfo, baseDir, onProgress) {
  const { assetIndex } = versionInfo;
  const indexDir  = path.join(baseDir, 'assets', 'indexes');
  const indexFile = path.join(indexDir, `${assetIndex.id}.json`);

  fs.mkdirSync(indexDir, { recursive: true });
  if (!fs.existsSync(indexFile)) {
    await downloadFile(assetIndex.url, indexFile, assetIndex.sha1);
  }

  const index   = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
  const objects = index.objects || {};
  const tasks   = [];

  for (const obj of Object.values(objects)) {
    const { hash } = obj;
    const prefix = hash.substring(0, 2);
    tasks.push({
      url:  `https://resources.download.minecraft.net/${prefix}/${hash}`,
      dest: path.join(baseDir, 'assets', 'objects', prefix, hash),
      sha1: hash,
    });
  }

  onProgress && onProgress(0, tasks.length, `下載 ${tasks.length} 個 assets...`);
  await downloadQueue(tasks, 20, (d, t) => {
    if (d % 50 === 0 || d === t) onProgress && onProgress(d, t, `Assets ${d}/${t}`);
  });
}

// ── 完整安裝流程 ──────────────────────────────────────────────────────────────
async function installVersion(versionId, baseDir, onProgress) {
  onProgress && onProgress({ stage: 'version', pct: 5, msg: `取得 ${versionId} 版本資訊...` });
  const versionInfo = await fetchVersionInfo(versionId, baseDir);

  // 確保版本目錄存在
  fs.mkdirSync(path.join(baseDir, 'versions', versionId), { recursive: true });

  onProgress && onProgress({ stage: 'jar', pct: 10, msg: '下載遊戲本體...' });
  await downloadClientJar(versionInfo, baseDir, (d, t, msg) => {
    onProgress && onProgress({ stage: 'jar', pct: 10 + Math.floor(d/t*20), msg });
  });

  onProgress && onProgress({ stage: 'libraries', pct: 30, msg: '下載 Libraries...' });
  await downloadLibraries(versionInfo, baseDir, (d, t, msg) => {
    onProgress && onProgress({ stage: 'libraries', pct: 30 + Math.floor(d/(t||1)*30), msg });
  });

  onProgress && onProgress({ stage: 'assets', pct: 60, msg: '下載遊戲資源...' });
  await downloadAssets(versionInfo, baseDir, (d, t, msg) => {
    onProgress && onProgress({ stage: 'assets', pct: 60 + Math.floor(d/(t||1)*35), msg });
  });

  onProgress && onProgress({ stage: 'done', pct: 100, msg: `${versionId} 安裝完成！` });
  return versionInfo;
}

module.exports = { installVersion, downloadFile, downloadLibraries, downloadAssets };
