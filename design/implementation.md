# AI Assets Toolkit 技术实现方案

将工作台、素材处理、生成任务和供应商接入分开实现。界面统一管理用户操作，服务层负责模型调用与任务恢复，资产层保存输入和结果。

桌面 MVP 已按 Electron + React + TypeScript + SQLite 实现，首版面向 macOS Apple Silicon；尚未进行真实账号权限测试或调用收费生成 API。API 资料核对日期：2026-10-11。

## 1 模型分工

| 能力 | 接入方 | 本项目职责 |
| --- | --- | --- |
| 对话及需求整理 | OpenAI 或 Anthropic Claude | 理解用户输入、分析支持的素材、生成可编辑 prompt |
| 图片生成及修改 | OpenAI 图片 API | 接收 prompt 和图片参考，输出图片资产 |
| 视频生成 | MiniMax H3 | 接收视频 prompt 与符合模式的素材，输出视频任务 |

OpenAI 官方提供图片生成和编辑接口，也提供 Responses API 的图片生成工具。首版建议使用独立图片 API，便于 OpenAI 与 Claude 共用出图能力；多轮上下文由应用整理并携带选中的参考图片。[OpenAI 图片生成文档](https://developers.openai.com/api/docs/guides/image-generation)

Claude 的视觉接口支持图片理解。本项目将它用作视觉分析和 prompt 辅助，不将普通聊天回复当作已生成图片。[Claude Vision 文档](https://platform.claude.com/docs/en/build-with-claude/vision)

## 2 建议技术结构

桌面 App 采用 Electron + React + TypeScript，SQLite 保存结构化数据，本地文件目录保存媒体。选择理由是可复用界面与服务层类型，并便于本地文件处理与长任务管理；当前实现使用工作台选择页与多个独立的本地工作台实例，详见 [工作台架构](./workbenches.md)。

渲染进程只处理界面，通过受限 IPC 调用主进程服务。主进程管理 API Key、供应商请求、任务和文件。开启上下文隔离，关闭渲染进程 Node 集成，不向界面暴露任意文件读写或任意命令执行接口。

交付物为目标操作系统的桌面安装包。应用需要提供原生文件选择、保存位置管理和系统凭据存储，并明确关闭窗口与退出应用时的任务行为。首版交付 `.app`，签名、公证与正式分发仍待后续处理。

```text
React 工作台
    ↓ 受限 IPC
应用服务：会话 / 素材 / 设置 / 生成任务
    ├─ ChatProvider：OpenAI / Anthropic
    ├─ ImageProvider：OpenAI
    ├─ VideoProvider：MiniMax H3
    ├─ 素材处理：文字提取 / 缩略图 / 视频抽帧
    └─ 持久化：SQLite / 本地文件 / 系统凭据存储
```

建议模块目录：`ui/`、`services/`、`providers/`、`assets/`、`tasks/`、`storage/`、`shared/`。图片和视频使用独立会话 ID，共享同一项目的资产库。

## 3 供应商接口

| 接口 | 主要方法 | 返回内容 |
| --- | --- | --- |
| ChatProvider | validateConfig、preparePrompt | 文本、结构化创作需求、实际模型 |
| ImageProvider | validateConfig、generate、edit | 图片内容、请求 ID、用量信息 |
| VideoProvider | validateConfig、submit、query | 远程任务 ID、状态、结果地址 |
| CapabilityRegistry | getCapabilities | 输入格式、模式、参数及限制 |

供应商错误统一映射为认证、余额、权限、限流、输入不合法、内容拒绝、网络或服务端错误。保留可用于排错的请求 ID，日志不记录密钥和完整敏感附件。

模型清单使用配置维护，按需支持自定义模型 ID。能力来自版本化适配器配置和官方资料；不能假设所有供应商都提供完整的模型能力发现接口。

## 4 MiniMax H3 接入要点

官方模型 ID 为 `MiniMax-H3`。创建任务使用 `POST https://api.minimax.io/v2/video_generation`，Bearer API Key 鉴权，返回 `task_id`。输入通过 `content` 表达，基础图片映射为 `image_url` 类型并指定 `first_frame` 角色。

首版采用首帧模式和参考素材模式：前者使用基础图片，后者可使用参考图片与参考视频；两种模式的素材角色互斥。H3 支持 768P / 2K 和 4–15 秒，首帧模式输出比例跟随输入图片。约束应集中配置，发布前按官方文档复核。[MiniMax 创建视频任务](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)

使用 `GET https://api.minimax.io/v2/query/video_generation/{task_id}` 查询状态与结果。官方查询范围为最近 7 天，因此需及时保存结果与元数据；超出查询窗口不能保证恢复。[MiniMax 查询任务](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)

开发时用真实账号验证嵌套媒体字段、素材传输、模型权限和错误格式，再固定请求契约。优先验证可用的内嵌媒体方案；需要远程 URL 的素材走可控临时存储，配置访问期限和清理。供应商无法读取 `localhost`、本地路径或浏览器 `blob:` 地址。

默认采用轮询，不要求本地桌面 App 暴露公网回调服务。按官方限流要求设定轮询间隔，网络错误时退避，回到前台或重启时恢复查询。

## 5 素材处理

上传后先验证实际文件类型、大小和媒体元数据，再保存原文件和资产记录。文本/PDF 提取、缩略图与抽帧在后台执行。衍生素材保留来源资产 ID，避免失去追溯关系。

图片聊天上传的视频先抽帧，用所选视觉模型分析；相关说明应在发送前可见。视频聊天在参考模式下按能力直接传入视频，首帧模式下只能将视频用于分析后生成文字提示，或者要求切换模式。

预处理不得默默裁剪、压缩或丢弃素材。需要转换时展示影响并保留原件；参数和数量限制根据实际目标模型校验。

## 6 核心数据

| 实体 | 核心字段 |
| --- | --- |
| Project | id、name、createdAt、updatedAt |
| ProviderConfig | id、provider、endpoint、modelIds、credentialRef、capabilitiesVersion |
| Conversation | id、projectId、kind（image/video）、chatProviderId |
| Message | id、conversationId、role、text、attachmentIds、createdAt |
| Asset | id、projectId、type、path、mime、hash、dimensions、duration、sourceAssetId、sourceTaskId |
| GenerationTask | id、conversationId、provider、model、remoteTaskId、state、inputSnapshot、outputAssetIds、error、timestamps |
| VideoDraft | conversationId、prompt、mode、baseImageAssetId、referenceAssetIds、parameters |

`inputSnapshot` 固定原始 prompt、实际 prompt、素材 ID 与角色、参数和模型配置版本。凭据只存引用，不进入快照。密钥删除后，相关任务显示“需要重新配置凭据”。

图片应用到视频只更新 VideoDraft 的资产引用，不复制大文件。任务提交后修改草稿，不影响已提交任务。

## 7 任务状态与恢复

```text
draft → preparing → submitting → queued → running → saving → succeeded
                        │           │         │        └→ save_failed
                        └→ submission_unknown │
                                    └─────────┴→ failed
```

状态图为应用内部模型，供应商状态由适配器映射；图片生成可跳过排队阶段。远程返回取消时映射 `cancelled`，首版不承诺提供主动远程取消。

- 创建本地任务并持久化输入，再提交远程请求；收到远程 ID 后立即保存。
- `submission_unknown` 表示提交响应丢失，可能已创建任务。不得自动再次提交；优先利用供应商支持的查询或幂等能力对账，否则向用户明确显示状态不确定。
- 已有远程 ID 时，断网仅影响查询，恢复后继续查询原任务。
- UI 禁用重复发送，服务层再按本地请求 ID 去重；本地去重不能被当成远程幂等保证。
- 下载成功并验证文件后再进入 `succeeded`。`save_failed` 单独重试下载，不创建新任务。
- 应用启动扫描未终结任务恢复查询。后台服务退出时停止轮询，已提交的远程任务可能继续运行。
- 首版每个会话单任务并发，图片与视频可同时进行；新结果按任务关联，旧结果完成不能覆盖用户主动选中的其他历史资产。

## 8 数据保存与验证

API Key 使用系统凭据存储；不可用时回退为仅本次会话使用，不能回退到明文配置。项目数据库、导出文件和日志均不包含密钥。

资产文件以临时文件写入，完整校验后原子改名并更新数据库。远程结果地址仅作为临时来源，下载到本地后预览和导出。清理资产前检查会话、草稿和任务引用。

使用 mock 供应商验证交互和失败路径，再用实际凭据完成最小真实链路。重点测试素材角色冲突、图片交接快照、提交响应丢失、重启恢复和下载失败；不要把 mock 成功当作 API 已接通。

## 9 Worktree 与工作台（0.3.0）

本地目录按 Worktree 分组，一个 Worktree 包含多个工作台，每个工作台保留独立 SQLite、草稿、聊天与任务。右侧文件树使用当前 Worktree 根，聚合同组素材；左侧以 Worktree 树切换工作台，复用唯一主窗口。目录升级和 IPC 路由详见 [工作台架构](./workbenches.md)。
