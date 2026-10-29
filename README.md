<div align="center">

# 一键发 CLI

**把素材交给 AI，让它通过一键发帮你填入或发布**

[安装一键发](https://chromewebstore.google.com/detail/dmcejnbkknlkpcbaggoeiminccbpliaj) · [安装 CLI](#安装与连接) · [命令手册](cli/README.md) · [版本下载](https://github.com/mileson/yijianfa-cli/releases)

<img src="assets/cli-hero.png" alt="AI 通过一键发处理素材并发送到多个平台" width="100%">

</div>

一键发 CLI 为本机 AI 助手提供连接一键发浏览器插件的入口。把图片、视频和文案放在文件夹里，告诉 AI 要发布到哪些平台，它可以检查素材、填入内容，或按你的指令发布。

CLI 与插件使用同一套平台能力和当前浏览器中的登录状态。实际支持的平台与内容形式以 `yijianfa capabilities` 返回为准。

## 从素材到发布

<table>
<tr>
<td width="42%">
<h3>1. 让 AI 接入一键发</h3>
<p>安装 CLI 并连接已安装的一键发插件。AI 可以先检查连接和可用平台，再开始处理你的任务。</p>
</td>
<td width="58%"><img src="assets/ai-connect.png" alt="AI 连接一键发插件"></td>
</tr>
<tr>
<td width="42%">
<h3>2. 把发布任务交给 AI</h3>
<p>告诉 AI 素材文件夹和目标平台。你可以让它先填入，检查后自己确认，也可以明确要求发布。</p>
</td>
<td width="58%"><img src="assets/ai-publish.png" alt="一键发将内容发送到多个平台"></td>
</tr>
</table>

例如，把下面的话发给可以操作本机的 AI 助手，并换成你的文件夹路径：

> 请使用一键发 CLI，读取「你的素材文件夹路径」里的文案、图片或视频，按素材类型整理内容，依次填入小红书和抖音，等我确认后再发布。

## 安装与连接

需要 Node.js 20 或更高版本、Google Chrome，以及已安装的一键发扩展。先在目标浏览器中登录需要使用的平台账号。

```bash
npm install --global "https://github.com/mileson/yijianfa-cli/releases/download/v0.3.14/yijianfa-cli-v0.3.14.tgz"
yijianfa install-host
yijianfa bridges list
yijianfa doctor --repair --wait --timeout 30000
```

如果发现多个浏览器连接，先确定目标，再在后续命令中使用 `--bridge-id` 和 `--browser-context`。通过 `yijianfa capabilities` 查看当前连接支持的内容形式和平台。

让 AI 安装时，也可以将上面的安装步骤发给它，要求它检查连接并反馈结果。更多参数与任务格式见 [CLI 命令手册](cli/README.md)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `yijianfa --help` | 查看命令、参数和输出格式 |
| `yijianfa bridges list` | 查看在线浏览器连接 |
| `yijianfa doctor` | 检查本机连接 |
| `yijianfa capabilities` | 查看插件当前支持的能力 |
| `yijianfa prepare --input task.json` | 检查任务和素材，不打开平台页面 |
| `yijianfa fill --input task.json` | 将内容填入平台页面 |
| `yijianfa publish --yes --input task.json` | 按已确认的任务执行发布 |
| `yijianfa status` | 查看当前连接的任务状态 |

发布使用当前浏览器中已登录的账号，并沿用插件的登录、会员额度和发布结果规则。发布结果为待检查或连接中断时，先查询原任务状态，避免重复提交。

## 本机连接与素材

安装时，CLI 会为当前用户配置浏览器的 Native Messaging 连接。执行任务时，素材通过本机回环地址临时提供给插件；任务结束后不再提供。使用飞书文档能力时，需要另外安装并授权飞书 CLI。

源代码位于 [`cli/`](cli/)，MIT 许可证见 [LICENSE](LICENSE)。扩展的安装与账号使用说明可在[一键发支持页面](https://mileson.github.io/yijianfa-store-pages/support/)查看。
