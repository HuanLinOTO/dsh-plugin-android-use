# PLAN — dsh-plugin-android-use

> 让 AI 通过 adb 操作安卓手机的 DSH 插件。Bundle 形态、预构建 `lib/`、host-only（无 client UI）。
> 范本：`dsh-sleep`（最小工具插件骨架）+ `packages/fs/tool-fs/src/read-image.ts`（图像块返回模式）。

---

## 0. 结论要点

- **无现成骨架**；从零新建 `D:\Projects\deepseek-harness\dsh-plugin-android-use\`，按 dsh-sleep 模板（bundle 形态、预构建 `lib/`、ambient peer 类型、junction 到 DSH staging 做类型检查）。
- **手机感知双通道**：
  - `android_ui_dump`（accessibility 树，文本）**为主**——DeepSeek 无视觉能力，模型靠它感知屏幕。
  - `android_screenshot`（图像块）**为辅**——仅当当前模型路由声明 image 输入时向模型发图；否则仍保存到 attachment store（UI 卡片给人看）+ 返回元数据。沿用 `read_image` 的 `ctx.get('attachments').saveImage()` 模式。
- **真实设备已联通验证**：`192.168.5.15:43709`（PJF110）；`screencap -p`(13KB)、`uiautomator dump`、`wm size`(1080×2414)、`dumpsys window` 均可用。

## 1. 仓库骨架

```
dsh-plugin-android-use/
├── src/
│   ├── index.ts          # name / inject=['tools'] / Config / apply
│   ├── types.d.ts        # ambient: cordis / dsh-tools / dsh-attachment / dsh-llm
│   ├── adb.ts            # AdbClient: spawn 封装（信号取消、binary/string 双通道）+ serial 解析
│   ├── xml.ts            # uiautomator XML 解析（零依赖，属性扫描 → 节点列表）
│   ├── keys.ts           # 命名按键表（home/back/app_switch/power/... 映射 keycode）
│   ├── registry.ts       # registerTools(ctx, deps) — deps 注入 AdbClient 便于测试
│   └── tools/
│       ├── device.ts     # list_devices / device_info
│       ├── screen.ts     # screenshot / ui_dump
│       ├── input.ts      # tap / swipe / press_key / input_text
│       └── apps.ts       # open_app / foreground_app
├── tests/
│   ├── adb.spec.ts
│   ├── xml.spec.ts
│   ├── keys.spec.ts
│   ├── input.spec.ts
│   └── tools.spec.ts     # fake AdbClient + fixture（真实 launcher dump XML）
├── package.json          # @huanlin/dsh-plugin-android-use, dsh.bundle.patch, 预构建（无 prepare）
├── cordis.patch.yml      # insert 行, name 用包名
├── tsconfig.json
├── tsdown.config.ts
├── vitest.config.ts
├── .gitignore            # node_modules / lockfiles / lib?（lib 不进 ignore，预构建策略）
├── pnpm-workspace.yaml   # packages:[.] + allowBuilds esbuild
└── README.md             # 中文: 开发/运行/检查
```

## 2. 10 个工具

| 工具 | 参数 | 实现 |
|---|---|---|
| `android_list_devices` | 无 | `adb devices -l` → `[{serial,state,product,model,device}]` + total |
| `android_device_info` | serial? | `wm size/density` + `getprop`(model/brand/android_version/sdk) + `dumpsys power` 屏幕状态 → `{serial, model, brand, android_version, sdk, screen:{width,height,density}, screen_on}` |
| `android_screenshot` | serial? | `exec-out screencap -p` → PNG buffer → `attachments.saveImage()` → ref；canonical `{serial,width,height,bytes,image:{attachmentId,mediaType,bytes,width,height},image_emitted:bool}`；render = text 包络 + image 块（仅 `image_emitted` 时） |
| `android_ui_dump` | serial? | `uiautomator dump /sdcard/...` + `exec-out cat` → 解析 → `{screen_width, screen_height, rotation, nodes:[{text,content_desc,resource_id,class,bounds,center,clickable,long_clickable,focusable,scrollable,enabled,password,selected,checked,depth}]}` |
| `android_tap` | x:int, y:int, duration_ms?（长按）, times? | `input swipe x y x y dur`（长按）/ `input tap x y`（普通） |
| `android_swipe` | x1,y1,x2,y2, duration_ms? | `input swipe x1 y1 x2 y2 dur` |
| `android_press_key` | key: string（命名）或 keycode: int（oneOf） | `input keyevent <code>` |
| `android_input_text` | text:string, submit? | `input text`(ASCII，非 ASCII 在 'input' 模式下明确报错) 或 `adbkeyboard` broadcast（URL-encoded UTF-8，Config 切换） |
| `android_open_app` | package:string, activity? | `am start -n pkg/.act`（有 activity）或 `monkey -p pkg -c LAUNCHER 1`（无 activity） |
| `android_foreground_app` | serial? | `dumpsys window` → `mCurrentFocus` → `{package, activity, window_title?, screen_on}` |

## 3. 行为约定

- **serial 解析序**：参数 `serial` → Config `defaultSerial` → 单设备自动 → 多设备报错「multiple devices, pass serial」。
- **C6 取消**：所有 adb spawn 传 `exec.signal`，取消即杀子进程。
- **C4/C5 输出**：canonical lossless JSON + 纯 `render` 投影；adb 缺失/设备离线等基础设施失败 throw。
- **截图图像块门控**：`android_screenshot` **不**因路由非 image-capable 而 throw；best-effort 解析路由（`ctx.get('llm').resolveModelInfo(...).inputModalities.includes('image')`），是则发 image 块、否则仅存 attachment + 元数据（感知走 ui_dump）。llm 服务缺失则跳过门控、不发图。
- **命名按键表**（`src/keys.ts`）：home(3)/back(4)/app_switch(187)/power(26)/menu(82)/enter(66)/space(62)/backspace(67)/tab(61)/volume_up(24)/volume_down(25)/volume_mute(164)/mute(91)/camera(27)/search(84)/dpad_up/down/left/right/center/delete/escape 等；同时接受裸 integer keycode。
- **`input text` 转义**：ASCII 模式下对空格 `%s`、`&` 等做转义；非 ASCII 在 'input' 模式抛「switch inputTextMode to adbkeyboard」明示。
- **零运行时依赖**：仅 `node:child_process` spawn + `node:path`；peer 由宿主提供（F5）。

## 4. Config 字段

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `adbPath` | string | `'adb'` | adb 可执行路径（本机 `D:\Softwares\scrcpy\adb.exe` 在 PATH 上） |
| `defaultSerial` | string? | - | 默认设备 serial；省略则单设备自动/多设备报错 |
| `inputTextMode` | `'input' \| 'adbkeyboard'` | `'input'` | 文本输入模式；`adbkeyboard` 走 ADBKeyboard IME broadcast 注入中文 |

## 5. 开发接线（dev wiring）

`pnpm-workspace.yaml`：
```yaml
packages:
  - .
