# android-use 使用反思（复盘会话 session-15d6acc7）

> 复盘对象：2026-09-19 15:01 的一次真机任务 —— 用户："操作我的手机打开美团外卖点一杯咖啡，先给我推荐"。
> 会话在 13 个 step 后被用户中断（turn/end reason: aborted by user），下单流程未走完。
> 证据来源：① DSH `~/.dsh/sessions/sessions.sqlite` 该会话 175 条事件全量导出；② 真机 adb 复现（设备 c122aaf / OnePlus PJF110 / Android 16）；③ 插件源码 `dsh-plugin-android-use`。
> 样本量：1 次真实失败会话 —— 结论有限的通病判断已在文中标注；P0-1 已在真机复现坐实。

---

## 0. 发生了什么（时间线）

| step | 动作 | 结果 |
|---|---|---|
| 1 | `android_list_devices` / `device_info` / `foreground_app` | 正常，1 台设备在桌面 |
| 2 | **绕过插件**：`pwsh` 跑 `adb shell pm list packages \| Select-String meituan` | 找到包名（插件没有"按名找包"的工具） |
| 3–4 | `android_open_app` → `android_ui_dump` ×2 | 应用打开成功；**dump 返回 0 nodes / screen 0x0**（无错误） |
| 4–7 | 转纯视觉：截图 + 按坐标点击"甜点饮品→醒脑咖啡" | 成功，模型靠读图筛选出 4 家咖啡店 |
| 6 | 代码里调 `tools.android_scroll` | `TypeError: tools.android_scroll is not a function`（工具不存在，模型幻觉） |
| 8 | `ask_user_question` 给出 5 个候选 | 用户选 A（库迪咖啡） |
| 9 | 用户插话："模拟即可千万别点下单" | 模型自行收敛为"只到结算页为止" |
| 10 | `android_tap(540,448)` 想进库迪 | **实际进了瑞幸**——等待用户确认的几分钟里列表重排，坐标已失效 |
| 11–13 | 返回列表 → `android_tap(450,448)` 再点 | 第 13 步 assistant 空响应，用户中止会话 |

**量化基线（改进前的对照值）**：13 个 step、5 次 tap、8 次显式截图、**共 18 张 1080×2414 全屏 PNG 进入模型上下文**、任务完成度 0（未进店、未加购）。

---

## 1. P0：三个必须先修的问题

### P0-1 `android_ui_dump` 静默失败：空树 + 0x0，既无诊断也无回退 ★最严重

**现象**：美团页面上两次 dump 都返回 `UI dump: 0 nodes total, screen 0x0, rotation 0` + `Coordinates are in screenshot image space (0x0x0, scale 1.0000)`，且 **isError=false**。

**根因链（真机已复现）**：

1. 插件执行 `adb shell uiautomator dump /sdcard/dsh_ui_dump_<ts>.xml`（`src/tools/screen.ts:319-321`）。uiautomator 在 dump 失败时会**打印假的成功提示**且退出码仍为 0：
   ```
   $ adb shell 'uiautomator dump /system/__denied__.xml'
   UI hierchary dumped to: /system/__denied__.xml     # 撒谎
   $ ls /system/__denied__.xml
   No such file or directory                          # 文件根本没生成
   ```
   而 `AdbClient.shell()` 只看 exitCode，于是这一步不会报错（`src/adb.ts:203-209`）。
2. 随后 `adb exec-out cat <path>` —— **`exec-out` 不传递远端退出码**（实测）：
   ```
   $ adb exec-out 'cat /sdcard/__missing__.xml'
   cat: /sdcard/__missing__.xml: No such file or directory   # 在 stderr
   [exit code: 0]                                            # 客户端退出码却是 0
   ```
   `AdbClient.execOut()` 检查 exitCode（`src/adb.ts:215-221`）→ 不抛错，返回**空字符串**。
3. `parseUiDumpXml('')` → 0 个 node、`screen_width/height = 0`（`src/xml.ts:154-209`）。
4. 渲染层照实输出 "screen 0x0, scale 1.0000"（`src/tools/screen.ts:119-138`）——**自相矛盾的数据**：设备明明是 1080×2414，截图也是 1080×2414。
5. 模型只好自己猜（日志里它猜"美团是自绘/Flutter-like"）并切换到纯视觉路线。

**旁证**：设备 `/sdcard` 上还留着 2026-08-22 的 3 个 dump 文件（QQ 页面，51–89 KB / 235 个节点）——说明 `uiautomator` 链路本身可用，**失败是 App 相关的**（美团页面拿不到 idle 状态或拒绝 dump）；而本次会话（2026-09-19）**一个文件都没留下**，与"文件从未生成"完全吻合。刚测的 systemui dump（24854 字节 / 63 节点）同样正常。

