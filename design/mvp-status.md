# 桌面 MVP 验证记录

版本 0.7.0，记录日期 2026-10-13。当前交付为 macOS Apple Silicon 本地测试版，代码、桌面工作台、供应商适配已实现；真实收费生成待配置账号凭据验证。

## 交付物

- 桌面应用：`release/mac-arm64/AI Assets Toolkit.app`。
- 使用说明：[README](../README.md)。
- 桌面截图：[空工作台](../output/mvp-review/desktop-empty.png)、[API 设置](../output/mvp-review/desktop-settings.png)、[图片应用到视频](../output/mvp-review/desktop-image-to-video.png)、[素材预览与播放](../output/mvp-review/desktop-complete.png)。
- 运行报告：[桌面交互](../output/mvp-review/desktop-smoke.json)、[打包后运行](../output/mvp-review/packaged-smoke.json)。

## 已实现功能

| 功能 | 当前行为 |
| --- | --- |
| Worktree | 左侧树包含多个工作台；每组对应右侧本地目录，同组素材可复制复用 |
| 桌面工作台 | 左侧上下聊天、中间图片、右侧视频；支持浅色与深色外观和素材侧栏 |
| 设置 | 独立配置 OpenAI、Claude、MiniMax 的凭据与模型；支持保存、替换、删除和非生成式连接测试 |
| 凭据存储 | 使用系统 `safeStorage` 加密；系统加密不可用时仅会话保存 |
| 图片编辑器 | 独立窗口；画笔与自由圈选、Prompt 局部修改、本机裁切、API 去背景、结果同步与原图保留 |
| 图片生成 | OpenAI 图片生成与编辑，支持选定当前预览图片继续修改 |
| 聊天辅助 | OpenAI 或 Claude 整理 prompt、分析图片与关键帧，以及仅讨论模式 |
| 素材上传 | 原生选择、拖放和图片粘贴；支持图片、视频和约定文档格式 |
| 图片交接 | 应用为视频首帧，保留视频草稿，支持移除和替换撤销 |
| 视频生成 | MiniMax H3 / H3 Max 首帧模式与参考素材模式，校验角色、编码、尺寸和时长 |
| 素材传输 | Base64 请求体大小校验；MOV 转 MP4 容器，保留原件 |
| 预览与导出 | 图片缩放、历史选择；视频实际播放、进度定位及系统保存对话框 |
| 数据持久化 | SQLite 记录与本地媒体文件；两个会话草稿和历史独立 |
| 任务恢复 | 保存远程 ID，重启继续查询；不自动重新提交状态不确定的收费请求 |
| 下载恢复 | 保存失败可单独重试，不重新创建视频生成任务 |

## 当前模型配置

