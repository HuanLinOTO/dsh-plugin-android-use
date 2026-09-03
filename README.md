<p align="center">
  <a href="https://dshfind.com/zh/plugins/huanlinoto/dsh-plugin-android-use"><img src="https://dshfind.com/api/card/huanlinoto/dsh-plugin-android-use?lang=zh" alt="dsh-plugin-android-use card"></a>
</p>

# dsh-android-use

DSH 插件：让 AI 通过 adb 操作安卓手机。提供 10 个工具覆盖设备发现、屏幕感知、输入操作和应用管理，让模型能够自主操控 Android 设备。

## 安装

```sh
# 从本地 checkout 开发安装：
dsh plugin --profile web add link:D:\Projects\deepseek-harness\dsh-plugin-android-use

# 从 npm 安装（发布后）：
dsh plugin --profile web add @huanlin/dsh-plugin-android-use
```

预构建策略：`lib/` 入库，无 `prepare` 脚本，npm 安装开箱即用，无需 `allowBuilds`。

**前提条件**：本机已安装 adb 并在 PATH 上（或通过 `adbPath` 配置指定路径），已通过 `adb connect <ip:port>` 或 USB 连接 Android 设备。

## 配置

在 DSH GUI 设置页或 `cordis.patch.yml` 中配置：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `adbPath` | string | `'adb'` | adb 可执行路径。默认从 PATH 查找。 |
| `defaultSerial` | string? | - | 默认设备 serial。省略则单设备自动选择；多设备时模型需传 `serial` 参数。 |
| `inputTextMode` | `'input' \| 'adbkeyboard'` | `'input'` | 文本输入模式。`input` 仅支持 ASCII（用 `adb shell input text`）；`adbkeyboard` 支持 Unicode（需设备安装 ADBKeyboard IME）。 |

## 工具

### 设备发现

| 工具 | 参数 | 说明 |
|------|------|------|
| `android_list_devices` | 无 | 列出所有已连接的安卓设备（serial、state、product、model）。 |
| `android_device_info` | `serial?` | 获取设备详细信息：型号、品牌、Android 版本、SDK、屏幕分辨率、密度、屏幕状态。 |

### 屏幕感知

| 工具 | 参数 | 说明 |
|------|------|------|
| `android_screenshot` | `serial?` | 截屏并保存到 attachment store。仅当当前模型路由支持 image 输入时向模型发图；否则仅返回元数据（感知走 `android_ui_dump`）。 |
| `android_ui_dump` | `serial?` | 转储 accessibility 树（UI 层级），返回节点列表（文本、bounds、center 坐标、交互标志）。**主要屏幕感知方式**——DeepSeek 无视觉能力时靠它理解屏幕。 |

### 输入操作

| 工具 | 参数 | 说明 |
|------|------|------|
| `android_tap` | `x, y` (必填), `duration_ms?`, `times?` | 点击屏幕坐标。`duration_ms > 0` 为长按。 |
| `android_swipe` | `x1, y1, x2, y2` (必填), `duration_ms?` | 从一点滑动到另一点。 |
| `android_press_key` | `key` (必填, 命名或整数), `times?` | 按键。命名键：`home`/`back`/`app_switch`/`power`/`enter`/`volume_up` 等，或裸 keycode 整数。 |
| `android_input_text` | `text` (必填), `submit?` | 在聚焦输入框中输入文本。`submit: true` 输入后按回车。 |

### 应用管理

| 工具 | 参数 | 说明 |
|------|------|------|
| `android_open_app` | `package` (必填), `activity?` | 打开应用。有 activity 用 `am start`；无 activity 用 `monkey` 启动默认 Activity。 |
| `android_foreground_app` | `serial?` | 获取当前前台应用和 Activity（通过 `dumpsys window`）。 |

## 开发

```sh
pnpm install          # 安装开发依赖（schemastery、typescript、vitest、tsdown）
pnpm run typecheck    # tsc --noEmit 类型检查
pnpm test             # vitest run 单元测试（132 用例）
pnpm run build        # tsc + tsdown → lib/（index.js + client.js 双产物）
```

类型检查需要 junction 到本地 DSH 源码树（私有 peer 依赖不在 npm 上；junction 必须在 `pnpm install` 之后创建）：

