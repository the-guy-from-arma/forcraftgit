const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("faircroftDesktop", Object.freeze({
  getInfo: () => ipcRenderer.invoke("desktop:get-info"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-updates"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  retry: () => ipcRenderer.invoke("desktop:retry"),
  onUpdateState: (listener) => {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on("desktop:update-state", wrapped);
    return () => ipcRenderer.removeListener("desktop:update-state", wrapped);
  }
}));
