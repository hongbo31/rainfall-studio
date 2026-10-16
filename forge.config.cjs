module.exports = {
  packagerConfig: {
    asar: { unpack: "**/*.dll" },
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
