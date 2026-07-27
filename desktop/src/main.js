const { app, BrowserWindow, Menu, shell, ipcMain, nativeTheme, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

const APP_ORIGIN = "https://faircroft.online";
const START_URL = `${APP_ORIGIN}/?desktop=1`;
let mainWindow = null;
let updateState = { status: "idle", message: "Updates are checked automatically." };

function isTrustedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.origin === APP_ORIGIN || url.protocol === "devtools:";
  } catch {
    return false;
  }
}

function sendUpdateState(status, message, extra = {}) {
  updateState = { status, message, ...extra };
  mainWindow?.webContents.send("desktop:update-state", updateState);
}

function createWindow() {
  nativeTheme.themeSource = "dark";
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    title: "Faircroft RP",
    backgroundColor: "#070b12",
    icon: path.join(__dirname, "..", "build", "faircroft.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    mainWindow.loadFile(path.join(__dirname, "offline.html"), {
      query: { reason: errorDescription, target: validatedUrl || START_URL }
    });
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(START_URL);
}

Menu.setApplicationMenu(null);
app.setAppUserModelId("online.faircroft.desktop");

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on("checking-for-update", () => sendUpdateState("checking", "Checking for a Faircroft update…"));
autoUpdater.on("update-available", (info) => sendUpdateState("downloading", `Downloading Faircroft ${info.version}…`, { version: info.version }));
autoUpdater.on("update-not-available", () => sendUpdateState("current", "Faircroft RP is up to date."));
autoUpdater.on("download-progress", (progress) => sendUpdateState("downloading", `Downloading update… ${Math.round(progress.percent)}%`, { percent: progress.percent }));
autoUpdater.on("update-downloaded", async (info) => {
  sendUpdateState("ready", `Faircroft ${info.version} is ready to install.`, { version: info.version });
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Faircroft update ready",
    message: `Faircroft RP ${info.version} has been downloaded.`,
    detail: "Restart now to install the update, or choose Later to install automatically when you close the app.",
    buttons: ["Restart and update", "Later"],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (result.response === 0) autoUpdater.quitAndInstall(false, true);
});
autoUpdater.on("error", () => sendUpdateState("error", "The update service is temporarily unavailable."));

ipcMain.handle("desktop:get-info", () => ({
  version: app.getVersion(),
  packaged: app.isPackaged,
  update: updateState
}));
ipcMain.handle("desktop:check-updates", async () => {
  if (!app.isPackaged) return { status: "development", message: "Update checks run in installed builds." };
  await autoUpdater.checkForUpdates();
  return updateState;
});
ipcMain.handle("desktop:install-update", () => {
  if (updateState.status === "ready") autoUpdater.quitAndInstall(false, true);
});
ipcMain.handle("desktop:retry", () => mainWindow?.loadURL(START_URL));
