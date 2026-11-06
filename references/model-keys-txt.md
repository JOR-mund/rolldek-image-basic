# TXT 模型与密钥导入导出

在配置窗口点击“导入 TXT”或“导出 TXT”，使用原生文件选择窗口指定本地路径。导入完整验证通过后才保存；运行时密钥仍使用当前 Windows 账户的 DPAPI 加密。导出文件按用户要求包含明文密钥，只能在用户明确操作时写入其选择的文件，不在聊天、日志或命令行回显密钥。

快捷格式每行一条，支持等号、制表符、逗号、竖线或空格分隔。例如：

```text
gemini-3-pro-image-preview=在此填写对应密钥
gpt-image-2.6-sunburst=在此填写对应密钥
```

已有模型唯一对应一个配置时更新该配置并保留渠道、默认参数与密钥绑定；共用绑定的模型会一起使用更新后的密钥。一个模型有多个渠道时，使用完整格式指定配置名称。新增 GPT2.5 Sunburst 配置需要完整格式明确 `channel_mode` 为 `fixed` 或 `official`。

完整格式由导出生成，是 UTF-8、制表符分隔的带引号表格，包含 `profile`、`model`、`key`、`key_alias`、`channel_mode`、`is_default`、`defaults` 列。可保留默认配置、共享密钥绑定及默认生成参数。`key` 为空时保留已保存的对应密钥，允许未配置密钥的模型记录往返导入导出。

`defaults` 列使用 JSON 对象，例如 GPT2.6 Sunburst 的 `{"resolution":"2K","quality":"xhigh","complexity":"high"}`，或 Nano Banana 2.1 的 `{"resolution":"2K","thinking_level":"high"}`。也可在窗口内调整；选择“接口默认”清除对应默认值。本次生成参数优先于已保存默认值。

导入采用合并方式，同名配置更新、其他配置保留。重复配置名、同一绑定使用不同密钥、多个默认项或不支持的模型会整批拒绝；不会部分写入。
