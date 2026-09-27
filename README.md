# Bench Extension Template

一个能直接构建和打包的 Bench 插件模板，内含 `@bench/ext-sdk`、React/i18n 示例、脚手架和 minisign 打包工具。SDK 通过 Bench 宿主现有的 Tauri IPC 接口工作；宿主仍按插件 manifest 中的 ACL 命令清单逐项授权。

## 30 分钟上手

1. 在 GitHub 点击 **Use this template** 创建自己的仓库，然后克隆。
2. 安装 Node.js `24.15+` 与 pnpm `12.4.2`，在仓库根目录执行 `pnpm install`。
3. 创建插件：

   ```bash
   pnpm run extensions:create quick-notes
   pnpm install
   ```

   新插件生成在 `extensions/quick-notes/`，包含 manifest、Vite、React 页面和中英文 locale。

4. 修改 `extensions/quick-notes/src/`、`locales/` 与 `manifest.json`。打包前会校验 schema v2 的显示信息、ACL、入口、平台和过期时间；宿主仍会再次校验命令 ACL。
5. 如需本地加载，生成未签名开发包并显式安装到 Bench 的插件目录：

   macOS：

   ```bash
   pnpm run extensions:pack quick-notes --dev-unsigned \
     --install-dir "$HOME/Library/Application Support/com.bench.app/extensions/quick-notes"
   ```

   Windows PowerShell：

   ```powershell
   pnpm run extensions:pack quick-notes --dev-unsigned `
     --install-dir "$env:APPDATA/com.bench.app/extensions/quick-notes"
   ```

   先退出已运行的 Bench，再以 `BENCH_EXT_DEV_MODE=1` 启动 Bench，并在插件中心打开该插件。开发模式跳过 market 签名校验，只用于本机调试；目标目录已存在时命令会拒绝覆盖。

   macOS 可在终端启动：

   ```bash
   open --env BENCH_EXT_DEV_MODE=1 -a Bench
   ```

   Windows PowerShell 可先执行 `$env:BENCH_EXT_DEV_MODE = "1"`，再从同一 PowerShell 会话启动 Bench 可执行文件，确保变量传给该进程。

6. 发布包需安装 [minisign](https://github.com/jedisct1/minisign)，生成作者密钥：

   macOS / Linux：

   ```bash
   mkdir -p "$HOME/.minisign"
   minisign -G -s "$HOME/.minisign/bench-extension.key" -p "$HOME/.minisign/bench-extension.pub"
   ```

   Windows PowerShell：

   ```powershell
   New-Item -ItemType Directory -Force "$HOME/.minisign" | Out-Null
   minisign -G -s "$HOME/.minisign/bench-extension.key" -p "$HOME/.minisign/bench-extension.pub"
   ```

   妥善保管私钥；不要提交私钥、口令或包含真实用户数据的诊断信息。

7. 构建、生成逐文件 SHA-256 清单、签名并打包：

   ```bash
   pnpm run extensions:pack quick-notes \
     --key "$HOME/.minisign/bench-extension.key" \
     --pubkey "$HOME/.minisign/bench-extension.pub"
   ```

   Windows PowerShell 使用相同命令（`$HOME` 会解析到用户目录）；也可用 `--key` / `--pubkey` 显式传入其他路径。

   产物写入 `.artifacts/`，包含插件 ZIP 与用于 registry PR 的 `<id>.meta.json`。已存在的同名产物会被保留，命令会报告冲突并退出。

没有密钥时可用 `pnpm run extensions:pack quick-notes --dev-unsigned` 生成仅供本地调试的未签名 ZIP。未签名 ZIP 只能由开启 `BENCH_EXT_DEV_MODE=1` 的 Bench 开发构建加载，不能提交正式 registry。

## SDK

API 和用法见 [`packages/ext-sdk/README.md`](packages/ext-sdk/README.md)。

```ts
import {
  createExtensionI18n,
  getExtensionDataDir,
  getHostCapabilities,
  invokeHost,
  reportDiagnostic,
} from "@bench/ext-sdk";
```

- `invokeHost`：通过 Tauri IPC 调用宿主命令；宿主根据 manifest ACL 再次校验权限。
- `getHostCapabilities`：读取宿主开放的命令清单。权限检查仍由宿主执行，能力清单只用于 UI 提示。
- `getExtensionDataDir`：获取当前插件隔离的数据目录。
- `createExtensionI18n`：读取宿主注入的语言并初始化 i18next；缺少宿主语言时回退浏览器语言，再回退英文。
- `reportDiagnostic`：向 Bench 已有的本机诊断捕获通道写一条结构化消息；SDK 会限制长度并过滤敏感字段，不会自行联网。

## 提交到插件市场

市场仓库为 [kindred-plugin-market/plugin-market](https://github.com/kindred-plugin-market/plugin-market)。将签名后的 ZIP 发布为 GitHub Release 资产，并向该仓库提交 registry PR：新增版本的 SHA-256、大小、发布时间、下载 URL 与宿主兼容约束。维护者会审核 manifest、最小 ACL、签名和产物来源。第三方自签密钥不能替代官方 registry 信任密钥；发布到官方市场前须按市场仓的维护流程签发。

提交前执行：

```bash
pnpm run verify
```

仓库要求 Node `24.15+`，并以 pnpm `12.4.2` 锁定依赖解析。
