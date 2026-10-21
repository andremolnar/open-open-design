# DeepSeek Harness × OpenDesign 一键安装指引

> 安全更正：本文是继承的上游安装宣传草稿，不代表本分支已批准这些分发地址或安装行为。禁止直接下载后执行、管道执行远程脚本或动态求值 PowerShell。安装前必须选择不可变版本，从独立可信来源核对安装器本身的校验和／签名，审阅脚本、下载来源、写入目录和生命周期行为，并取得用户明确批准。脚本内校验载荷不等于安装器可信。以下流程不是 Agent 的执行授权。

> 继承的运营草稿：本分支不运行上游自动发布 workflow，也不保证原下载域名属于本分支的可信分发。正式使用前必须由维护者重新确认来源、不可变版本及独立验证方式。

上游原方案使用单独的发布 workflow 和 marketing site 短链接；这些是历史背景，不是本分支当前运行的发布流程或安装授权。不要因文档中出现域名就信任其脚本。

安装计划应明确所选版本、脚本摘要／签名、验证信任根、工具链依赖及写入范围。可变的 latest 清单或同一来源提供的摘要不能单独建立可信来源。

## 对外宣发文案

### DeepSeek Harness 已接入 OpenDesign

现在，你可以在 OpenDesign 中使用 DeepSeek Harness 完成设计生成任务。

如果电脑上还没有 Node.js、pnpm 或 `dsh`，先说明缺少哪些组件，再提出需要单独批准的工具链安装计划。不得自动下载、安装或启动 API Key 配置页面。

安装过程不会修改系统级 Node.js，也不需要 `sudo` 或管理员权限；已有的兼容环境会被自动复用。

## 一键安装

### macOS / Linux

先单独获取已批准的不可变版本安装器并保存为文件；核验、审阅并获得执行批准后再单独运行。本文不提供下载即执行命令。

支持 Apple Silicon、Intel Mac，以及主流 x64/arm64 Linux 发行版。Alpine Linux 暂不支持自动安装。

### Windows PowerShell

将已批准版本的 PowerShell 安装器保存为文件，独立核验签名／校验和并审阅后再请求执行批准。不要动态求值网络响应。

### Windows CMD

下载、核验、审阅、批准和执行必须分开；不要将 curl 与 call 串成一条命令。

## 配置 DeepSeek API Key

是的，API Key 在 DeepSeek Harness 自己的 Web UI 中配置，不需要粘贴到 OpenDesign。

### 1. 打开 DeepSeek Harness Web UI

安装完成后，安装器会直接运行：

```sh
dsh web
```

终端会显示 Web UI 的访问地址，默认是：

```text
http://127.0.0.1:3080
```

如果浏览器没有自动打开，请复制终端显示的地址，在浏览器中手动访问；始终以终端实际打印的地址为准。

以后需要重新配置时，也可以在终端再次运行 `dsh web`。

### 2. 填写 API Key

首次打开 DeepSeek Harness 时，可能会依次看到：

1. “内测声明”：点击“继续”。
2. DeepSeek API Key 配置：将 Key 粘贴到输入框，点击“保存”或“应用”。

如果没有出现 API Key 弹窗，或者之前选择了稍后配置，请打开：

**设置 → 模型 → DeepSeek → API 密钥**

输入 API Key 后点击“保存”或“应用”。配置会立即生效，不需要重启 `dsh web`。

> 只粘贴 API Key 本身。不要粘贴 `DEEPSEEK_API_KEY=...`，也不要在 Key 外面添加引号。

如果还没有 API Key，请先前往 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 创建。

### 3. 确认配置成功

保存后，DeepSeek 提供方会显示为已配置，对应模型会出现在模型选择器中。如果页面提示 `MISSING_CREDENTIAL`，请回到 DeepSeek 卡片重新保存 API Key。

DeepSeek Harness 会以只写方式保存凭据：页面只能知道 Key 是否已经配置，无法重新读取或显示 Key 明文。官方说明见 [DeepSeek Harness 模型配置指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.zh.md)。

