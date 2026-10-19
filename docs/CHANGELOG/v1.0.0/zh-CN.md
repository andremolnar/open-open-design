---
title: "OpenDesign 分支 1.0.0 — 本地优先的新起点"
description: "本分支首个独立版本汇总免强制登录的本地入口、OpenCode V2、关联代码库与原会话设计工作流、ComfyUI 图像生成、预览返回导航，以及显式的手动验证与发布。"
---

# 本分支首个版本 — 准备中

**1.0.0 是本分支独立产品版本序列的起点。** 本次汇总从上游提交
[`5b19dfa4351b3eed33826ee72746a7c653c23a54`](https://github.com/nexu-io/open-design/commit/5b19dfa4351b3eed33826ee72746a7c653c23a54)
之后本分支完成的全部工作，而不只是最近一次界面增强。这不是上游
OpenDesign 的版本，不代表已达到生产就绪状态，也不表示已发布安装包。
只有在获准实际发布后才记录发布日期。

继承的产品版本为 `0.23.1`。原有 `0.x` 版本号、发布说明、链接与贡献者署名
保留在[分支前的历史记录](../../../CHANGELOG.md#pre-fork-history--original-opendesign)
和原有版本目录中。演讲者备注滚动与移除官方 Nix 维护等既有条目属于上游历史，
不是本分支新增成果。

## 新增

- **关联现有代码库：** 通过项目菜单或 `od` 将设计项目关联到本地仓库及可选的嵌套应用。关联在重启后保留，显示源不可用状态，并允许重新关联；不会移动设计文件或修改源代码。([PR #2](https://github.com/andremolnar/open-open-design/pull/2))
- **只读代码上下文：** 生成时可使用有边界的项目指令、相关组件与设计令牌。MCP 和 CLI 可按精确的源目录或应用目录定位项目并检查已验证上下文；关联缺失、移动或有歧义时必须显式选择。关联本身不运行代码、不安装依赖、不修改源仓库，产物仍保存在 OpenDesign。([PR #3](https://github.com/andremolnar/open-open-design/pull/3))
- **留在当前编码会话工作：** 从调用方实际当前目录发现获授权的项目或应用关联，准备设计指导与原始图像资源，跨重启跟踪进度，并通过 MCP、`od project discover-context` 或 `od project work-here` 登记设计成果，无需再启动一次 OpenDesign 生成。([PR #5](https://github.com/andremolnar/open-open-design/pull/5)、[PR #6](https://github.com/andremolnar/open-open-design/pull/6))
- **OpenCode MCP 配置：** 设置页提供可复制的全局配置；文档补充后台任务、协作数据流、代码库上下文、原会话工作和图像附件说明。([PR #4](https://github.com/andremolnar/open-open-design/pull/4))
- **ComfyUI 本地图像工作流：** 在“设置 → 媒体提供商 → ComfyUI”管理服务器和由 OpenDesign 持有的命名 API 工作流。导入或粘贴图、消除提示词字段歧义、选择 PreviewImage/SaveImage 输出，并启用不可变的 `comfyui/<workflow-id>@<version>` 模型。界面与 `od media comfyui` / `od media generate` 均可将图像导入请求项目；已记录的提交可以恢复而无需再次提交 GPU 作业。([PR #9](https://github.com/andremolnar/open-open-design/pull/9))
- **预览内返回：** HTML 预览工具栏新增 Go Back，可返回已知的 SPA/hash 页面或关联 HTML 原型文件，支持 URL 加载和内联模式。没有已知预览历史时按钮禁用，原有 Return to document 保留。([#12](https://github.com/andremolnar/open-open-design/issues/12)、[PR #13](https://github.com/andremolnar/open-open-design/pull/13))
- **手动 macOS 交付与限定范围的提交流程：** 签名构建可免安装启动；`pnpm tools-pack mac deploy` 在替换前验证签名与已安装应用身份。`/shipit` 只针对已确认的工作记录、验证、提交并提出 PR。([PR #1](https://github.com/andremolnar/open-open-design/pull/1)、[提交 644b0134f](https://github.com/andremolnar/open-open-design/commit/644b0134f))

## 变更

- **本地首页不再强制 Cloud 登录：** 新老用户、过期会话、旧版未完成的设置标记和旧引导链接均可进入 Home。退出登录后本地项目与设置仍可访问；新安装默认选择可用的本地代理，而不是未登录的 Cloud 代理。
- **默认不自动回传产品数据：** 独立构建关闭产品分析、会话回放、追踪、自动崩溃及启动诊断，以及默认的上游更新、推广和更新亮点检查。显式账号、提供商及诊断导出操作仍可使用；可选的托管集成不被宣称为离线功能。
- **ComfyUI 类型化默认值：** 新版本允许按需覆盖提示词、种子、尺寸、其他数值与布尔值，省略时保留已存默认值。发现接口提供稳定字段键、默认值、节点身份与类型、语义角色及提示词使用信息，但不暴露图、凭证或只读值。不明确的字符串、模型/文件/枚举选择、连线、结构化值和批量输出控制保持只读。旧的已发布版本继续使用必填语义，需编辑、保存并启用新版本后才采用默认值模式。
- **显式选择 ComfyUI 执行方式：** 请求级服务器覆盖优先，其次为工作流的可选偏好，再其次为唯一已存服务器；否则询问用户。工作流不永久绑定服务器。逐服务器测试连接，单独新增服务器；种子和尺寸变体以唯一请求 ID 顺序执行；恢复保留原服务器与提示词身份。移除仅在设置页生成的测试及其目标项目选择器。
- **区分当前会话创作与委派生成：** 已有编码会话保存预览无需 Cloud 登录；委派生成是另一种选择，可以使用可用的本地 CLI。
- **独立维护与版本策略：** 贡献、翻译、隐私和部署入口明确本分支及其唯一维护者。产品版本从 1.0.0 开始，后续用户可见交付遵循 SemVer；独立版本库及第三方代码保留自己的版本。

## 修复

- **OpenCode V2 兼容性：** 会话启动与恢复、模型及变体、权限、MCP、工具事件与预览、BYOK 配置采用 V2 兼容结构；所选图像以文件附件传入，而非只在文本中传路径。([PR #1](https://github.com/andremolnar/open-open-design/pull/1)、[PR #5](https://github.com/andremolnar/open-open-design/pull/5))
- **精确保留模型名称：** 提供商命名空间、别名及含空格名称在发现、选择、自定义 ID、连接测试和生成中保持一致。无效的显式选择直接报错，不再静默回退到 CLI 默认模型。([#10](https://github.com/andremolnar/open-open-design/issues/10)、[PR #11](https://github.com/andremolnar/open-open-design/pull/11))
- **MCP 更新与空闲稳定性：** 打包注册通过稳定的已安装应用路径启动，并在套接字变化后重新发现守护进程。OpenCode MCP 连接不再因空闲 30 分钟到期，资源模板列表不再触发协议错误。([PR #4](https://github.com/andremolnar/open-open-design/pull/4))
- **恢复的本地项目保持本地：** 显式恢复的 Personal 项目在退出登录后仍可访问，不会被后续工作区读取静默认领；文件与资源位置不变。
- **返回已保存文档：** 在预览内跟随链接后，可通过工具栏或设计文件缩略图重新打开原文档，无需离开项目。
- **ComfyUI 错误提供下一步：** 图导入后填充编辑器，Save 说明缺少的设置，取消新增服务器保留未保存字段。裸 `comfyui` 请求列出已启用的版本化工作流。代理指导保留工作流尺寸、区分不支持选项，并避免将所有配置错误误判为缺少 API 密钥。([PR #9](https://github.com/andremolnar/open-open-design/pull/9))

## 移除

- 仓库自带的 GitHub Actions 验证、发布、定时刷新和 PR 自动化。维护者显式运行检查与发布工具；推送或合并本身不会发布任何内容。
- 将上游专用贡献流程、路线图、治理或计划视为本分支现行政策的表述。原作者与贡献者的历史署名保留。

## 限制与发布状态

- ComfyUI 仍为实验性的纯图像功能：每个作业只导入一张标准 PNG；不支持参考图上传、视频/音频、多输出或非 PNG 导入、重启自动协调、兼容性自动路由或盲目重试。协议夹具测试不等于真实推理验证；真实 GPU 生成及导入发起项目尚未验证。
- 预览返回遇到有歧义的历史遍历会重置安全基线。跨文件返回重新打开已存内容，不恢复旧的内存 DOM/SPA 状态；临时文件历史最多 64 次跳转，离开当前项目/文件链后清空。
- 可选托管集成仍然存在。自带云服务、自带协作后端、完整离线或企业认证使用仍是目标，不是 1.0.0 的保证。
- 本次源代码更新不发布 Git 标签、安装包、更新源或托管的 What's New 文档，也不宣称完成新的桌面打包验收或真实 GPU 验收。

完整累计记录见[根更新日志](../../../CHANGELOG.md#fork-release-history)，
本分支方向见 [README](../../../README.md)。
