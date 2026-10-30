# Cookie 百分表 · dsh-cookie-meter

> 大肥鱼出品 🐳

DSH 桌面版的右下角小浮窗：用百分比告诉你「登录 cookie 快把请求头顶满了」，过半数字变红，旁边一个一键清理。

**为什么需要它**：DSH 桌面版每次启动都会往 Chromium 的 cookie jar 里塞一条
`dsh-auth-<sha256(127.0.0.1:端口)>` 登录 cookie，而且从不清理。每条在 HTTP 请求头里占 228 字节，
Node 默认 `maxHeaderSize` 是 16384 字节 —— 攒到 **第 72 条**，根请求直接被回 `431`，
桌面表现为 `desktop welcome: Web authentication failed`，也就是传闻中的「DSH 启动几十次以后就打不开了」。

这个小浮窗只做三件事：

- **百分比**：`cookie 条数 × 228 / 16384`，随时知道离 431 还有多远；
- **过半变红**：超过 50% 数字变红、状态行提示「已过半，建议清理」；
- **一键清理**：旁边一个按钮，清掉老 cookie，从第 1 条重新开始数。

## 预览

```
┌─────────────────────────────┐
│ 鲸  Cookie 百分表        ↻  │
│                             │
│  61.2%          [ 一键清理 ]│
│  46 条 · 10.2 KiB / 16.0 KiB│
│  ● 已过半，建议清理          │
└─────────────────────────────┘
```

浮窗可以按住标题栏拖动，位置记在 `localStorage`，刷新页面也不会跑。

## 打开与收起

浮窗没有关闭按钮，收起它的是**会话顶栏那个 `鲸` 按钮**（和刷新、更多在同一排工具位）：

- 点一下收起浮窗，按钮亮成淡蓝，表示「正在显示」；
- 再点一下打开，位置还是上次拖到的地方；
- 按钮上直接带百分比（`鲸 61.2%`），过半变红 —— 不点开也知道离 431 还有多远；
- 悬停显示完整信息：`46 条 · 10.2 KiB / 16.0 KiB（点击收起）`。

收起状态记在 `localStorage` 的 `dsh.cookie-meter.hidden`，刷新、重启都记得上次是开是收。
顶栏按钮走 `conversation.session.header.utilities` 插槽，外面套了 `try/catch`：宿主版本没有这个插槽时只少一个按钮，浮窗照常工作。

## 安装

```sh
# 本地开发版
dsh plugin --profile desktop add file:/path/to/dsh-cookie-meter

# 或直接从 GitHub 装
dsh plugin --profile desktop add github:<你的账号>/dsh-cookie-meter
```

装完**重启 DSH**（客户端包是懒加载的，必要时再刷新一次页面），右下角就会浮出小卡片。

> 桌面端请用 `--profile desktop`，别用 `--profile web`（Web profile 装的东西桌面端看不见）。

## 一键清理怎么工作

`Network/Cookies` 在 DSH 运行期间被桌面外壳独占打开，普通删除一定 `EBUSY`。所以按钮走的是
**「标记 → 下次进入时清空」**：

1. 点「一键清理」：先试当场删 `Cookies` / `Cookies-journal`（DSH 没占着库时立刻成功，状态行显示「已清理」）。
2. 删不掉（常态）：写一个待清理标记 `~/.dsh/cookie-meter/pending-clean.json`，按钮变绿「取消安排」，
   状态行显示「已安排，下次进入时清零」。
   - 同时挂一个脱离进程的 PowerShell 兜底脚本：等你关掉 DSH、且没有别的实例在跑时，把库删掉。
3. **下次启动 DSH**：插件启动时先看标记，有就立刻删库并记一行 `boot: pending clean applied`，
   新窗口从第 1 条 cookie 开始算（≈ 1.4%）。
4. 不想清了，就再点一次已变绿的「取消安排」，标记删掉，什么都不发生。

会话、聊天记录都在 `~/.dsh` 里，跟 cookie 库无关 —— 清 cookie 不会丢对话，也不需要重新配置。

## 数据从哪来（以及为什么不联网）

运行中读不到 `Network/Cookies`（独占锁），所以移植了 [dsh-cookie-guard](https://github.com/3150481853/dsh-cookie-guard)
（MIT）的句柄借读法：

`CreateToolhelp32Snapshot` 找到 DSH 进程 → `NtQuerySystemInformation` 枚举全机句柄表 →
`DuplicateHandle` 复制句柄 → 在副本上 `ReadFile` 读字节，最后正则数 `dsh-auth-<43 位>`。

koffi 直接用 DSH 自带的 `app.asar.unpacked/dsh/node_modules/koffi`，不额外拉依赖。

**只读、不联网、不解密任何 cookie 值**：插件只数「有几条、共多少字节」，cookie 内容一个字节都不会出内存。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_COOKIE_METER_DB` | 覆盖 cookie 库路径（测试用） |
| `DSH_COOKIE_METER_KOFFI` | 覆盖 koffi 路径（非 DSH 环境下跑测试用） |

## 开发与测试

三个冒烟脚本，都不需要真的开 DSH：

```sh
node scripts/smoke.mjs         # 宿主：路由 / 鉴权门禁 / 缓存 / 动作分发
node scripts/smoke-client.mjs  # 客户端：百分比、红色阈值、scheduled 态按钮文案
node scripts/smoke-boot.mjs    # 启动补清理：标记存在时删库并清标记
```

`smoke-client.mjs` 自带一个极简 React 替身和假的 `__ModuleLoader__`，纯 Node 就能跑，不用建构建链。
`smoke.mjs` 与 `smoke-client.mjs` 都用 `new URL(..., import.meta.url)` 定位入口，clone 下来在仓库根目录直接能跑；
`smoke-boot.mjs` 需要一个本地 cookie 库当样本（路径写在脚本里），跑之前改一行即可。

## 已知限制

- **仅 Windows**：借句柄用的是 `NtQuerySystemInformation`，兜底脚本是 PowerShell。
- **需要 DSH 桌面版 0.2.x**：`shell.overlay` 插槽与 `dsh.client` 加载契约。
- 有别的 DSH 实例在跑时，兜底脚本会主动跳过（防止把新实例刚拿到的登录 cookie 删掉）—— 这时就靠「下次进入时清空」那条路。
- 百分比是**估算**：按 228 字节/条算请求头占用，实际值随 cookie 名长度略有出入，用于预警足够。

## 许可证

[MIT](LICENSE) · 大肥鱼出品

本项目与 DeepSeek 官方无关，只是社区插件。