### 4. 回到 OpenDesign

1. API Key 配置完成后，可以在运行 `dsh web` 的终端按 `Ctrl+C`；日常使用 OpenDesign 时不需要让该页面常驻。
2. 回到 OpenDesign 的“本地 Agent”页面，点击“重新扫描”。
3. 选择“DeepSeek Harness”。如果出现“安装 OpenDesign 连接组件”的确认提示，确认安装即可。
4. 点击“测试”；测试通过后即可选择模型并开始生成。

## 安装器会做什么

- 检查电脑上是否已有兼容版本的 Node.js、pnpm 和 DeepSeek Harness。
- 已有环境满足要求时直接复用，不重复下载。
- 缺少环境时，在当前用户目录中安装隔离的 Node.js 和 DeepSeek Harness 工具链。
- 固定安装 OpenDesign 已验证的版本，避免自动升级造成兼容问题。
- 校验从 Node.js 官网下载的安装包 SHA-256，校验失败会停止安装。
- 为 OpenDesign 创建可发现的 `dsh` 启动入口，但不会覆盖用户已有的全局 Node.js。

## API Key 与隐私

DeepSeek API Key 在 DeepSeek Harness 自己的页面中配置和保存。OpenDesign 不要求用户把 Key 粘贴到应用内，也不会将 Key 写入 OpenDesign 的应用配置。

安装器需要联网访问 OpenDesign 下载地址、Node.js 官网和 npm registry。它不会上传项目文件或 API Key。

## 常见问题

### 已经安装过 dsh，还需要运行吗？

可以运行。安装器会先检测现有版本；Node.js、pnpm 和 dsh 都满足兼容要求时会直接复用，不会重复安装。

### 安装器会覆盖我电脑上的 Node.js 吗？

不会。自动补齐的运行环境安装在当前用户的独立工具链目录，不修改系统 Node.js，也不替换其他项目使用的版本。

### 为什么安装后终端里仍然找不到 dsh？

先重新打开一个终端窗口。OpenDesign 会扫描常见的用户级工具目录，通常不需要手动修改 PATH；如果 OpenDesign 已经打开，请回到“本地 Agent”页面点击“重新扫描”。

### dsh web 必须一直开着吗？

不需要。它主要用于首次配置模型和 API Key。配置完成后可以关闭，OpenDesign 在运行任务时会自行调用本机的 dsh。

### OpenDesign 仍然没有检测到 DeepSeek Harness 怎么办？

请依次确认：

1. 安装命令最后显示 DeepSeek Harness 已就绪。
2. 已重新启动 OpenDesign，或在“本地 Agent”页面点击“重新扫描”。
3. DeepSeek Harness 版本与 OpenDesign 当前支持版本一致。
4. 如仍无法识别，将安装器最后一屏输出和 OpenDesign 的测试提示一并反馈给支持人员。

## 适合社群直接转发的短版

DeepSeek Harness 可使用用户已安装且兼容的工具链。缺少 Node.js、pnpm 或 dsh 时先停止并说明缺口；安装必须单独核验来源并取得批准，不提供一行远程执行命令。经批准安装后，在 Harness Web UI 配置 API Key，再回到 OpenDesign 重新扫描。

API Key 由 DeepSeek Harness 自己保存，OpenDesign 不保存你的 Key。

## 运营发布前检查

- 三个下载地址均返回对应脚本，而不是 HTML 页面或 404。
- R2 上的版本化对象、SHA-256 清单和 `open-design.ai` 稳定入口已经发布。
- 用全新 macOS 用户环境完成安装、配置、OpenDesign 重新扫描和一次真实生成。
- 用 Windows PowerShell 完成同样的全链路验证。
- 用 Windows CMD 至少验证下载、PowerShell 转发和安装完成。
- 确认宣发文案中的兼容 dsh 版本与 OpenDesign 当前 release 一致。
- 删除本文顶部“运营发布状态”提示后再面向用户发布。
