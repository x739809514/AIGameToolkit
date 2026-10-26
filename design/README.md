# AI Assets Toolkit 设计文档

- [UI 布局编辑器](./ui-layout.md)：0.10.0 新增的构件拖放、自由编辑、图层属性、JSON + PNG 导出与重新打开。

- [Tripo 3D 模型生成](./tripo.md)：0.9.0 新增的文字 / 单图生成、GLB 预览、下载与任务恢复。

把图片构思、图片生成、图片转视频放在同一个工作台中，完成从 prompt 到图片，再到视频的基本流程。

文档日期：2026-10-12。当前状态：桌面 MVP 已实现，已完成本地交付验证；真实 API 账号验证待配置凭据。

- [需求与交互设计](./requirements.md)：功能范围、界面布局、素材上传、生成流程和验收标准。
- [技术实现方案](./implementation.md)：模型分工、API 接入、数据结构、任务恢复和技术选型建议。
- [实现 TODO](./TODO.md)：按依赖顺序拆分的开发任务及阶段验收。
- [工作台架构](./workbenches.md)：Worktree 目录、多工作台层级、单主窗口切换与数据隔离。
- [图片编辑器](./image-editor.md)：独立修改窗口、圈选遮罩、裁切、去背景与验证范围。

产品形态已确定为桌面 App。首版实现采用 macOS Apple Silicon、Electron、React、TypeScript 和 SQLite。首版重点是完整跑通“生成图片 → 应用为基础图片 → MiniMax H3 生成视频”。

- [使用说明](../README.md)：打开应用、配置 API 和验证命令。
- [MVP 验证记录](./mvp-status.md)：已验证功能、交付位置和待完成事项。

- [静态图骨骼解析](./static-pose.md)：独立图片上传、OpenAI 结构化姿态估计、Hierarchy 与骨架预览。

- [动作编辑与动作库](./motion-library.md)：本地视频骨骼提取、逐帧编辑、清理、保存、组合、角色适配和视频参考。

最新第二种模板方案：[本地 3D 动作编辑器](animation-editor.md)，替代旧视频与动画帧 UI。

- [终端工作台](terminal.md)：真实 macOS zsh、独立分屏和同一会话的 Chat View。

- [2D 混合树与骨骼遮罩](motion-blend.md)：分层与 XY 混合、逐关节遮罩、独立预览和视频导出。

- [二维角色绘制台](cutout-studio.md)：拆分、补画、装配、网格蒙皮、脚底骨链、局部动作与多轮 AI 回看。
