// A sandboxed preload runs as a plain script: no ESM, and `require` knows only
// "electron". Hence a bare require, which compiles to no module wrapper at all.
const { contextBridge, ipcRenderer }: typeof import("electron") =
  require("electron");

contextBridge.exposeInMainWorld("stillDesktop", {
  status: (status: unknown) => ipcRenderer.send("still:status", status),
});
