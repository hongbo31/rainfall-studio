module.exports = {
  packagerConfig: {
    asar: { unpack: "**/*.dll" },
    afterPrune: [async ({ buildPath }) => {
      // Rebuilding native modules can recreate local paths and compiler logs.
      // Keep the runtime binary; remove intermediates only from this staging copy.
      const fs = require("node:fs/promises");
      const path = require("node:path");
      const base = await fs.realpath(buildPath);
      const dir = path.join(base, "node_modules", "better-sqlite3", "build");
      async function remove(target) {
        const resolved = await fs.realpath(target);
        if (!resolved.startsWith(base + path.sep)) throw Error("UNSAFE_STAGING_PATH");
        await fs.rm(target, { recursive: true, force: true });
      }
      for (const entry of await fs.readdir(dir)) {
        if (entry !== "Release") await remove(path.join(dir, entry));
      }
      const release = path.join(dir, "Release");
      for (const entry of await fs.readdir(release)) {
        if (entry !== "better_sqlite3.node") await remove(path.join(release, entry));
      }
    }],
    download: { cacheRoot: require("node:path").resolve(".cache/electron") },
    name: "RainfallStudio",
    executableName: "RainfallStudio",
    icon: "assets/rainfall.ico",
    appBundleId: "com.rainfall.studio",
    appCopyright: "Rainfall Studio",
    ignore: [
      /^\/(?:\.git|\.cache|\.superpowers|output|out|web|desktop|dist|tests|scripts|src|docs)(?:\/|$)/,
      /^\/verify-/,
      /\.sqlite(?:-|$)/,
      /\.env/,
      /\.map$/,
      /\.(?:pdb|obj|ilk|exp|lib|tlog|sln|vcxproj(?:\.filters)?)$/i,
      /\/node_modules\/better-sqlite3\/build\/(?!Release(?:\/|$))/,
      /\/node_modules\/better-sqlite3\/build\/Release\/(?!better_sqlite3\.node$)/,
    ],
  },
  rebuildConfig: { onlyModules: ["better-sqlite3"] },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "RainfallStudio",
        authors: "Rainfall Studio",
        description: "本地音乐创作与发布准备工作台",
        noMsi: true,
        additionalFiles: [{ src: "LICENSES.chromium.html", target: "lib\\net45" }],
        setupIcon: "assets/rainfall.ico",
      },
    },
  ],
  plugins: [{ name: "@electron-forge/plugin-auto-unpack-natives", config: {} }],
};