autoInstallPeers: false
allowBuilds:
  esbuild: true
```

手工 junction（typecheck 用，对应 dsh-sleep 做法）：
- `node_modules/@deepseek-ai/cordis` → `D:\Projects\deepseek-harness\dsh\vendor\cordis`
- `node_modules/@deepseek-ai/dsh-tools` → `D:\Projects\deepseek-harness\dsh\packages\core\tools`
- `node_modules/@deepseek-ai/dsh-attachment` → `D:\Projects\deepseek-harness\dsh\packages\attachment\attachment`

`pnpm install` → `pnpm typecheck` / `pnpm test` / `pnpm build`。

## 6. 安装（link: 本地，暂不发布）

```powershell
dsh plugin --profile web add "link:D:\Projects\deepseek-harness\dsh-plugin-android-use"
```

重启 `dsh web` + 浏览器硬刷新（`Ctrl+Shift+R`）。

## 7. 验证

- **单测全绿**：fake AdbClient（注入 `registerTools` 的 deps）+ 真实 fixture（launcher dump XML）覆盖解析/参数构建/schema/render。
- **build 产出** `lib/index.js`。
- **实机冒烟**：对 DeepSeek 下达「列出连接的安卓设备」「读取当前屏幕布局并告诉我桌面有哪些应用」等任务，验证 `list_devices` + `ui_dump` 链路。

## 8. 测试设计

| 文件 | 覆盖 |
|---|---|
| `tests/adb.spec.ts` | `parseDeviceList`(fixture)、`runAdb` 的 stdout/stderr 收集、binary 通道不解码、`exec.signal` 取消杀进程 |
| `tests/xml.spec.ts` | `parseUiDumpXml`（真实 launcher dump → 节点数/中心坐标/可交互过滤）；空/畸形 XML |
| `tests/keys.spec.ts` | 命名→keycode 映射；裸 keycode 透传；未知命名报错 |
| `tests/input.spec.ts` | `input text` 转义（空格/特殊字符）；非 ASCII 在 input 模式抛错；adbkeyboard 模式 URL 编码 |
| `tests/tools.spec.ts` | `registerTools` 注入 fake AdbClient，验证每个工具 schema（required/类型）、execute canonical 值、render 纯投影、serial 解析序、多设备报错 |

## 9. 合规自检（发布前，本次暂不发布但达标）

- [ ] 零源码 patch
- [ ] B1: `package.json` 声明 `dsh.bundle.patch`
- [ ] B2: 自带 `cordis.patch.yml`（insert 行 id/name/config 齐全）
- [ ] B3: patch 行 `name` 用包名
- [ ] F1: `files` 含 `lib/` + `cordis.patch.yml`
- [ ] F2: `peerDependencies` 含 cordis + 用到的 `@deepseek-ai/*`（dsh-tools / dsh-attachment optional）
- [ ] F3: typecheck/test/build script 齐全
- [ ] A6: 不导出 default
- [ ] C4: 工具返回规范 JSON + render 投影分离
- [ ] G: 测试分层（Unit）
- [ ] README 中文（开发/运行/检查三节）