**影响**：插件 PLAN/README 把 ui_dump 定位为"主要屏幕感知方式（DeepSeek 无视觉时靠它）"，但它在真实 App 上是**静默失败**的。失败模式还是最坏的一种：不报错、给假数据、浪费一个 step 才被发现，而"模型自己识破"这件事纯靠运气（本次是 GLM5.2N 认出来了）。

**建议（按成本排序）**：
- **最小改动**：`uiautomator dump` 之后**校验产物**——读取该条命令的 stdout（含 "UI hierchary dumped to:" 才算数）+ 重跑一次读文件长度的探测（`wc -c`）；为空/缺失时抛明确错误，或返回带 `empty: true` 的结构化结果 + 人类可读的下一步建议（"该 App 未暴露无障碍树，请改用 android_screenshot 视觉路线"）。
- **同时**：空树时用 `wm size` 兜底真实分辨率（`src/tools/device.ts:37` 已有 `parseWmSize`），杜绝 `screen 0x0` 这类自相矛盾输出。
- **可选增强**：dump 失败/空树时，若当前 route 支持视觉，**直接把截图一并塞进同一条结果**，省掉"模型再喊一次 android_screenshot"的往返。
- **可选增强**：试 `uiautomator dump --compressed`（Android 11+）作为失败重试路径；并在真机矩阵（美团/微信/淘宝/QQ/系统设置）上跑一次，把各 App 的 dump 可用性写进 README。
- 顺带清理：dump 后 `rm` 掉临时文件（见 P2-1）。

### P0-2 一次 13 步的任务产生 18 张全屏截图——上下文成本的最大来源

**证据**：5 次 `android_tap` 各回传 pre+post **两张**截图（`src/tools/input.ts:292-352` 无条件抓取），加 8 次显式 `android_screenshot`，共 18 张 1080×2414 PNG（单张 0.8–2.0 MB）。

**附加副作用（会话记录可见）**：截图文本提示（"Screenshot captured …"）既出现在工具结果里，又作为 `agent/inbox/spliced` + `user/message` **再注入一次**，且图像是以 **user 角色消息**进入上下文的（seq 54/58/68/73 等）。于是历史里堆了 18 条"伪用户消息"——对模型判断"用户到底说了什么"是噪声。

**建议**：
- tap 的截图改为可选：`capture: 'none' | 'after' | 'both'`（默认 `'after'`），或加插件级配置 `tapCapture`；
- **无变化不发图**：比较 pre/post 截图的哈希/差异，屏幕没变就只回文本（pre 图本来就是为了标注落点，post 图才是"结果"，两者经常高度重复）；
- 降分辨率/换编码：截图按 `maxImageDimension`（默认 2000）缩到 e.g. 1280 长边或输出 JPEG，视觉判读（找图标、读价格）通常够用；当前 1080×2414 原图几乎必然超 tile 切分阈值；
- 把"分辨率/坐标空间"这类元信息**合并成一行**，别每次三行复读。

### P0-3 坐标点击没有"新鲜度/校验"语义 → 实体副作用点错店铺

**证据**：step 8 用户确认用了数分钟（`ask_user_question` 阻塞），期间美团列表重排；step 10 按几分钟前的截图坐标 `(540,448)` 点击，进的是**瑞幸**而不是用户选的**库迪**。模型只能在下一屏才发现，白跑两步（step 11 返回、step 13 重点），最终用户中断。

**根因**：`android_tap(x,y)` 是纯净的坐标注入（`input tap`），既不校验"我点到了什么"，也不报告"点完之后前台/界面变了没有"。

**建议（不引入浏览器那套沉重的定位体系，YAGNI）**：
- 结果里**顺手带上点击后的前台 app/activity**（`dumpsys window` 已经有一份实现，见 `src/tools/apps.ts:38`），让模型一眼看出"我怎么进了瑞幸"；
- 可选的 `expect` 参数：`expect_package` / `expect_text`（点击后用一次 dump 或前台 activity 校验），不匹配时在结果里明确 warning（不是抛错，因为很多跳转本就异步）；
- 可选新增 `android_tap_text(text)`：dump 可用时按文本命中节点中心点击——把"坐标"这件事交给设备端，天然免疫重排；dump 不可用时再退回坐标。

---

## 2. P1：能力缺口（模型在会话中被迫绕道）

