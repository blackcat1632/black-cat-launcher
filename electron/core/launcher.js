/**
 * launcher.js — 組合啟動參數並執行 Minecraft
 */

const path   = require('path');
const fs     = require('fs');
const { spawn } = require('child_process');
const { fetchVersionInfo } = require('./versions');

// ── 讀取版本 JSON（支援 inheritsFrom）────────────────────────────────────────
async function resolveVersionJson(versionId, baseDir) {
  const jsonPath = path.join(baseDir, 'versions', versionId, `${versionId}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`找不到版本 JSON: ${versionId}`);
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  if (json.inheritsFrom) {
    const parent = await resolveVersionJson(json.inheritsFrom, baseDir);
    return mergeVersionJson(parent, json);
  }
  return json;
}

function mergeVersionJson(parent, child) {
  const merged = { ...parent, ...child };
  merged.libraries = [...(child.libraries || []), ...(parent.libraries || [])];
  if (parent.arguments && child.arguments) {
    merged.arguments = {
      game: [...(parent.arguments.game || []), ...(child.arguments.game || [])],
      jvm:  [...(parent.arguments.jvm  || []), ...(child.arguments.jvm  || [])],
    };
  }
  if (child.mainClass) merged.mainClass = child.mainClass;
  return merged;
}

// ── Classpath ─────────────────────────────────────────────────────────────────
function buildClasspath(versionJson, baseDir) {
  const libs = [];
  for (const lib of (versionJson.libraries || [])) {
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
    } else if (lib.name) {
      const p = path.join(baseDir, 'libraries', mavenToPath(lib.name));
      if (fs.existsSync(p)) libs.push(p);
    }
  }
  const jarId   = versionJson.jar || versionJson.id;
  const jarPath = path.join(baseDir, 'versions', jarId, `${jarId}.jar`);
  if (fs.existsSync(jarPath)) libs.push(jarPath);
  return [...new Set(libs)].join(path.delimiter);
}

function mavenToPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const groupPath = group.replace(/\./g, '/');
  const jar = classifier ? `${artifact}-${version}-${classifier}.jar` : `${artifact}-${version}.jar`;
  return `${groupPath}/${artifact}/${version}/${jar}`;
}

// ── 解壓 natives ──────────────────────────────────────────────────────────────
async function extractNatives(versionJson, baseDir, nativesDir) {
  const { exec } = require('child_process');
  fs.mkdirSync(nativesDir, { recursive: true });
  for (const lib of (versionJson.libraries || [])) {
    if (!lib.downloads?.classifiers) continue;
    const key = process.platform === 'win32' ? 'natives-windows' :
                process.platform === 'darwin' ? 'natives-macos' : 'natives-linux';
    const native = lib.downloads.classifiers[key] || lib.downloads.classifiers[key.replace('-','_')];
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

// ── 參數解析 ──────────────────────────────────────────────────────────────────
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
  return str.replace(/\$\{([^}]+)\}/g, (_, key) => vars[key] !== undefined ? vars[key] : '');
}

// ── 主啟動函式 ────────────────────────────────────────────────────────────────
async function launchGame({ profile, baseDir, javaExe, accessToken, uuid, username, onLog, onExit }) {
  const { ver, loader, loaderVer, minRam, maxRam, name, installedVersionId } = profile;

  onLog && onLog(`📋 載入版本資訊...`);

  let launchVersionId = ver;
  if (loader === 'Fabric' && loaderVer && loaderVer !== '—') {
    const fabricId = `fabric-loader-${loaderVer}-${ver}`;
    if (fs.existsSync(path.join(baseDir, 'versions', fabricId, `${fabricId}.json`)))
      launchVersionId = fabricId;
  } else if ((loader === 'Forge' || loader === 'NeoForge') && installedVersionId) {
    launchVersionId = installedVersionId;
  }

  onLog && onLog(`📦 版本 ID: ${launchVersionId}`);

  const versionJson = await resolveVersionJson(launchVersionId, baseDir);
  const safeName    = name.replace(/[^\w\-]/g, '_');
  const gameDir     = path.join(baseDir, 'instances', safeName);
  const assetsDir   = path.join(baseDir, 'assets');
  const nativesDir  = path.join(baseDir, 'versions', ver, 'natives');

  fs.mkdirSync(gameDir,    { recursive: true });
  fs.mkdirSync(nativesDir, { recursive: true });

  onLog && onLog(`🔧 解壓 natives...`);
  const vanillaJson = await resolveVersionJson(ver, baseDir);
  await extractNatives(vanillaJson, baseDir, nativesDir);

  const classpath    = buildClasspath(versionJson, baseDir);
  const assetIndexId = versionJson.assetIndex?.id || ver;
  const mainClass    = versionJson.mainClass;

  if (!mainClass) throw new Error('找不到 mainClass，版本 JSON 可能損壞');
  if (!classpath)  throw new Error('Classpath 為空，請重新安裝');

  // ── 確保登入資訊正確 ──────────────────────────────────────────────────────
  const isOnline    = !!(accessToken && accessToken !== 'null' && accessToken !== '0');
  const playerName  = username || 'Player';
  const playerUUID  = uuid || '00000000-0000-0000-0000-000000000000';
  const playerToken = isOnline ? accessToken : '0';

  onLog && onLog(`👤 玩家: ${playerName} (${isOnline ? '正版' : '離線'})`);

  const vars = {
    auth_player_name:      playerName,
    version_name:          launchVersionId,
    game_directory:        gameDir,
    assets_root:           assetsDir,
    assets_index_name:     assetIndexId,
    auth_uuid:             playerUUID,
    auth_access_token:     playerToken,
    auth_session:          isOnline ? `token:${playerToken}:${playerUUID}` : 'null',
    user_type:             isOnline ? 'msa' : 'offline',
    version_type:          versionJson.type || 'release',
    classpath,
    natives_directory:     nativesDir,
    launcher_name:         'BlackCatLauncher',  // 必須純英文
    launcher_version:      '1.0.0',
    user_properties:       '{}',
    game_assets:           assetsDir,
    resolution_width:      '854',
    resolution_height:     '480',
  };

  // ── JVM 參數 ──────────────────────────────────────────────────────────────
  const jvmBase = [
    `-Xms${minRam || 512}m`,
    `-Xmx${maxRam || 2048}m`,
    `-Djava.library.path=${nativesDir}`,
    `-Dminecraft.launcher.brand=BlackCatLauncher`,
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

  const jvmFromJson = resolveArgs(versionJson.arguments?.jvm, vars);
  const hasCP = jvmFromJson.includes('-cp') || jvmFromJson.includes('--class-path');
  const jvmArgs = [
    ...jvmBase,
    ...(jvmFromJson.length > 0 ? jvmFromJson : []),
    ...(!hasCP && jvmFromJson.length === 0 ? ['-cp', classpath] : []),
  ];

  // ── Game 參數 ─────────────────────────────────────────────────────────────
  let gameArgs = [];
  if (versionJson.arguments?.game) {
    // 新格式 1.13+
    gameArgs = resolveArgs(versionJson.arguments.game, vars);
  } else if (versionJson.minecraftArguments) {
    // 舊格式 1.12 以下
    gameArgs = versionJson.minecraftArguments.split(' ').map(a => substituteVars(a, vars));
  }

  // ── 過濾 quickPlay 衝突參數 ───────────────────────────────────────────────
  const filteredGameArgs = [];
  for (let i = 0; i < gameArgs.length; i++) {
    if (gameArgs[i].startsWith('--quickPlay')) {
      i++; // 跳過下一個值
      continue;
    }
    filteredGameArgs.push(gameArgs[i]);
  }

  // ── 舊版本補丁（1.12以下確保有必要參數）─────────────────────────────────
  const isLegacy = !!versionJson.minecraftArguments;
  if (isLegacy) {
    if (!filteredGameArgs.includes('--username'))
      filteredGameArgs.push('--username', playerName);
    if (!filteredGameArgs.includes('--session'))
      filteredGameArgs.push('--session', isOnline ? `token:${playerToken}:${playerUUID}` : '-');
    if (!filteredGameArgs.includes('--version'))
      filteredGameArgs.push('--version', launchVersionId);
    if (!filteredGameArgs.includes('--gameDir'))
      filteredGameArgs.push('--gameDir', gameDir);
    if (!filteredGameArgs.includes('--assetsDir'))
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