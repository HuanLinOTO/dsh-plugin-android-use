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
| `captureDir` | string? | `<系统临时目录>/dsh-android-use` | 每张发给模型的帧都会在此留一份，便于事后复查。 |
| `captureKeep` | number | `200` | 留存上限，超出按时间删除最旧的；`0` 表示不清理。 |
| `imageMaxDimension` | number | `1280` | 发给模型的图片长边上限（像素）：1080x2414 的截图会压到 573x1280。 |
| `imageFormat` | `'jpeg' | 'webp' | 'png'` | `'jpeg'` | 发送编码。jpeg 体积最小，png 无损最大。 |
| `imageQuality` | number | `80` | jpeg / webp 质量。 |
| `showGrid` | boolean | `true` | 是否在发送的帧上绘制坐标网格。 |
| `provideSkill` | boolean | `true` | 是否把插件自带 skill 注册到 `ctx.skills`（profile 未挂 skills 服务时自动跳过）。 |

## 工具

### 设备发现

| 工具 | 参数 | 说明 |
|------|------|------|
| `android_list_devices` | 无 | 列出所有已连接的安卓设备（serial、state、product、model）。 |
| `android_device_info` | `serial?` | 获取设备详细信息：型号、品牌、Android 版本、SDK、屏幕分辨率、密度、屏幕状态。 |

### 屏幕感知

| 工具 | 参数 | 说明 |
|------|------|------|
| `android_screenshot` | `region?`, `magnify?`, `serial?` | 截屏 → 裁剪/放大 → 压缩（默认长边 ≤1280、JPEG）→ 烧入坐标网格 → 留存本地 → 发图。`region` 用截图像素；省略 `magnify` 时自动放大到上限（≤4×）。返回 `saved_path`、设备分辨率、压缩比、网格步长。 |
| `android_ui_dump` | `serial?` | 转储无障碍树，节点 `center` 即截图像素坐标。**App 未暴露无障碍节点时返回 `empty: true` 并明确建议改用截图**（不再静默返回 0 节点 + `screen 0x0`）。 |

### 输入操作

| 工具 | 参数 | 说明 |
|------|------|------|
| `android_tap` | `x, y` (必填), `duration_ms?`, `times?` | 点击（坐标 = 截图像素 = 网格标签值）。返回 pre-tap（带落点标记）与 post-tap 两张网格帧。`duration_ms > 0` 为长按。 |
| `android_swipe` | `x1, y1, x2, y2` (必填), `duration_ms?` | 滑动/滚动，坐标同上。列表滚动用它（**没有** `android_scroll`）。 |
| `android_press_key` | `key` (必填, 命名或整数), `times?` | 按键。命名键：`home`/`back`/`app_switch`/`power`/`enter`/`volume_up` 等，或裸 keycode 整数。 |
| `android_input_text` | `text` (必填), `submit?` | 在聚焦输入框中输入文本。`submit: true` 输入后按回车。 |

### 应用管理

| 工具 | 参数 | 说明 |
|------|------|------|
| `android_open_app` | `package` (必填), `activity?` | 打开应用。有 activity 用 `am start`；无 activity 用 `monkey` 启动默认 Activity。 |
| `android_foreground_app` | `serial?` | 获取当前前台应用和 Activity（通过 `dumpsys window`）。 |

## 坐标系与坐标网格

所有坐标只有一个坐标系：**截图像素 = 设备像素 = 网格上打印的数字**。

- `android_screenshot` 发回的图带坐标网格：顶部与右侧的深色刻度牌就是坐标值，读到 540 就直接 `android_tap({ x: 540, ... })`。
- 图片经过压缩（默认长边 1280），**不要按像素比例估算坐标**，读网格标签即可。
- `region` + `magnify` 用于放大确认小目标；放大图的标签仍是全图坐标，可直接用于点击。
- `android_ui_dump` 的节点 `center` 同样落在这一坐标系，无需换算。

## 截图留存

每张发给模型的帧都会写到 `captureDir`（默认系统临时目录下的 `dsh-android-use/`），文件名形如 `20260919-161233-480-pre-tap.jpg`，超出 `captureKeep`（默认 200）自动清理最旧的。工具结果里的 `saved_path` 指向该文件，便于人工复现"模型当时看到了什么"。

## 自带 skill（安装即生效，零文件操作）

`skills/android-use/SKILL.md` 是插件自带的玩法说明（读网格、放大定位、dump 空树的回退、等待用户后必须重新截图等）。插件在 `apply()` 里把它作为 **runtime skill** 注册到 `ctx.skills`：

```ts
ctx.effect(() => ctx.skills.register({ name, description, content, source: 'runtime', resourceBase }))
```

因此**安装插件即可用**：不写 `postinstall`、不复制/链接任何文件到 `~/.agents/skills`、不依赖 `skill-filesystem`。名字、描述与正文在加载时从 `SKILL.md` 解析（该文件是唯一真相），注销随插件 fiber 一起回收。

- profile 未挂载 skills 服务时自动跳过（工具照常可用，只是少了这份说明）。
- 想改用文件系统版本（例如自行改 skill 文本）：把配置 `provideSkill` 设为 `false`，再把 `skills/android-use` 链接到 `~/.agents/skills/`：

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.agents\skills\android-use" -Target "D:\Projects\deepseek-harness\dsh-plugin-android-use\skills\android-use"
```

> 两种方式同时存在会因同名冲突只生效一个（注册表会告警），按需二选一。

## 开发

```sh
pnpm install          # 安装开发依赖（schemastery、typescript、vitest、tsdown）
pnpm run typecheck    # tsc --noEmit 类型检查
pnpm test             # vitest run 单元测试（含真实 ctx.skills 注册表集成用例）
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
  "dsh-skill"                  = "$src\packages\skill\skill"
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
- [x] G: Unit 测试（`tests/*.spec.ts`，含真实 launcher dump fixture；图像管线的尺寸/网格/裁剪断言在 `image.spec.ts`、`annotate.spec.ts`）

## 目录结构

```
dsh-plugin-android-use/
├── src/
│   ├── index.ts           # 入口：name、inject、Config（Schemastery）、apply
│   ├── adb.ts             # AdbClient: spawn 封装 + serial 解析 + 设备列表解析
│   ├── frame.ts           # 截图管线：抓屏 → 裁剪/放大 → 压缩 → 网格标注 → 留存 → 发图
│   ├── image.ts           # 裁剪/缩放/编码（sharp），坐标系换算
│   ├── annotate.ts        # 坐标网格、落点/滑动标记、底部说明条（SVG composite）
│   ├── capture.ts         # 留存目录写入与上限清理
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
