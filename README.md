# 🐈‍⬛ 黑貓啟動器 — 建置說明

## 環境需求

- **Node.js** 18 以上：https://nodejs.org/
- **Windows 10/11**（打包 .exe 用）

---

## 步驟一：安裝依賴

把整個資料夾放好之後，在資料夾內開啟終端機（PowerShell / cmd）：

```bash
npm install
```

等待安裝完成（約 1～2 分鐘）。

---

## 步驟二：放入 icon

把你的 `icon.ico` 放進 `public/` 資料夾，命名為 `icon.ico`。

---

## 步驟三：開發預覽（可選）

```bash
npm run dev
```

這會同時啟動 Vite 開發伺服器和 Electron 視窗，可以即時預覽。

---

## 步驟四：打包成 .exe

```bash
npm run pack
```

打包完成後，安裝檔會在 `release/` 資料夾內：

```
release/
  黑貓啟動器 Setup 2.0.3.exe   ← 安裝程式（有安裝精靈）
```

執行這個 .exe 就能安裝「黑貓啟動器」到電腦，並自動在桌面建立捷徑。

---

## 資料夾結構

```
黑貓啟動器/
├── electron/
│   ├── main.js        ← Electron 主程序（視窗、IPC、檔案存取）
│   └── preload.js     ← 安全橋接（renderer ↔ main）
├── src/
│   ├── main.jsx       ← React 入口
│   └── App.jsx        ← 啟動器 UI（所有畫面都在這裡）
├── public/
│   └── icon.ico       ← ← 放你的 icon 在這裡
├── index.html
├── vite.config.js
└── package.json
```

---

## 功能說明

| 功能 | 說明 |
|------|------|
| 微軟帳號登入 | OAuth 流程，未登入時所有操作都會跳出登入視窗 |
| 安裝檔管理 | 新增、編輯、刪除；右鍵選單 |
| 記憶體設定 | 每個安裝檔可獨立設定最低/最高 RAM |
| 載入器支援 | Vanilla / Fabric / Forge / Quilt / NeoForge |
| Modrinth | 搜尋並安裝模組、光影、材質包、資料包 |
| 崩潰報告 | 跳出視窗，支援複製報告和開啟資料夾 |
| 自動更新 | 啟動時檢查，跳出視窗詢問是否更新 |
| 桌面捷徑 | 點擊左下角 🔗 自動建立 .lnk 捷徑 |
| 設定持久化 | 安裝檔存在 `~/.blackcat-launcher/profiles.json` |

---

## 如果打包時遇到問題

```bash
# 清除 cache 再試
npm cache clean --force
rm -rf node_modules
npm install
npm run pack
```