| 缺口 | 会话中的表现 | 建议 |
|---|---|---|
| **没有滚动工具** | 模型凭直觉写 `tools.android_scroll(...)` → `TypeError: not a function` | 要么加 `android_scroll(direction, distance?)` 包装（内部 `input swipe`），要么在 `android_swipe`/`android_tap` 的描述里写明"滚动请用 android_swipe"——模型看得到的是工具描述，不是 README |
| **不能按名找包** | 第 2 步退回 `pwsh` + `adb pm list packages` 手撸 | `android_list_packages(filter?)`，或让 `android_open_app` 接受应用名（"美团外卖"）做模糊解析后给出候选 |
| **中文输入受限** | `input` 模式 ASCII-only，模型因此**放弃搜索"咖啡"**，改走分类入口绕路 | 错误信息已经很好（提示切 `adbkeyboard`）；补一条"未装 ADBKeyboard 时的替代路径"到工具描述里（拼音/英文关键词、或让用户先手输）|
| **没有 dry-run / 只读模式** | 用户不得不中途插话"模拟即可千万别点下单" | 插件级配置 `readOnly`/`dryRun`：tap/swipe/input_text 只标注不执行（截图上画出落点 + 返回 `dry_run: true`）。**真实支付类操作不可逆，这个开关比什么都值钱** |
| **长流程无状态提示** | 反复"截图→点击→截图"，13 步里 8 步在感知 | 可在结果里加"距上次截图 N 秒"，用一行文本提醒模型重新确认屏幕（成本极低）|

---

## 3. P2：卫生与文档

1. **临时文件不清理**：`/sdcard/dsh_ui_dump_<ts>.xml` 用完不删，实测设备上仍留着 2026-08-22 的 3 个文件（51/55/89 KB）。dump 后应 `rm`（或统一写 `/data/local/tmp` 并清理）。
2. **README/PLAN 与现实相反**：两者都写 "`android_ui_dump` **为主**（DeepSeek 无视觉能力，靠它感知屏幕）"，而真实使用中视觉截图才是主通道，且 dump 在主流 App 上常常为空。文档应改为"双通道对等，dump 失败即回退视觉"，并附各 App 实测可用性。
3. **工具数量≠能力覆盖**：10 个工具里"感知 2 + 输入 4"，但感知的 2 个在真实 App 上一个静默失败、一个成本极高——**广度够了，深度不够**。

---

## 4. 建议的验证方式（Check 阶段怎么做才算改好了）

- **单测**（`tests/tools.spec.ts` 目前只覆盖"dump 成功"路径，无空树/失败用例）：
  - 空 XML → 分辨率回退到 `wm size`、结果带"空树"标记、渲染文本含明确建议；
  - dump 文件缺失（exec-out 空）→ 抛出/标记为失败，而不是 0 nodes 静默成功；
  - `capture:'none'/'after'` → 断言不调用 `screencap`；pre/post 无差异时只回文本。
- **真机脚本**：对 美团 / 微信 / 淘宝 / QQ / 系统设置 各 dump 一次，记录（节点数、是否落盘、耗时），产出可用性矩阵写进 README。
- **端到端对照**（同任务、同设备）：基线 = 13 step / 18 张图 / 点错 1 次；目标 = ≤8 step / ≤6 张图 / 0 次误点。

---

## 附录 A：复现命令

```powershell
# 1) uiautomator 的"假成功"：命令声称成功、退出码 0、文件不存在
adb shell 'uiautomator dump /system/__x__.xml'   # → "UI hierchary dumped to: ..."
adb shell 'ls -la /system/__x__.xml'             # → No such file or directory

# 2) exec-out 不传递远端退出码（静默失败的关键）
adb exec-out 'cat /sdcard/__missing__.xml'       # stderr 报错，但 exit code = 0

# 3) 对照：systemui / QQ 页面 dump 正常
adb shell 'uiautomator dump /sdcard/probe.xml; wc -c /sdcard/probe.xml'   # 24854 字节 / 63 节点

# 4) 重新导出会话事件流（本报告的证据来源）
python -c "import sqlite3,os;db=os.path.expanduser('~/.dsh/sessions/sessions.sqlite');con=sqlite3.connect('file:'+db+'?mode=ro',uri=True);rows=con.execute("select se.f_sequence,e.f_type,e.f_data from t_session_events se join t_events e on e.f_event_id=se.f_event_id where se.f_session_id=? order by se.f_sequence",('session-15d6acc7-209a-427b-8dfa-4d04cbfcb7fe',)).fetchall();print(len(rows),'events')"
```

## 附录 B：会话事实速查

- 设备：`c122aaf` OnePlus PJF110 / Android 16 (SDK 36) / 1080×2414（`wm size` 显示 Physical 1240×2772 + Override 1080×2414）
- 会话：1 turn、13 step、175 条事件、终止于用户中断
- 工具调用分布：`android_tap` ×5、`android_screenshot` ×8、`android_ui_dump` ×2（均 0 节点）、`android_swipe` ×1、`android_open_app` ×1、`android_foreground_app` ×3、`pwsh`（adb 手撸）×1、`ask_user_question` ×1
- 模型：`newapi / GLM5.2N`（**有视觉能力**，因此 `image_emitted: yes`——插件的"DeepSeek 无视觉"前提在本次会话里不成立）
