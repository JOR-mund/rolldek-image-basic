# 模型能力核对与修正（v1.0.1）

检查范围为六个可配置模型，以及通用客户端、ai影棚项目入口和发布安装包之间的一致性。测试使用合成参考图、测试凭据和模拟接口响应，没有发起收费生成请求。

## 已修正的问题

| 问题 | 修正后的行为 |
| --- | --- |
| GPT 2.6 被旧客户端拦截参考图编辑，技能说明也写着仅文生图 | 本地参考图与 JSON 图片引用均走 `/v1/images/edits`；技能说明同步允许编辑 |
| GPT 2.6 将蒙版、透明背景和输出参数统一拒绝 | 按原生 Images 协议传递蒙版、背景、PNG/JPEG/WebP 格式、压缩、画质和复杂度 |
| Gemini 系列只能使用本地参考图 | 接入文档已有的 URL、Base64 与混合参考图，保留顺序 |
| GPT 2.6 默认分辨率将未指定比例的编辑改成正方形 | 读取本地或 Data URL 参考图尺寸，JPEG 考虑 EXIF 方向，按16像素取整 |
| GPT 系列对无法读取尺寸的远程参考图强制要求比例，连隐含默认值也会阻止编辑 | 隐含分辨率不再阻止编辑，使用接口自动尺寸或省略尺寸并提示；明确要求固定分辨率时仍需给出比例或像素尺寸 |
| ai影棚保留旧版协议、配置模板和窗口入口 | 项目协议、模型目录、新建配置和窗口统一引用通用技能，避免副本滞后 |
| 仓库与 v1.0.0 安装包仍包含旧限制 | v1.0.1 同步代码、说明、测试与文件完整性清单；旧版用户需更新安装 |

## 六个模型的能力与参数

| 模型 | 参考图编辑 | 分辨率 | 画质相关参数 |
| --- | --- | --- | --- |
| GPT 2.6 Sunburst | 本地文件、JSON URL / 文件 ID、蒙版 | 本地1K/2K/4K预设换算成像素尺寸 | quality：auto/low/medium/high/xhigh/max；complexity：low/medium/high |
| GPT 2.5 Sunburst | 本地文件、JSON URL / 文件 ID、蒙版 | 1K/2K/4K；依渠道选择固定尺寸或自定义尺寸 | quality：auto/low/medium/high/xhigh/max |
| Gemini 3 Pro Image | 本地、Data URL、HTTPS URL，合计最多14张 | 1K/2K/4K | 使用模型默认，没有独立 quality 字段 |
| Gemini 3.1 Flash Image | 本地、Data URL、HTTPS URL，合计最多14张 | 1K/2K/4K | 使用模型默认，没有独立 quality 字段 |
| Nano Banana 2.1 | 本地、Data URL、HTTPS URL，合计最多14张 | 1K/2K/4K | thinking_level：minimal/medium/high，与分辨率独立 |
| Seedream 5.0 | 本地、Data URL、HTTPS URL，最多10张 | 1K/2K | 使用模型默认，没有独立 quality 字段 |

GPT 2.6 根据官方原生协议兼容接入 RollDek；供应商目录的文本输入标签不能代表编辑功能被禁止。RollDek 对编辑及增强参数的实际接受情况仍须以接口结果为准，本次只完成离线验证，不将未实测写成禁止功能。

Seedream 的2K上限、GPT 2.5 非官渠的固定尺寸和省略 n、各模型的参考图数量与参数校验均依据具体接口说明。项目调用范围、用户移除的模型、原图交付与密钥隔离要求继续生效。

## 依据

- [OpenAI 图片编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [OpenAI GPT Image 2.6 参数](https://developers.openai.com/api/docs/guides/image-prompting?model=gpt-image-2.6)
- [RollDek GPT 2.5](https://www.rolldek.com/docs/img25.md)
- [RollDek Gemini](https://www.rolldek.com/docs/banana.md)
- [RollDek Nano Banana 2.1](https://www.rolldek.com/docs/banana-2-1.md)
- [RollDek Seedream](https://www.rolldek.com/docs/seedream.md)
