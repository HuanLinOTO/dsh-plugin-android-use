---
name: android-use
description: Use when operating a real Android phone through the android_* tools (dsh-plugin-android-use) — how to read the screenshot coordinate grid, zoom in to pin a tap target, fall back when the accessibility tree is empty, and avoid the mistakes that make phone automation fail
---

# 用 android_* 工具操作安卓手机

这些工具通过 adb 操作真机。**坐标只有一个坐标系：截图像素 = 设备像素**，也就是截图网格上打印的数字。从网格读到的数直接传给 `android_tap` / `android_swipe` / `android_screenshot(region)`，不需要任何换算。

## 感知：两条通道，先试第一条，失败立刻换

1. `android_ui_dump` — 无障碍树，文本、精确、便宜。**优先用**。
   - 返回 `empty: true`（0 nodes）时说明这个 App 没有暴露无障碍节点（美团、微信这类自绘 App 很常见）。**不要重试**，直接转截图。
   - 节点坐标同样是截图像素，`center` 可直接 tap。
2. `android_screenshot` — 视觉通道。图片带**坐标网格**：顶部与右侧的深色小牌就是刻度值。
   - 图片经过压缩（默认长边 ≤1280、JPEG），所以**不要靠数像素估坐标**，要读网格上的数字。
   - 每次抓屏会留存一份到本地临时目录（结果里的 `saved_path`），可供人事后复查。

## 定位：小目标一定要先放大

目标小于 ~60 设备像素（列表里的一行小字、图标、勾选框、关闭按钮）时，先裁剪放大再点，比盲目估计强得多：

```
android_screenshot({ region: { x: 200, y: 800, width: 500, height: 700 } })
```

- `region` 用截图像素写，省略 `magnify` 时会自动放大到尺寸上限（最多 4 倍）。
- 放大图上的网格标签**仍然是全图坐标**：读到 460 就是 tap 的 x，读到 1050 就是 y。
- 放大图上会用红圈十字标出待确认的落点（只有 tap 的 pre-tap 帧才画落点）。
- 需要更细可以再放大一次：`magnify: 4` 配合更小的 `region`。

## 动作：一次一步，步后必看

`android_tap` 返回两张带网格的帧：
- **pre-tap 帧**：红圈十字标出落点位置——先看它，确认落点对不对；
- **post-tap 帧**：点击后的屏幕——确认页面真的变了（进店了？弹窗了？还是没反应？）。

若 post-tap 帧和 pre-tap 帧看起来一样，说明这一下没生效：检查是否点在了不可点区域、是否需要先滚动、是否有遮挡的浮层。

滚动用 `android_swipe`（**没有** `android_scroll` 这个工具）：
```
android_swipe({ x1: 540, y1: 1800, x2: 540, y2: 900, duration_ms: 400 })   // 向下滚动一屏
```

## 效率守则

- **等待用户输入之后必须重新截图**。用户思考的几分钟里，列表会重排、弹窗会弹出、广告会跳出来——沿用旧坐标必然点错。
- 不要在同一轮里连拍好几张图；一次截图、一次分析、一次动作。
- 需要多个动作时，优先合并到一个 `run_code` 程序里（截图→判断→点击），而不是来回十几轮。
- `android_foreground_app` 很便宜，用来确认"我现在到底在哪个 App / 哪个页面"。

## 安全边界（重要）

- **付款、下单、提交订单、删除、注销、发消息给真人**这类不可逆动作，动手前必须先用 `ask_user_question` 或文字向用户确认，说明你将要点什么。
- 用户说"模拟/别真下单"时，走到结算页之前就停下，把金额和商品报给用户。
- 不要擅自关闭开发者选项、授权、系统设置里的开关。

## 常见坑

| 症状 | 原因与对策 |
|---|---|
| `android_ui_dump` 返回 0 节点 | App 未暴露无障碍树，转 `android_screenshot`，别重试 |
| 点击没反应 | 看 post-tap 帧；可能被浮层遮挡、目标未滚到可点区域、或需要长按（`duration_ms`） |
| 点进了错误的条目 | 列表在等待期间重排了：重新截图，读网格坐标，再点 |
| 中文搜索词输入不了 | `input` 模式只支持 ASCII；改用分类/筛选入口，或让用户先手动输入，或请用户把插件配置 `inputTextMode` 设为 `adbkeyboard`（需设备装 ADBKeyboard） |
| 截图里坐标轴数字挡了内容 | 网格是给定位用的，`saved_path` 里的图同样带网格；必要时用 `region` 放大看局部 |
| 找不到某个按钮 | 先滚动（`android_swipe`），再截图；底部导航栏与悬浮按钮通常在固定位置 |

## 工具速查

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `android_list_devices` | 列出设备 | — |
| `android_device_info` | 型号/分辨率/屏幕状态 | — |
| `android_foreground_app` | 当前前台 App 与 Activity | — |
| `android_open_app` | 打开 App | `package`（可用 `pwsh` + `adb shell pm list packages` 查包名） |
| `android_screenshot` | 抓屏（带网格） | `region`, `magnify` |
| `android_ui_dump` | 无障碍树 | — |
| `android_tap` | 点击/长按 | `x`, `y`, `duration_ms` |
| `android_swipe` | 滑动/滚动 | `x1,y1,x2,y2`, `duration_ms` |
| `android_press_key` | 按键 | `key`（home/back/enter/...） |
| `android_input_text` | 输入文本 | `text`, `submit` |

## 一个完整的小例子（点开列表里的第 3 家店）

```
1. android_foreground_app()                        // 确认在目标 App
2. android_screenshot()                            // 读网格，确认列表第 3 家的行位置 y≈950
3. android_screenshot({ region: { x: 60, y: 900, width: 900, height: 200 } })
   // 放大确认店铺名文字，读出中心 x≈540
4. android_tap({ x: 540, y: 950 })                 // pre 帧核对落点，post 帧核对跳转
5. android_foreground_app()                        // 需要时确认已进入店铺页
```
