---
name: rolldek-image-basic
description: 通过 RollDek 已配置模型进行通用文生图与参考图编辑，支持比例、分辨率、张数和本地保存。用于基础 RollDek 生图请求。
---

# RollDek 基础生图

使用本技能自带的 Node.js 客户端生成或编辑图片，直接保存接口返回的原图。配置与现有密钥共用用户目录 `.codex/rolldek/config.json` 和 Windows DPAPI 密钥库；无需重新输入已配置的密钥。

## 选择模型

1. 用本技能目录的绝对路径执行 `node scripts/rolldek.mjs list`，查看模型、默认配置、渠道与密钥设置状态。
2. 使用用户指定的模型和渠道；未指定模型时采用已配置的默认项并说明实际模型。同一模型有多个渠道时优先采用明确的默认项，否则询问渠道。
3. 密钥缺失或需要更换时执行 `node scripts/rolldek.mjs configure`，通过原生图形密码窗口配置。窗口支持新增、移除配置、按模型调整默认分辨率和画质，以及 TXT 批量导入导出；不显示控制台分组或比例输入。GPT2.6 另有复杂度，Nano Banana 2.1 的画质相关控制为思考档位。不要在聊天中索取密钥或回显真实密钥库。用户明确导入、导出 TXT 时，由界面在内存中处理密钥并只读写用户选定的本地文件，保留运行时 DPAPI 加密存储。格式与导入规则见 [references/model-keys-txt.md](references/model-keys-txt.md)。
4. GPT2.5 Sunburst/Flare 的渠道必须与密钥分组一致：`fixed` 为非官渠，`official` 为 RollDek 官渠。渠道未知时先在图形窗口确认。
5. 用户说“gpt2.6 s”或“GPT2.6 S”时，从 `list` 的实际配置中选择模型为 `gpt-image-2.6-sunburst` 的项；配置名称可由用户改名，不能硬编码旧名称。RollDek 分组为 `image 2.6`。文生图可指定分辨率、画质 `auto/low/medium/high/xhigh/max`、复杂度 `low/medium/high`；分辨率转为 `size`，不套用 GPT2.5 固定尺寸表。参数按官方 2.6 原生协议适配，RollDek 透传尚未收费实测；失败后不自动换档重试。当前未接入该渠道的参考图编辑。

## 生成与编辑

按用户要求保留文字、主体、比例、风格、参考图顺序和张数。编辑前查看实际参考图。读取 [references/api.md](references/api.md) 中对应模型系列的规则，按该系列填写参数。

用户未指定分辨率、画质、复杂度或思考档位时，省略对应请求字段，沿用所选配置的 `defaults`。本次请求的明确参数优先；比例由每次任务决定。选择“接口默认”会清除该项本地默认值，完整 TXT 导入导出包含这些默认参数。

把请求写入 UTF-8 JSON 文件，例如：

```json
{
  "profile": "gemini-pro",
  "prompt": "木桌上的红苹果，柔和棚拍光线，极简背景",
  "aspect_ratio": "1:1",
  "resolution": "2K",
  "count": 1
}
```

```text
node /absolute/path/to/rolldek-image-basic/scripts/rolldek.mjs generate --request /absolute/path/to/request.json --dry-run
node /absolute/path/to/rolldek-image-basic/scripts/rolldek.mjs generate --request /absolute/path/to/request.json
```

通用请求字段为 `profile`、`prompt`、`count`、`size`、`aspect_ratio`、`resolution`、`quality`、`complexity`、`thinking_level`、`references`、`image_references`、`mask`、`mask_reference`、`output_format`、`background`、`input_fidelity`、`output_compression`、`moderation`、`user`、`output_dir`、`timeout_seconds`。仅填写所选模型支持的字段；`count` 默认 1。`references` 使用本地绝对路径数组；Seedream 也支持 HTTPS / Data URL；JSON 图片引用和蒙版规则见 API 契约。

`--dry-run` 不读取密钥、不访问生图接口，仅展示脱敏的协议和请求次数。确认请求符合用户要求后执行生成。默认保存到当前工作目录的 `rolldek-output`，返回每张图片的绝对路径与 `manifest.json`。用 Markdown 图片展示结果，说明实际模型和保存位置。

## 执行边界

- 本技能只负责生成、参考图编辑与保存。原图直接交付，不增加调色、Photoshop 后处理或固定的换装、姿势流水线。
- 非官渠 GPT2.5、GPT2.6 S 和 Gemini 多张图片采用串行独立请求；失败或超时后停止，报告已保存的图片和清单，不自动重发生图 POST，也不自动换模型、密钥或分组。
- 参考图、尺寸、分辨率和质量按模型规则处理。4K 必须由模型生成参数指定。
- 客户端沿用隐藏的 Windows 系统 HTTP 客户端、系统代理和证书。凭据仅在内存和进程私有管道中流转，不写入请求文件、命令行参数或图片清单。
- `node scripts/rolldek.mjs discover` 可读取公开文档与模型目录；新增模型需要先核查接口契约。视频模型由其他工作流处理。