```powershell
# 在 node_modules/@deepseek-ai/ 下创建 junction（指向本地 DSH 源码 checkout）
$nm = "node_modules/@deepseek-ai"
$src = "C:\Users\Administrator\.dsh\source\current"
@{
  "cordis"                     = "$src\vendor\cordis"
  "dsh-tools"                  = "$src\packages\core\tools"
  "dsh-attachment"             = "$src\packages\attachment\attachment"
  "dsh-llm"                    = "$src\packages\llm\llm"
  "dsh-client-ui-slots"        = "$src\packages\client\ui-slots"
  "dsh-client-ui-tool"         = "$src\packages\client\ui-tool"
  "dsh-client-ui-session"      = "$src\packages\client\ui-session"
  "dsh-client-ui-conversation" = "$src\packages\client\ui-conversation"
  "dsh-client-ui-renderer"     = "$src\packages\client\ui-renderer"
}.GetEnumerator() | ForEach-Object {
  New-Item -ItemType Junction -Path (Join-Path $nm $_.Key) -Target $_.Value | Out-Null
}
```

## 检查

合规自检（参见 `plugin-development-guide.md` §10）：

- [x] **零源码 patch**：未修改 DSH checkout 任何文件
- [x] B1: `package.json` 声明 `dsh.bundle.patch`
- [x] B2: 插件自带 `cordis.patch.yml`（insert 行 id/name/config 齐全）
- [x] B3: patch 行 `name` 用包名（Loader 从 profile node_modules 解析）
- [x] F1: `files` 含 `lib/` + `cordis.patch.yml`
- [x] F2: `peerDependencies` 含 `@deepseek-ai/cordis` + 用到的 `@deepseek-ai/*`（不用 devDependencies 冒充）
- [x] F3: typecheck/test/build script 齐全
- [x] A6: 不导出 default
- [x] C4: 工具返回规范 JSON 值 + render 投影分离
- [x] C5: adb 缺失/设备离线等基础设施失败 throw；取消不 throw
- [x] C6: 尊重 `exec.signal` 取消在途 adb 子进程
- [x] G: Unit 测试（`tests/*.spec.ts`，132 用例，含真实 launcher dump fixture）

## 目录结构

```
dsh-plugin-android-use/
├── src/
│   ├── index.ts           # 入口：name、inject、Config（Schemastery）、apply
│   ├── adb.ts             # AdbClient: spawn 封装 + serial 解析 + 设备列表解析
│   ├── xml.ts             # uiautomator XML 解析（零依赖）
│   ├── keys.ts            # 命名按键表（home/back/app_switch/... → keycode）
│   ├── registry.ts        # registerTools(ctx, deps) — 依赖注入入口
│   ├── client/            # 浏览器半：tool.call.toolview 卡片（tap / screenshot）
│   │   ├── index.ts       # client 插件：slots.inject 注册两张卡片
│   │   ├── TapCard.tsx    # android_tap 卡片（前后截图对照）
│   │   └── ScreenshotCard.tsx  # android_screenshot 卡片
│   └── tools/
│       ├── device.ts      # list_devices / device_info
│       ├── screen.ts      # screenshot / ui_dump
│       ├── input.ts       # tap / swipe / press_key / input_text
│       └── apps.ts        # open_app / foreground_app
├── tests/
│   ├── adb.spec.ts        # 设备列表解析、serial 解析序
│   ├── xml.spec.ts        # XML 解析（真实 launcher dump fixture）
│   ├── keys.spec.ts       # 命名按键 → keycode 映射
│   ├── input.spec.ts      # 文本转义、非 ASCII 报错、adbkeyboard 编码
│   ├── tools.spec.ts      # fake AdbClient + 全工具 schema/execute/render 验证
│   └── fixtures/
│       └── launcher_dump.xml  # 真实 PJF110 设备 launcher dump
├── cordis.patch.yml       # bundle 层：插入 dsh-android-use 插件行
├── package.json           # dsh.bundle.patch 声明 + peerDeps
├── tsconfig.json          # NodeNext、ES2022、strict
├── tsdown.config.ts       # 双 entry：index.js（node）+ client.js（DSSH 模块加载器包裹）
└── vitest.config.ts       # vitest forks pool
```
