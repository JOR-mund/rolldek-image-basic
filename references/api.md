# RollDek 图片 API 契约

分辨率与画质参数复核日期：2026-11-05。以 RollDek 文档为准，模型名为 RollDek 网关标识。来源：[目录](https://www.rolldek.com/docs/_sidebar.md)、[GPT2](https://www.rolldek.com/docs/img2.md)、[GPT2.5](https://www.rolldek.com/docs/img25.md)、[Seedream](https://www.rolldek.com/docs/seedream.md)、[Gemini](https://www.rolldek.com/docs/banana.md)。

## 本地默认参数

配置窗口按模型保存 `defaults.resolution`、`defaults.quality`，GPT2.6 另有 `defaults.complexity`，Nano Banana 2.1 使用 `defaults.thinking_level`。界面不设置比例。选择“接口默认”不保存该字段；本次请求的同名字段优先，显式像素 `size` 优先于配置中的分辨率。Seedream 的 `size` 是比例，仍保留独立的默认分辨率。

GPT2.5 的 `resolution` 是客户端预设，转为文档像素表中的 `size`，不向 API 发送 `resolution`。本次未指定比例时，有本地或 Data URL 参考图则读取第一张图的宽高，JPEG 考虑 EXIF 方向，无参考图则用正方形；非官渠选择最接近的受支持比例并报告差异。官渠可将非表内比例换算成满足其约束的16倍数尺寸。远程 JSON 参考图无法读取尺寸时，隐含的默认分辨率不再阻止编辑：官渠传 `size:auto`，非官渠省略尺寸，并给出提示；本次明确要求固定分辨率时需指定 `aspect_ratio` 或 `size`。这些换算是客户端行为。

## GPT Image 2

`gpt-image-2`、`gpt-image-2-high`：JSON POST `/v1/images/generations`；有参考图时 multipart POST `/v1/images/edits`。`Authorization: Bearer KEY`。

- `size` 是像素 WIDTHxHEIGHT，支持1K/2K/4K或auto。文档没有完整像素白名单，不随意推算未列出的尺寸。编辑省略尺寸沿用参考图。
- 基础型号固定medium；high型号支持medium/high，默认high。
- `n` 1–10；`response_format` url或b64_json。客户端默认b64_json。
- 编辑本地图片 PNG/JPEG/WebP，最多16张，重复 `image[]`，保留顺序。
- `background` 接受但不生效，不承诺真实透明通道；蒙版未在此页文档化。
- 返回 `data[].url` 或 `data[].b64_json`；URL是滚动存储，及时保存。

## GPT Image 2.5

同样使用 Images API 路由。基础 `gpt-image-2.5` 仅1K、完全省略quality。Sunburst/Flare支持1K/2K/4K，质量low/medium/high/xhigh/max/auto。最长提示词32000字符。

**分组依密钥选择，不依模型名推断：**

- 非官渠fixed：只能用下表固定像素值；所有请求完全省略n（包括n=1），多张需独立提交。
- 官渠official：仅Sunburst/Flare，支持n 1–10，尺寸auto或宽高均为16的倍数、比例1:3～3:1、最大3840×2160；大于2560×1440为实验分辨率。文档未明确“最大”对竖屏按轴还是面积约束；客户端采用面积上限及最长边3840校验，最终接受范围由服务端决定。

| 比例 | 1K | 2K | 4K |
| --- | --- | --- | --- |
| 3:1 | 1536x512 | 3072x1024 | 3840x1280 |
| 21:9 | 1344x576 | 2688x1152 | 3840x1648 |
| 16:9 | 1280x720 | 2048x1152 | 3840x2160 |
| 3:2 | 1152x768 | 2304x1536 | 3520x2352 |
| 4:3 | 1024x768 | 2048x1536 | 3312x2480 |
| 1:1 | 1024x1024 | 2048x2048 | 2880x2880 |
| 3:4 | 768x1024 | 1536x2048 | 2480x3312 |
| 2:3 | 768x1152 | 1536x2304 | 2352x3520 |
| 9:16 | 720x1280 | 1152x2048 | 2160x3840 |
| 1:3 | 512x1536 | 1024x3072 | 1280x3840 |

Sunburst/Flare省略response_format，响应为data[].b64_json。output_format为png/jpeg/webp；background为transparent/opaque/auto，透明须PNG/WebP；JPEG/WebP的output_compression为0–100；moderation为auto/low；可传user。

编辑：multipart的image[]或JSON的images（对象数组，每项image_url/file_id二选一），最多16张。蒙版使用multipart的mask或JSON的mask引用对象；input_fidelity为high/low。基础2.5的页面没有单独明确编辑参考图上限与蒙版能力；客户端允许普通multipart编辑，采用16张上限，不开放蒙版/透明等增强字段。

## GPT Image 2.6 Sunburst

2026-11-05 核查 [RollDek 公开模型目录](https://rolldek.com/api/pricing)：`gpt-image-2.6-sunburst` 的输入为文本、输出为图片，说明为“支持同步 Images 接口”，端点类型 `image-generation` 映射到 JSON POST `/v1/images/generations`。分组 ID 为 `grp_c8b82c5cc886342e68a428ea2eeef1d7`，显示名称为 `image 2.6`。

RollDek 模型详情的公共图像参数面板列出了 `size` 和 `quality`，但该面板共用旧版图片参数模板，`standard/hd` 不适用于 GPT2.6。本适配器依据 [OpenAI 的 2.6 参数说明](https://developers.openai.com/api/docs/guides/image-prompting?model=gpt-image-2.6) 与 [生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate) 开放原生字段，不再限制为只有提示词。RollDek 对这些原生参数的透传属于兼容适配，尚未用用户密钥收费实测。

- `quality`：`auto/low/medium/high/xhigh/max`。
- `complexity`：`low/medium/high`，与渲染画质独立；省略时使用接口默认。
- `size`：`auto` 或正整数 `WIDTHxHEIGHT`，宽高为16的倍数，比例1:3～3:1。这里不把 GPT2.5 的固定尺寸表或上限当成2.6的契约。
- 本地 `resolution` 预设为 `1K/2K/4K`，长边分别以1024/2048/4096为目标，保持本次比例与16像素步长；这是本地尺寸策略，最终接受范围由渠道决定。例如2K的3:4为1536x2048，2:3为1344x2016。未指定比例的编辑会读取第一张本地或 Data URL 参考图的方向与尺寸，并按16像素取整，不会一律改成方图。远程图片无法读取尺寸时，隐含默认分辨率使用 `size:auto` 并提示；本次明确要求固定分辨率时需指定比例或像素尺寸。无参考图的文生图未指定比例时采用正方形。

配置名以本地 `list` 结果为准。示例中的 `profile` 须替换成实际配置名称：

```json
{"profile":"gpt-image-2.6-sunburst","prompt":"木桌上的红苹果，柔和棚拍光线","resolution":"2K","quality":"xhigh","complexity":"high","count":1}
```

客户端每张图片独立提交，不发送 `n` 或 `response_format`；按标准 Images 响应提取 `data[].b64_json` 或 `data[].url` 并保存。目录说明按次计费；不要因超时自动重发。

参考图编辑依据 [官方编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit) 兼容接入：本地文件 multipart POST `/v1/images/edits`，单图用 `image`、多图用 `image[]`；JSON 用 `image_references` 映射成 `images`，每项 `image_url` / `file_id` 二选一，最多16张。蒙版分别用本地 `mask` 或 JSON `mask_reference`；可设置 `background`、PNG/JPEG/WebP `output_format`、JPEG/WebP `output_compression`、`moderation` 和 `user`。2.6 不传旧版 `input_fidelity`。RollDek 透传尚未收费实测，这不构成客户端禁止编辑的理由。`channel_mode` 不用于本模型尺寸选择。没有填写默认参数时省略对应字段；不要复制官方直连技能的密钥或更换 API 地址。

## Seedream 5.0 Pro

模型ID seedream-5.0，API Key必须为seedream分组。JSON POST /v1/images/generations，Bearer密钥。参考图也使用此路由。

- resolution小写1k/2k，默认1k。
- size是比例，默认auto：1:1、3:2、2:3、4:3、3:4、5:4、4:5、16:9、9:16、2:1、1:2、3:1、1:3、21:9、9:21。
- 一张图用image字符串，多张用images字符串数组，两种不能同时传；HTTPS URL或完整Data URL。本地文件转换为Data URL。
- 最多10张参考图，建议不超过4张。n为1–4。
- 返回data[].url，及时下载；排查保留X-Oneapi-Request-Id。

## Gemini 香蕉系列

gemini-3-pro-image-preview、gemini-3.1-flash-image-preview：JSON POST /v1beta/models/{model}:generateContent，x-goog-api-key: KEY（也兼容Bearer）。

文本：contents=[{role:"user",parts:[{text:PROMPT}]}]。参考图按顺序增加 `inlineData:{mimeType,data}` 或 `fileData:{mimeType,fileUri}` part，两种合计最多14张。`references` 支持本地绝对路径、完整 Data URL、带 `.png/.jpg/.jpeg/.webp` 扩展名的 HTTPS URL。无扩展名的 HTTPS 图片用 `{"url":"https://...","mime_type":"image/png"}`，可与本地图片混用；客户端不下载 URL 图片，而由接口读取。

generationConfig.responseModalities=["IMAGE"]，比例及分辨率在 **generationConfig.responseFormat.image** 下，分别为aspectRatio和大写imageSize 1K/2K/4K。不要替换成其他Gemini实现常见的imageConfig。

通用比例：1:1、16:9、9:16、4:3、3:4、3:2、2:3、5:4、4:5、21:9。仅Flash支持8:1、4:1、1:4、1:8。让模型决定比例时省略aspectRatio。没有文档化的多图参数，客户端串行独立请求生成多张。

输出位于candidates[].content.parts[].inlineData。跳过thought:true，根据MIME保存PNG/JPEG/WebP。无图片时检查finishReason/promptFeedback，不将思考图或文本当作成功。

## Nano Banana 2.1

2026-10-20 核查：[官方接口文档](https://www.rolldek.com/docs/banana-2-1.md)。模型 ID `gemini-nano-banana-2.1`，使用上述 Gemini 原生 `generateContent` 路由、鉴权、参考图与响应协议，最多14张参考图。支持1K/2K/4K和香蕉 Flash 的扩展比例。

请求可用 `thinking_level` 指定 `minimal` / `medium` / `high`，映射到 `generationConfig.thinkingConfig.thinkingLevel`；省略时服务端默认 medium。此参数独立于分辨率，仅在2.1的已核查契约开放，不能把 `quality:high` 套用过来。high 可能延长等待时间。公开目录列出的分组为 default、香蕉；密钥真实分组由控制台决定。

## 发现与边界

[公开模型目录](https://rolldek.com/api/pricing) 能发现模型与可用分组，不能作为完整请求schema。supported_endpoint_types将部分图片/视频型号标为openai，公开endpoint映射只显示chat/completions；图片路由应采用具体文档。

gpt-image-2-official只在首页公告提及；Gemini无preview别名只出现在公开目录。它们可先配置密钥，保持documented=false直到有接口契约。

新分组：新增同一模型的配置并绑定密钥。新模型：核查契约与既有family完全一致后新增catalog条目。新协议：修改buildPlan/extractImages并加入模拟测试。未来未知渠道不能声称已验证支持。