图片默认为 `gpt-image-2.5-sunburst`，OpenAI 聊天默认为 `gpt-6.1-sol`，推理强度默认 `medium`，推理模式默认 `standard`。支持在设置中修改模型与推理参数；旧的默认配置迁移一次，历史任务快照保持原始模型参数。GPT-6.1 Sol 的请求通过 Responses API 发送，显式选择旧聊天模型时保留 Chat Completions 兼容路径。相关接口依据：[模型文档](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[推理参数文档](https://developers.openai.com/api/docs/guides/reasoning)、[图片生成文档](https://developers.openai.com/api/docs/guides/image-generation)。

## 验证方式

`npm run build` 完成 TypeScript 检查、前端构建和主进程构建。

`npm test` 覆盖核心测试：H3 请求与角色约束、文件真实性校验、SQLite 持久化、任务快照与去重、真实本地图片到视频、重启恢复、提交响应丢失、下载重试、OpenAI/Claude 多模态请求、图片二进制编辑和媒体 Range 读取，以及默认模型迁移与推理参数。供应商请求使用隔离的测试响应，未消耗真实模型额度。

`npm run test:desktop` 在真实 Electron 窗口中验证两组聊天、三个供应商设置、缺少 API 凭据时阻止生成、测试素材导入、图片应用、草稿保留、视频实际播放、文档提取和 SQLite 保存，并产生截图。视频测试会将测试窗口置于前台，避免系统对后台媒体的暂停影响检查。

`npm run package` 生成 `.app`。`npm run test:package` 直接运行这个打包后的应用，使用外部测试目录中的素材验证内置媒体工具、素材路径、SQLite 和实际播放，测试素材不包含在应用中。

## 待完成与边界

- 尚未使用真实 OpenAI、Claude、MiniMax 凭据验证模型权限、余额及收费生成效果。连接测试成功只能说明凭据可访问对应查询接口。
- 当前支持多个独立本地工作台实例；分隔线拖动、自选工作台数据目录和云同步尚未实现。
- 视频分析仅使用三张关键帧；不含音轨识别。扫描 PDF 无文字时会提示，不包含 OCR。
- 当前视频素材在首帧模式下要求切换参考模式；没有提供首帧模式中仅分析视频的单独开关。
- 尚未进行 Developer ID 签名、Apple 公证和正式分发。其他操作系统没有打包验证。
- 下载重试使用已保存的结果地址；供应商地址过期时可能需要后续补充结果地址刷新。
- 尚未将收费生成全场景验收标记为完成；对应任务保留在 [TODO](./TODO.md)。

正式使用前，在设置中填写自己的 API Key，先做一次图片生成，再进行一次最短时长的图生视频验证。

## 0.1.2 更新

按用户要求移除模拟生成模式、示例入口、相关 IPC 和内置素材。生成操作始终调用供应商 API，缺少凭据时直接报错；浏览器界面预览不能生成素材。旧测试记录保留标识，新任务没有模拟开关。核心生成回归测试通过隔离 HTTP 响应验证；桌面检查通过导入外部测试素材验证预览和播放，没有调用收费 API。


## 0.1.3 更新

图片预览区域新增修改工具。编辑器提供画笔与自由圈选、选区撤销和重做、Prompt 局部修改、裁切与去背景。裁切不访问 API；局部修改通过 Images edits 上传标准 PNG 与同尺寸遮罩，返回后仅合成选区内像素；去背景请求透明 PNG，并校验返回图片存在透明通道。原图保留，结果保存为新素材并可应用到视频。

新增 7 项编辑相关核心测试，合计 30 项通过。真实 Electron 交互检查验证独立窗口、实际鼠标涂抹、撤销和重做、裁切尺寸与主界面同步，以及缺少 Key 时阻止两种 AI 修改。打包后的应用另外验证编辑窗口加载和裁切保存。收费接口仅使用隔离测试响应验证参数与数据处理，未执行实际账号图片修改。

编辑截图：[画笔修改](../output/mvp-review/desktop-editor-brush.png)、[裁切](../output/mvp-review/desktop-editor-crop.png)、[去背景](../output/mvp-review/desktop-editor-background.png)，交互报告：[editor-smoke.json](../output/mvp-review/editor-smoke.json)。


## 0.1.4 更新

按用户要求切换 MiniMax H3 到中国区 `https://api.minimax.cn`。创建任务、查询任务和非生成式连接测试使用同一地区地址。视频创作栏和设置页显示「中国区」，设置页列出实际 API 地址，任务记录显示提交地区。旧配置迁移为中国区；历史任务缺少地区字段时补记为海外区，恢复查询不会改到中国区。

地址依据：[中国区创建任务](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create)、[中国区查询任务](https://platform.minimax.cn/docs/api-reference/video-generation-v2-query)、[中国区任务列表](https://platform.minimax.cn/docs/api-reference/video-generation-v2-list)。本机不带密钥的只读列表请求约 1.97 秒返回 HTTP 401，确认 API 可连通，但不代表账号认证或收费生成已通过。

新增 3 项地区路由与迁移测试，合计 33 项通过；桌面和打包检查覆盖中国区标识。需要用户在设置中填写中国区 API Key，真实账号的 H3 生成效果仍待验证。原有凭据不会自动删除或转换；覆盖为中国区 Key 后，海外历史任务需要对应凭据才能继续查询。当前只提供中国区配置，不提供双地区凭据管理。


## 0.1.5 网络处理更新

针对用户报告的超时，本地只读检查确认：最近失败视频在 OpenAI Prompt 处理阶段终止，未保存实际 Prompt 或 MiniMax 任务 ID；此前一次视频提交已进入待核实状态。未重新提交任何用户生成任务，未修改用户历史任务。

桌面 API 与视频下载改为 Electron `net.fetch`，兼容系统代理设置；依据 [Electron net 官方文档](https://www.electronjs.org/docs/latest/api/net)。MiniMax 创建任务响应等待从 120 秒延长到 300 秒，保留不自动重发的语义。错误提示区分服务和请求阶段，显示主机与 DNS、TLS、连接中断或超时原因，并隐藏原始底层错误内容。

当前不带密钥的中国区 GET 分别经命令行与 Node 网络请求返回 HTTP 401，网络错误暂未复现。新增两项网络错误与阶段测试；当前全部 37 项核心测试通过。安装包检查另以本地 HTTP 服务验证实际桌面网络栈的 JSON 与 multipart 图片/遮罩上传。真实账号的认证、生成效果和之前的远程提交状态仍需用户在供应商平台确认。


## 0.2.0 工作台选择与多开

现有全部创作功能作为第一个种类「图片与视频创作」。启动先显示工作台选择页，可新建具名实例或继续已有实例，并同时打开多个窗口。每个实例独立保存素材、聊天、草稿、任务和模型偏好，API Key 在 App 中共用。新实例复制最近打开实例的模型偏好，之后互不影响。

旧版本 SQLite 与媒体保持原路径，登记为已有实例。窗口、IPC、编辑器和媒体协议绑定实例；在其他实例中使用原素材 ID 会被拒绝。关闭窗口后重开保留内容，重复打开已有实例聚焦原窗口。选择页不能调用生成与素材接口。

核心测试共 41 项通过，其中新增旧数据保留、实例隔离与重启、共享凭据、无效参数和两个实例独立提交任务检查。真实 Electron 检查覆盖启动页、两个实例、草稿与素材隔离、跨实例媒体读取拒绝、关闭重开和窗口复用，图片编辑与视频播放回归通过。安装包检查覆盖启动选择、多实例与独立草稿，以及原有媒体处理；本次未调用收费生成。

截图：[工作台选择](../output/mvp-review/desktop-workbench-launcher.png)、[第二个工作台](../output/mvp-review/desktop-second-workbench.png)。报告：[多工作台交互](../output/mvp-review/workbench-smoke.json)、[打包检查](../output/mvp-review/packaged-smoke.json)。设计见 [workbenches.md](./workbenches.md)。


## 0.2.1 单窗口与侧栏工作台列表

按用户调整，将左侧改为可滚动工作台列表，加号打开新建种类与名称弹窗。工作台打开、新建与切换均复用唯一主窗口；启动仍先显示选择页。各实例的 SQLite、草稿、聊天、素材、任务与模型偏好保持独立，API Key 共用。

切换只改变当前展示，原实例的任务继续运行。业务 API 绑定实例 ID，验证在切换后完成的原实例操作不会写入新实例。图片编辑器保持原实例绑定，主界面切换不改变其保存目标。主窗口媒体读取仅允许当前实例素材。

核心测试通过，真实桌面检查覆盖侧栏加号弹窗、同一主窗口切换、独立草稿与素材、异步操作原实例路由、18 个实例的列表滚动，以及原有编辑和播放回归。安装包验证单主窗口与独立草稿。本次未调用收费生成。

截图：[侧栏工作台](../output/mvp-review/desktop-sidebar-workbenches.png)，报告：[工作台交互](../output/mvp-review/workbench-smoke.json)。

## 0.3.0 Worktree 验证

46 项核心测试通过，包含目录归属、重启持久化和 version 1 迁移。桌面交互验证同组工作台目录共享、复制素材、不同 Worktree 目录隔离、加号入口及单主窗口切换，报告见 [workbench-smoke.json](../output/mvp-review/workbench-smoke.json)，界面见 [Worktree 树截图](../output/mvp-review/desktop-sidebar-workbenches.png)。安装包自检确认 Worktree 层级、文件树标题及图片编辑与视频播放功能。

## 0.3.1 模板 Gallery

启动 Dashboard 只显示可用模板卡片。桌面验证首次启动与已有多个 Worktree 时均无实例列表或内嵌创建表单；点击模板后可在弹窗选择 Worktree，取消不会创建实例。界面见 [模板 Gallery](../output/mvp-review/desktop-launcher-empty.png)，报告见 [桌面工作台验证](../output/mvp-review/workbench-smoke.json)。

## 0.3.2 Dashboard Worktree Gallery

模板 Gallery 下方增加已有 Worktree Gallery，显示工作台数量与最近使用记录。点击恢复最近工作台；空 Worktree 进入创建对话框。桌面验证覆盖卡片数量、目录归属、同窗口继续创作及空 Worktree 创建。界面见 [Dashboard Worktrees](../output/mvp-review/desktop-dashboard-worktrees.png)。

## 0.4.0 静态姿态原型

62 项核心测试通过。骨骼请求采用配置中的 OpenAI 模型与 Key，解析结果保存到工作台；提供独立静态图上传、Hierarchy、骨架预览、原图叠加及关节高亮。桌面验证使用本地测试响应，真实图片的定位精度尚未验证。报告见 [静态姿态](../output/mvp-review/pose-smoke.json) 和 [动画帧工作台姿态](../output/mvp-review/pose-frames-smoke.json)。

## 0.4.1 工作台隔离修正

图片与视频创作恢复原布局，骨骼组件及入口仅用于视频与动画帧工作台。核心验证检查原工作台不能触发骨骼解析且状态不变；桌面与安装包检查原双聊天、双预览布局，骨骼工作台继续单独验证。

## 0.5.0 动作工作流

72 项核心检查与实际 MediaPipe CPU 模型桌面检查通过：2 秒人体样本提取 24 帧、关节拖动、撤销/重做、姿态/动作保存、同步 Timeline、二维适配、组合及 H.264 参考导出。报告见 [动作检查](../output/mvp-review/motion-smoke.json)。本次未进行收费视频生成，复杂动作精度和 H3 跟随效果仍待验证；Wan 服务尚未接入。图片与视频创作的布局和功能隔离保留。

## 0.5.1 下载入口

视频与动画帧右侧提供原视频和动画帧 ZIP 下载。帧包使用导出时的 Timeline 快照，包含当前修改版 PNG、顺序与来源时间索引；打包完成后显示系统保存对话框，取消后清理临时包。实际点击报告见 [下载验证](../output/mvp-review/frame-download-smoke.json)。

## 0.6.0 本地 FBX 工作台

第二种模板已重做为动作编辑器，无 AI、Prompt、视频生成或二维拆帧界面。保留原模板数据、Worktree 和图片与视频工作台。支持真实 FBX 导入、模型与骨骼层级、环绕相机、播放与时间轴、倍速循环及原始文件下载。尚未实现关节关键帧修改、动作重定向和修改后动画导出。具体实现与验证见 [动作编辑器](animation-editor.md)。

本次 76 项核心测试、桌面交互检查及 0.6.0 打包应用检查通过。真实 FBX 验证读取到 2 个网格、119 个骨骼、2 个动画片段，并完成播放、定位、环绕、缩放、平移与切换恢复。记录见 [FBX 报告](../output/mvp-review/model-editor-smoke.json)、[打包报告](../output/mvp-review/packaged-smoke.json)。

## 0.6.1 原地播放

播放栏提供「忽略动画位移」，默认关闭；开启固定根节点与髋部的 XYZ 位移，保留肢体运动和旋转，取消恢复原动画。状态随工作台保存，切换不重置播放时间。78 项核心测试与打包 App 的开关、继续播放、切换恢复检查通过。

## 0.6.2 相机视频导出

支持固定当前视角、本地逐帧导出、动画范围、720p／1080p、24／30／60 FPS，以及当前倍速、原地播放、骨骼和地面网格设置。提供进度、取消、视频预览与 MP4 保存，文件树可重新预览和保存输出。完成或取消后恢复播放状态及相机。

81 项核心测试、桌面检查与 0.6.2 打包检查通过。真实 FBX 导出 1 秒、24 帧、720p 的 H.264 MP4，验证相机不变、播放进度恢复、文件保存、重新预览和取消不新增素材。第一帧截图见 [导出画面](../output/mvp-review/model-video-first-frame.png)，视频见 [导出样本](../output/mvp-review/desktop-model-video.mp4)，报告见 [打包检查](../output/mvp-review/packaged-smoke.json)。

## 0.7.0 Y Bot 基础模型

唯一内置角色为用户提供的 Y Bot.fbx。原自建人形代码与说明已删除，不作为备用模型。Y Bot 原件随 App 打包，运行时归一化尺寸并置于地面，保留原网格、材质和蒙皮，不再依赖 Downloads 文件。默认可见，上传的人形 FBX 动作自动应用到该模型。

已处理模型中的同名控制／蒙皮骨骼，映射 22 个主要关节，保持四肢和手部连接及角色比例。相机、骨骼显示、原地播放、时间轴与 MP4 导出均继续工作。截图见 [默认 Y Bot](../output/mvp-review/desktop-base-humanoid.png) 和 [应用动作的导出画面](../output/mvp-review/model-video-first-frame.png)。

87 项核心测试、真实 Y Bot 桌面检查及 0.7.0 打包检查通过。发行版本加载了 2 个网格、117 个骨骼节点，并成功应用动作、导出、预览及保存 MP4。报告见 [打包验证](../output/mvp-review/packaged-smoke.json)。当前映射主要关节；手指、面部、手动骨骼映射及脚底锁定／IK 尚未实施。
