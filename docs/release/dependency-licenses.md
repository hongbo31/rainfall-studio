# 依赖与许可证记录

从本机已安装package.json读取，精确版本以package-lock.json为准。

|直接运行依赖|版本|声明许可证|
|---|---|---|
|archiver|8.0.0|MIT|
|better-sqlite3|13.0.3|MIT|
|csv-parse|7.0.3|MIT|
|electron-squirrel-startup|1.0.1|Apache-2.0|
|luxon|3.7.2|MIT|
|sharp|0.35.5|Apache-2.0|
|yauzl|3.4.0|MIT|
|zod|4.6.7|MIT|

Electron 44.7.2、Chromium及Node第三方声明随运行目录LICENSE和LICENSES.chromium.html提供。Sharp包含libvips，实际声明见node_modules/@img/*/LICENSE*。本项目未添加外部字体，使用Windows系统字体。发布本软件前仍需完成许可证审计和产品法律主体确认；该记录不是法律合规结论。

Windows 便携包现在包含本机 FFmpeg 8.1 essentials 构建的 ffmpeg.exe、ffprobe.exe，并保留上游 LICENSE、README.txt（含构建及源码来源）。文件位于 resources/app/tools/media。该变化消除了新设备对 C:/ffmpeg 的依赖；面向公开再分发前仍需核对上游源码提供与许可证义务，不能沿用旧版“未打包 FFmpeg”的结论。系统字体未复制。
