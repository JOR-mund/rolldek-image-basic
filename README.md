# RollDek 基础生图技能

通用文生图、参考图编辑与本地原图保存，包含 Windows 模型与密钥管理界面。可按模型保存默认分辨率、画质，以及 GPT 2.6 的复杂度和 Nano Banana 2.1 的思考档位；支持模型与密钥 TXT 导入导出。

版本：1.0.1。适用于 Windows 10/11、Windows PowerShell 5.1 和 Node.js 22 或以上版本。

## 安装

下载 Release 中的 ZIP，完整解压。在解压后的技能目录打开 PowerShell：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

默认安装到 `%USERPROFILE%\.codex\skills\rolldek-image-basic`；设置了 `CODEX_HOME` 时使用其 `skills` 子目录。安装后重新开启 Codex 聊天以发现技能。

也可直接把本目录复制为 `$CODEX_HOME/skills/rolldek-image-basic`，或使用技能安装工具安装本仓库根目录。

## 配置模型与密钥

在技能安装目录运行：

```powershell
node .\scripts\rolldek.mjs configure
```

在窗口中选择模型、填写自己的 API 密钥，并保存。密钥输入框不会回填已保存的值；留空保存会保留已有密钥。支持同一模型的多个渠道和共用密钥绑定。

本包的示例配置保留了六个模型和默认参数：

| 模型 | 分辨率 | 画质或其他设置 |
| --- | --- | --- |
| GPT 2.6 Sunburst | 2K | xhigh，复杂度 high |
| GPT 2.5 Sunburst | 2K | xhigh，RollDek 官渠规则 |
| Nano Banana 2.1 | 2K | 思考档位 high |
| Seedream 5.0 | 2K | 模型自动 |
| Gemini 3 Pro Image | 2K | 模型自动 |
| Gemini 3.1 Flash Image | 2K | 模型自动 |

默认生成模型为 GPT 2.6 Sunburst。每个渠道都需要自行配置可用密钥。GPT 2.5 的官渠／非官渠规则须与自己的密钥匹配。本包没有保存任何可直接调用的凭据。

窗口按模型显示可用选项，本次生成明确指定的参数优先于已保存默认值。比例按每次任务决定。GPT 2.6 的参数依据原生 Images 协议适配到 RollDek，尚未进行该渠道的收费实测；现已接入参考图编辑、蒙版、透明背景和 PNG/JPEG/WebP 输出。其他模型的参考图能力详见 [API 说明](references/api.md)。

## 密钥与代码分离

运行时数据保存在技能目录之外：

- `$CODEX_HOME/rolldek/config.json`：本机模型配置与默认参数。
- `$CODEX_HOME/rolldek/vault.dpapi.json`：由当前 Windows 账户 DPAPI 加密的密钥库。

未设置 `CODEX_HOME` 时使用 `%USERPROFILE%\.codex`。安装只复制技能文件，不读取、不覆盖上述运行时文件。示例中的 `key_alias` 只是绑定名称，首次使用需要重新输入密钥。

仓库、发布 ZIP 和文件清单均不包含真实配置、加密密钥库、密钥 TXT、备份、生成图片或日志。`.gitignore` 排除这些文件。不要把整个 `.codex` 目录提交到本仓库。

“导出 TXT”按用户操作生成明文密钥文件；请将该文件保存在仓库目录之外。DPAPI 密钥库与 Windows 账户绑定，不能作为跨机器迁移密钥的通用文件。TXT 格式详见 [导入导出说明](references/model-keys-txt.md)。

## 使用

在 Codex 中调用 `$rolldek-image-basic`，说明模型、画面要求与张数。也可直接运行客户端：

```powershell
node .\scripts\rolldek.mjs list
node .\scripts\rolldek.mjs generate --request C:\path\request.json --dry-run
node .\scripts\rolldek.mjs generate --request C:\path\request.json
```

请求示例：

```json
{
  "profile": "gpt-image-2.6-sunburst",
  "prompt": "木桌上的红苹果，柔和棚拍光线，极简背景",
  "aspect_ratio": "3:4",
  "count": 1,
  "output_dir": "C:/path/rolldek-output"
}
```

省略分辨率、画质、复杂度时沿用所选配置的默认值。`--dry-run` 不读取密钥、不发送请求。生成失败后不会自动重发可能已计费的请求，也不会自动更换模型或渠道。默认直接保存原图，没有自动调色步骤。

## 验证

```powershell
node --test .\scripts\rolldek.test.mjs
```

测试使用模拟响应与合成测试凭据，不访问付费生图接口。`package-manifest.json` 记录发布文件的 SHA-256，安装脚本会先检查完整性。

此仓库仅包含通用 `rolldek-image-basic`，ai影棚的项目专属技能继续在该项目内管理。

## v1.0.1 修正

解除 GPT 2.6 参考图编辑的旧限制，接入蒙版与输出参数；补齐 Gemini 的 URL / Base64 参考图；修正默认分辨率对参考图比例的处理。更新不会覆盖已有密钥库和运行时配置。详细范围见 [模型能力核对记录](references/capability-audit.md)。
