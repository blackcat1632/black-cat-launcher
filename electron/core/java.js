/**
 * java.js — 自動下載並管理 Java 執行環境
 * 使用 Adoptium (Eclipse Temurin) API
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync, exec } = require('child_process');

// Java 版本對應 Minecraft 版本
const JAVA_VERSION_MAP = {
  // MC 1.17+ 需要 Java 17+
  // MC 1.20.5+ 需要 Java 21+
  java21: ['1.20.5','1.20.6','1.21','1.21.1','1.21.2','1.21.3','1.21.4','1.21.11'],
  java17: ['1.17','1.17.1','1.18','1.18.1','1.18.2','1.19','1.19.1','1.19.2','1.19.3','1.19.4','1.20','1.20.1','1.20.2','1.20.3','1.20.4'],
  java8:  [] // 1.16 以下全用 Java 8
};

function getRequiredJavaVersion(mcVersion) {
  if (JAVA_VERSION_MAP.java21.includes(mcVersion)) return 21;
  if (JAVA_VERSION_MAP.java17.includes(mcVersion)) return 17;
  return 8;
}

function getJavaDir(baseDir) {
  return path.join(baseDir, 'runtime', 'java');
}

function getJavaExecutable(baseDir, javaVersion) {
  const javaDir = path.join(getJavaDir(baseDir), `java${javaVersion}`);
  if (process.platform === 'win32') {
    return path.join(javaDir, 'bin', 'java.exe');
  }
  return path.join(javaDir, 'bin', 'java');
}

function isJavaInstalled(baseDir, javaVersion) {
  const exe = getJavaExecutable(baseDir, javaVersion);
  return fs.existsSync(exe);
}

function getAdoptiumDownloadUrl(javaVersion) {
  const arch = process.arch === 'x64' ? 'x64' : 'x86';
  const os = process.platform === 'win32' ? 'windows' :
              process.platform === 'darwin' ? 'mac' : 'linux';
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';
  return `https://api.adoptium.net/v3/binary/latest/${javaVersion}/ga/${os}/${arch}/jdk/hotspot/normal/eclipse?project=jdk`;
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let downloaded = 0;
    let total = 0;

    const handleResponse = (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        https.get(res.headers.location, handleResponse).on('error', reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      total = parseInt(res.headers['content-length'] || '0', 10);
      res.on('data', chunk => {
        downloaded += chunk.length;
        file.write(chunk);
        if (total > 0 && onProgress) onProgress(downloaded, total);
      });
      res.on('end', () => { file.end(); resolve(); });
      res.on('error', reject);
    };

    https.get(url, handleResponse).on('error', reject);
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      const cmd = `powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
      exec(cmd, (err) => { if (err) reject(err); else resolve(); });
    } else {
      exec(`tar -xzf "${zipPath}" -C "${destDir}"`, (err) => { if (err) reject(err); else resolve(); });
    }
  });
}

async function downloadJava(baseDir, javaVersion, onProgress) {
  const javaDir = path.join(getJavaDir(baseDir), `java${javaVersion}`);
  const tmpDir  = path.join(getJavaDir(baseDir), 'tmp');
  const tmpFile = path.join(tmpDir, `java${javaVersion}.${process.platform==='win32'?'zip':'tar.gz'}`);

  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(javaDir, { recursive: true });

  const url = getAdoptiumDownloadUrl(javaVersion);
  onProgress && onProgress(0, 100, `正在下載 Java ${javaVersion}...`);

  await downloadFile(url, tmpFile, (dl, total) => {
    const pct = Math.floor(dl / total * 100);
    onProgress && onProgress(pct, 100, `正在下載 Java ${javaVersion}... ${pct}%`);
  });

  onProgress && onProgress(95, 100, `正在解壓縮 Java ${javaVersion}...`);
  const extractTmp = path.join(tmpDir, `java${javaVersion}_extract`);
  fs.mkdirSync(extractTmp, { recursive: true });
  await extractZip(tmpFile, extractTmp);

  // Move the extracted JDK folder contents to javaDir
  const extracted = fs.readdirSync(extractTmp);
  if (extracted.length > 0) {
    const jdkFolder = path.join(extractTmp, extracted[0]);
    fs.cpSync(jdkFolder, javaDir, { recursive: true });
  }

  // Cleanup tmp
  fs.rmSync(tmpDir, { recursive: true, force: true });
  onProgress && onProgress(100, 100, `Java ${javaVersion} 安裝完成！`);
}

async function ensureJava(baseDir, mcVersion, onProgress) {
  const ver = getRequiredJavaVersion(mcVersion);
  if (isJavaInstalled(baseDir, ver)) {
    return getJavaExecutable(baseDir, ver);
  }
  await downloadJava(baseDir, ver, onProgress);
  return getJavaExecutable(baseDir, ver);
}

module.exports = { ensureJava, getJavaExecutable, isJavaInstalled, getRequiredJavaVersion };
