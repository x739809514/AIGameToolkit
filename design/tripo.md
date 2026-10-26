# Tripo 3D 模型生成（0.9.0）

新增独立「3D 模型生成」工作台，支持文字和单图生成、任务历史、进度、GLB 实时预览和下载。动作编辑器继续使用本地 FBX / Y Bot 流程；Tripo 输出为独立 GLB，本轮不自动重定向到 Y Bot，也不包含自动绑骨、多视图、贴图重做或动画生成。

## 配置与使用

1. 在 Dashboard 选择「3D 模型生成」，创建工作台。
2. 打开设置，填写在 Tripo 开发者平台创建的 API Key 并保存。凭据使用现有系统加密存储，所有工作台共用，渲染页面只获得是否已配置的状态。
3. 「测试连接」调用只读积分接口，不创建生成任务。顶部 API 余额显示 Tripo 可用积分，保留控制台入口。
4. 选择文字或图片模式。文字最多 1000 字符；单图支持 PNG / JPEG / WebP，最大 20 MB。上传到 Tripo 前本地统一转换为 PNG，再校验大小。
5. 可选生成纹理和 PBR。点击生成会消耗 Tripo 积分；费用以官方实际扣费为准。
6. 完成后显示真实 GLB，可旋转、缩放和平移。通过「下载 GLB」保存到项目或其他位置；未手动保存时，结果只保留在工作台内部。

## API 契约

基址 `https://openapi.tripo3d.ai/v3`，模型固定为 `v3.1-20260211`，使用 Bearer 认证，API 请求均由 Electron 主进程执行。

| 能力 | 接口 |
| --- | --- |
| 文字生成 | `POST /generation/text-to-model` |
| 图片上传 | `POST /files`，multipart 字段 `file` |
| 图片生成 | `POST /generation/image-to-model`，`input` 使用上传返回的 `file_token` |
| 查询任务 | `GET /tasks/{task_id}` |
| 积分 / 测试连接 | `GET /account/balance` |

解析 `code: 0` 和 `data`，不会把 HTTP 200 的业务错误当成成功。任务状态覆盖 queued / running / success / failed / cancelled / banned。每个工作台最多一个进行中生成，正常每两秒查询，查询失败退避；本地请求 ID 去重。

## 保存与恢复

任务、源输入快照、草稿、选择和消耗积分按工作台保存到 SQLite。已取得远程 ID 的进行中任务在重启后恢复查询；提交阶段响应丢失或未取得 ID 的任务不会自动重发。状态不确定时提示先在 Tripo 控制台核实，避免重复收费。

官方说明结果链接有效期较短，成功后立即流式下载，限制 150 MB，并检查 GLB v2 文件头和 JSON 结构。下载不发送 API Key。下载失败保留远程任务 ID；「重试保存」重新查询新链接，不再次生成。

预览从受限 IPC 读取本地 GLB，支持嵌入纹理及本地 Draco 解码；不加载 GLB 引用的外部资源。关闭或删除工作台时停止本地查询和处理，防止迟到结果写入已删除目录；已提交的远程任务可能继续运行或计费。

## 验证

`npm test` 包含 v3 请求契约、multipart 上传、业务错误、响应丢失、请求去重、重启恢复、下载重试、凭据隔离、积分缓存、GLB 校验及删除保护。

`node_modules/.bin/electron scripts/tripo-smoke.cjs` 使用隔离数据和固定响应验证模板、设置、非生成式连接检查、文字与图片生成、真实 WebGL 预览、下载取消与保存、积分显示。设置 `TRIPO_TEST_PACKAGED=1` 可针对打包资源运行。报告和截图位于 `output/tripo-review`。

未使用真实账号执行收费生成，实际账号权限、积分扣费与模型质量仍需用户配置 Key 后验证。

接口依据：[Quick Start](https://developers.tripo3d.ai/en/docs/quick-start)、[File Upload](https://developers.tripo3d.ai/en/docs/files)、[Task Query](https://developers.tripo3d.ai/en/docs/task-query)、[Account](https://developers.tripo3d.ai/en/docs/account)。
