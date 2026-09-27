# `@bench/ext-sdk`

Bench 插件的 TypeScript 薄封装。SDK 复用 Bench 宿主已开放的 Tauri IPC，不会自行联网或授予额外权限。安装到 Bench 后，每条命令仍由宿主按插件 `manifest.json` 中的 ACL 校验。

## IPC 能力

```ts
import {
  getExtensionDataDir,
  getHostCapabilities,
  invokeHost,
  isBenchExtension,
} from "@bench/ext-sdk";

const inBench = isBenchExtension();
if (inBench) {
  const capabilities = await getHostCapabilities();
  const dataDir = await getExtensionDataDir();
  // Replace with a host-registered command and its declared arguments.
  const result = await invokeHost<{ count: number }>(
    "<registered_command>",
    {},
  );
}
```

- `isBenchExtension()` 检测当前窗口是否运行在 Bench Tauri WebView 中。浏览器预览可以据此隐藏宿主专用操作。
- `getHostCapabilities()` 返回宿主开放的命令名，适合控制界面提示。它只提供信息，**不能代替** `manifest.json` 的 ACL，也不能绕过宿主校验。
- `invokeHost<T>(command, args?)` 调用一个宿主命令。命令名必须由宿主注册，并列入插件 ACL；从普通浏览器预览调用会返回错误。
- `getExtensionDataDir()` 返回当前插件隔离的数据目录。插件应将私有状态保存在此目录下，不要写入其他插件目录。

## i18n

```ts
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import { createExtensionI18n } from "@bench/ext-sdk";

export const i18n = createExtensionI18n({
  en: { translation: en },
  zh: { translation: zh },
});
```

`createExtensionI18n()` 返回该插件独立的 i18next 实例，语言优先读取宿主注入值，其次读取浏览器语言，最后回退英文。当前支持中文和英文。

## 本机诊断

```ts
import { reportDiagnostic } from "@bench/ext-sdk";

reportDiagnostic("error", "terms-load", "Could not load terms.", {
  retryable: true,
  httpStatus: 503,
});
```

`reportDiagnostic()` 通过宿主已存在的 `console.error` 捕获通道写入本机诊断日志，不会发起网络请求。SDK 会过滤常见凭据字段、清理文本里的 Bearer/Basic 授权值，并限制消息长度、上下文字段数量和单个字段长度。日志仍应避免包含真实用户数据。

## 开发与依赖

在插件工作区中以 workspace 依赖引用：

```json
{
  "dependencies": {
    "@bench/ext-sdk": "workspace:*"
  }
}
```

先从 [模板仓库根 README](../../README.md) 完成本地开发模式与插件打包配置。直接调用 Tauri API 时仍需在 `manifest.json` 声明最小 ACL；请勿把 `getHostCapabilities()` 当作安全边界。
