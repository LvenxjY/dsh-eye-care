# dsh-eye-care · 护眼提醒

一个 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) Web UI 插件：每隔一段时间提醒你抬头看远处 20 秒，缓解长时间盯屏造成的眼部疲劳。

> An eye-care reminder bundle for DeepSeek Harness: prompts you at a configurable interval to look into the distance for 20 seconds. Smooth progress ring, four accent colors, one General settings row.

## 功能

- **定时提醒**：到点弹出一张休息卡片，倒计时 20 秒，提示「看 6 米（20 英尺）外」。
- **丝滑进度环**：卡片左侧圆环由 `requestAnimationFrame` 逐帧驱动，连续扫过而不是每秒跳一格；系统开启「减少动态效果」时自动退回每秒刷新。
- **任意间隔**：默认 20 分钟，可填 1–240 之间的任意整数分钟。
- **提示颜色**：跟随主题、护眼浅绿、天蓝色、红色四选一。
- **顶部悬浮卡片**：提醒出现在对话区上方居中，不遮挡输入框；按 `Esc` 或点「稍后 5 分钟」可以推迟。
- **输入框倒计时胶囊**：在输入框下方显示实时剩余时间，点一下即可暂停 / 恢复全部提醒。
- **只在可见时计时**：页面切到后台时计时暂停，不把离开屏幕的时间算作用眼时间。
- **中英双语**：文案跟随 Harness 的语言设置；未注册时按浏览器语言回退。
- **主题一致**：结构色取自 `--dsw-alias-*` 主题变量，浅色 / 深色主题都能正常显示。

## 安装

面向 DeepSeek Harness 桌面版（Web UI）。

1. 打开左侧边栏的 **Plugins**
2. 点 **Add plugin**
3. 在包名输入框里粘贴这一行（已锁定到发布版本，后续推送不会改变你装到的代码）：

   ```
   github:LvenxjY/dsh-eye-care#7453c79ce01f69db032743e410b92ffe30d1d5f1
   ```

4. 点 **Install**，等待安装完成

插件是纯 JavaScript，**没有构建步骤**，所以不会弹出任何"是否允许运行安装脚本"的确认。

> 如果提示 **Cannot access GitHub**：说明当前网络连不上 GitHub。界面会提供 **Use mainland China mirror**，但镜像只能加速 npm 依赖，**无法替代 GitHub 仓库本身**——本插件直接来自 GitHub。遇到这个提示需要换用能访问 GitHub 的网络环境。

### 安装后没反应？

插件装好后应当立即生效。如果侧边栏没有变化，依次检查：

1. **Plugins** 页面里是否出现了 `dsh-eye-care`，开关是否为开
2. 刷新一次页面（`Ctrl+R`）
3. 打开 `设置 → 通用`，确认有"护眼提醒"这一行

### 版本要求

需要 DeepSeek Harness `0.2.1-rc.2` 或更高（且低于 `0.3.0`）。低版本会在安装时被拒绝，并提示版本不兼容。

## 使用

装好后立即生效，无需重启。提醒默认开启、间隔 20 分钟、颜色跟随主题。

`设置 → 通用 → 护眼提醒` 一行里有三个控件：

| 控件 | 说明 |
| --- | --- |
| 数字框 | 直接输入分钟数（1–240）。失焦或按回车生效，按 `Esc` 撤销；超出范围自动夹到边界 |
| 四个圆点 | 提示颜色：跟随主题 / 护眼浅绿 / 天蓝色 / 红色，点一下立即换色 |
| 开关 | 启用或停用全部提醒；关闭时数字框和色点变灰不可改 |

其他操作：点输入框下方的「护眼 19:58」胶囊可快速暂停；在提醒卡片上点「稍后 5 分钟」或按 `Esc` 可跳过这一次。

偏好保存在浏览器 `localStorage` 的 `dsh-eye-care.settings.v1` 键下，按浏览器独立生效。

## 卸载

**Plugins** → 找到 `dsh-eye-care` → **Remove**。

偏好设置独立于插件存在，卸载后会留在浏览器里；想彻底清干净，在开发者工具的 Console 里执行：

```js
localStorage.removeItem('dsh-eye-care.settings.v1')
```

## 兼容性

`engines.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0-0`。DSH 在安装和启动时检查这个范围，版本不匹配会拒绝加载。

插件用到三个 slot：`shell.overlay`、`conversation.composer.dock`、`settings.general.item`。它们由 DSH 的 Web bundle 声明；缺少时插件不会强行改写其他 UI。

## 结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | 清单：`dsh.bundle.patch` 指向 patch，`dsh.client` 声明 Web 端 bundle |
| `cordis.patch.yml` | 插入一个 Host 行，挂载本包 |
| `index.js` | Host 半区，空实现（插件完全在浏览器端） |
| `client.js` | 浏览器半区：计时 store + 三个插槽组件 |
| `locale/{en,zh}.json` | 插件管理器展示用的标题与描述 |
| `icon.svg` | 插件图标 |

## 许可证

[MIT](LICENSE)
