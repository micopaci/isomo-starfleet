"use strict";const e=require("electron");e.contextBridge.exposeInMainWorld("electronAPI",{getDarkMode:()=>e.ipcRenderer.invoke("dark-mode:get"),toggleDarkMode:()=>e.ipcRenderer.invoke("dark-mode:toggle"),onDarkModeChanged:r=>{e.ipcRenderer.on("dark-mode:changed",(d,o)=>r(o))}});
//# sourceMappingURL=preload.js.map
