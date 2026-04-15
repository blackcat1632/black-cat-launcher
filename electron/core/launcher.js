/**
 * launcher.js — 組合啟動參數並執行 Minecraft
 * 修復版：正確處理 Vanilla / Fabric / Forge / NeoForge 啟動
 */

const path   = require('path');
const fs     = require('fs');
const { spawn } = require('child_process');
const { fetchVersionInfo } = require('./versions');

// ── 讀取版本 JSON（支援繼承 inheritsFrom）────────────────────────────────────
async function resolveVersionJson(versionId, baseDir) {
  const jsonPath = path.join(baseDir, 'versions', versionId, `${versionId}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`找不到版本 JSON: ${versionId}`);
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  // 若有 inheritsFrom，合併父版本
  if (json.inheritsFrom) {
    const parent = await resolveVersionJson(json.inheritsFrom, baseDir);
    return mergeVersionJson(parent, json);
  }
  return json;
}

function mergeVersionJson(parent, child) {
  const merged = { ...parent, ...child };
  // 合併 libraries
  merged.libraries = [...(child.libraries || []), ...(parent.libraries || [])];
  // 合併 arguments
  if (parent.arguments && child.arguments) {
    merged.arguments = {
      game: [...(parent.arguments.game || []), ...(child.arguments.game || [])],
      jvm:  [...(parent.arguments.jvm  || []), ...(child.arguments.jvm  || [])],
    };
  }
  // 保留子版本的 mainClass
  if (child.mainClass) merged.mainClass = child.mainClass;
  return merged;
}

// ── 建立 classpath ────────────────────────────────────────────────────────────
function buildClasspath(versionJson, baseDir) {
  const libs = [];

  for (const lib of (versionJson.libraries || [])) {
    // 檢查 OS rules
    if (lib.rules) {
      const allowed = lib.rules.some(r => {
        if (r.action !== 'allow') return false;
        if (!r.os) return true;
        const os = r.os.name;
        return (os === 'windows' && process.platform === 'win32') ||
               (os === 'osx'     && process.platform === 'darwin') ||
               (os === 'linux'   && process.platform === 'linux');
      });
      if (!allowed) continue;
    }

    if (lib.downloads?.artifact) {
      const p = path.join(baseDir, 'libraries', lib.downloads.artifact.path);
      if (fs.existsSync(p)) libs.push(p);
    } else if (lib.name && lib.url !== undefined) {
      // Fabric / Forge style (maven name only)
      const mavenPath = mavenToPath(lib.name);
      const p = path.join(baseDir, 'libraries', mavenPath);
      if (fs.existsSync(p)) libs.push(p);
    }
  }

  // 加入主 jar（若有 jar 欄位或用 id）
  const jarId = versionJson.jar || versionJson.id;
  const jarPath = path.join(baseDir, 'versions', jarId, `${jarId}.jar`);
  if (fs.existsSync(jarPath)) libs.push(jarPath);

  return [...new Set(libs)].join(path.delimiter);
}

function mavenToPath(name) {
  const parts = name.split(':');
  const [group, artifact, version, classifier] = parts;
  const groupPath = group.replace(/\./g, '/');
  const jarName = classifier
    ? `${artifact}-${version}-${classifier}.jar`
    : `${artifact}-${version}.jar`;
  return `${groupPath}/${artifact}/${version}/${jarName}`;
}

// ── 解壓 natives ──────────────────────────────────────────────────────────────
async function extractNatives(versionJson, baseDir, nativesDir) {
  const { exec } = require('child_process');
  fs.mkdirSync(nativesDir, { recursive: true });

  for (const lib of (versionJson.libraries || [])) {
    if (!lib.downloads?.classifiers) continue;
    const key = process.platform === 'win32' ? 'natives-windows' :
                process.platform === 'darwin' ? 'natives-macos' : 'natives-linux';
    const native = lib.downloads.classifiers[key]
      || lib.downloads.classifiers[key.replace('-', '_')];
    if (!native) continue;

    const jar = path.join(baseDir, 'libraries', native.path);
    if (!fs.existsSync(jar)) continue;

    await new Promise(resolve => {
      if (process.platform === 'win32') {
        exec(`powershell -command "Add-Type -A System.IO.Compression.FileSystem; try { [IO.Compression.ZipFile]::ExtractToDirectory('${jar.replace(/'/g,"''")}','${nativesDir.replace(/'/g,"''")}') } catch {}"`, resolve);
      } else {
        exec(`unzip -o "${jar}" -d "${nativesDir}" -x 'META-INF/*' 2>/dev/null`, resolve);
      }
    });
  }
}

// ── 解析帶 rules 的參數 ───────────────────────────────────────────────────────
function resolveArgs(args, vars) {
  if (!args) return [];
  const result = [];
  for (const arg of args) {
    if (typeof arg === 'string') {
      result.push(substituteVars(arg, vars));
    } else if (arg.rules) {
      const allowed = arg.rules.every(r => {
        if (r.action === 'allow') {
          if (!r.os) return true;
          return (r.os.name === 'windows' && process.platform === 'win32') ||
                 (r.os.name === 'osx'     && process.platform === 'darwin') ||
                 (r.os.name === 'linux'   && process.platform === 'linux');
        }
        if (r.action === 'disallow') {
          if (!r.os) return false;
          return !((r.os.name === 'windows' && process.platform === 'win32') ||
                   (r.os.name === 'osx'     && process.platform === 'darwin') ||
                   (r.os.name === 'linux'   && process.platform === 'linux'));
        }
        return true;
      });
      if (allowed) {
        const values = Array.isArray(arg.value) ? arg.value : [arg.value];
        values.forEach(v => result.push(substituteVars(v, vars)));
      }
    }
  }
  return result;
}

function substituteVars(str, vars) {
  return str.replace(/\$\{([^}]+)\}/g, (_, key) => vars[key] !== undefined ? vars[key] : `\${${key}}`);
}

// ── 主啟動函式 ────────────────────────────────────────────────────────────────
async function launchGame({ profile, baseDir, javaExe, accessToken, uuid, username, onLog, onExit }) {
  const { ver, loader, loaderVer, minRam, maxRam, name, installedVersionId } = profile;

  onLog && onLog(`📋 載入版本資訊...`);

  // 決定要載入哪個版本 JSON
  let launchVersionId = ver;
  if (loader === 'Fabric' && loaderVer && loaderVer !== '—') {
    const fabricId = `fabric-loader-${loaderVer}-${ver}`;
    const fabricPath = path.join(baseDir, 'versions', fabricId, `${fabricId}.json`);
    if (fs.existsSync(fabricPath)) launchVersionId = fabricId;
  } else if ((loader === 'Forge' || loader === 'NeoForge') && installedVersionId) {
    launchVersionId = installedVersionId;
  }

  onLog && onLog(`📦 版本 ID: ${launchVersionId}`);

  // 載入並合併版本 JSON（處理 inheritsFrom）
  const versionJson = await resolveVersionJson(launchVersionId, baseDir);

  // 遊戲目錄（每個安裝檔獨立）
  const safeName  = name.replace(/[^\w\-]/g, '_');
  const gameDir   = path.join(baseDir, 'instances', safeName);
  const assetsDir = path.join(baseDir, 'assets');
  const nativesDir = path.join(baseDir, 'versions', ver, 'natives');

  fs.mkdirSync(gameDir,   { recursive: true });
  fs.mkdirSync(nativesDir, { recursive: true });

  onLog && onLog(`🔧 解壓 natives...`);
  // 用原版 JSON 解壓 natives（Fabric/Forge inheritsFrom 原版）
  const vanillaJson = await resolveVersionJson(ver, baseDir);
  await extractNatives(vanillaJson, baseDir, nativesDir);

  const classpath    = buildClasspath(versionJson, baseDir);
  const assetIndexId = versionJson.assetIndex?.id || ver;
  const mainClass    = versionJson.mainClass;

  if (!mainClass) throw new Error('找不到 mainClass，版本 JSON 可能損壞');
  if (!classpath)  throw new Error('Classpath 為空，請重新安裝');

const isOnline = !!accessToken;
const vars = {
  auth_player_name:   username || 'Player',
  version_name:       launchVersionId,
  game_directory:     gameDir,
  assets_root:        assetsDir,
  assets_index_name:  assetIndexId,
  auth_uuid:          uuid || '00000000-0000-0000-0000-000000000000',
  auth_access_token:  accessToken || 'null',
  auth_session:       accessToken ? `token:${accessToken}:${uuid}` : 'null',
  user_type:          isOnline ? 'msa' : 'legacy',
  version_type:       versionJson.type || 'release',
  classpath,
  natives_directory:  nativesDir,
  launcher_name:      '黑貓啟動器',
  launcher_version:   '1.0.0',
  user_properties:    '{}',
  game_assets:        assetsDir,
  auth_player_name_safe: (username || 'Player').replace(/[^a-zA-Z0-9_]/g, '_'),
  profile_name:       username || 'Player',
  version_type:       versionJson.type || 'release',
};

  // JVM 基本參數
  const jvmBase = [
    `-Xms${minRam || 512}m`,
    `-Xmx${maxRam || 2048}m`,
    `-Djava.library.path=${nativesDir}`,
    `-Dminecraft.launcher.brand=黑貓啟動器`,
    `-Dminecraft.launcher.version=1.0.0`,
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:G1NewSizePercent=20',
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapRegionSize=32M',
    '-Dfile.encoding=UTF-8',
  ];

  // 版本 JSON 內的 JVM 參數（新版格式）
  const jvmFromJson = resolveArgs(versionJson.arguments?.jvm, vars);

  // 若版本 JSON 有提供 -cp，就不再自己加
  const hasCP = jvmFromJson.includes('-cp') || jvmFromJson.includes('--class-path');

  const jvmArgs = [
    ...jvmBase,
    ...(jvmFromJson.length > 0 ? jvmFromJson : (!hasCP ? ['-cp', classpath] : [])),
  ];

  // Game 參數
  let gameArgs = [];
  if (versionJson.arguments?.game) {
    // 新格式（1.13+）
    gameArgs = resolveArgs(versionJson.arguments.game, vars);
  } else if (versionJson.minecraftArguments) {
    // 舊格式（1.12 以下）
    gameArgs = versionJson.minecraftArguments.split(' ').map(a => substituteVars(a, vars));
  }

 // 過濾掉 quickPlay 相關參數（會造成衝突）
const filteredGameArgs = gameArgs.filter((arg, i, arr) => {
  if (arg.startsWith('--quickPlay')) return false;
  if (i > 0 && arr[i-1].startsWith('--quickPlay')) return false;
  return true;
});

const isLegacy = !!versionJson.minecraftArguments;
if (isLegacy && !filteredGameArgs.includes('--username')) {
  filteredGameArgs.push('--username', username || 'Player');
  filteredGameArgs.push('--session', accessToken ? `token:${accessToken}:${uuid}` : 'null');
  filteredGameArgs.push('--version', launchVersionId);
  filteredGameArgs.push('--gameDir', gameDir);
  filteredGameArgs.push('--assetsDir', assetsDir);
}

const finalArgs = [...jvmArgs, mainClass, ...filteredGameArgs];

  onLog && onLog(`🚀 Java: ${javaExe}`);
  onLog && onLog(`📁 遊戲目錄: ${gameDir}`);
  onLog && onLog(`⚙️ 主類別: ${mainClass}`);
  onLog && onLog(`▶ 啟動中...`);

  const child = spawn(javaExe, finalArgs, {
    cwd: gameDir,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', d => onLog && onLog(d.toString().trimEnd()));
  child.stderr.on('data', d => onLog && onLog(d.toString().trimEnd()));
  child.on('error', err => { onLog && onLog(`❌ ${err.message}`); onExit && onExit(-1, err); });
  child.on('close', code => { onLog && onLog(`⏹ 遊戲結束 (code ${code})`); onExit && onExit(code); });

  return child;
}

module.exports = { launchGame };
