# 终端工作台

终端模板注册为 `terminal`，共用 Worktree 导航与文件树。macOS `/bin/zsh -il` 在所属 Worktree 目录中启动，通过 node-pty 建立真实 PTY；xterm.js 显示 ANSI 颜色、光标与交互程序。面板右上角提供 Show Chat View／Show Terminal View、Split Terminal Right、Close Terminal，最多 8 个面板，可水平滚动。拆分时沿用当前终端最近确认的工作目录，创建独立 Shell。

两种视图共用同一个 PTY。切换工作台时保留进程，返回后恢复屏幕；关闭面板结束 Shell，App 退出清理所有会话。面板全关后显示 New Terminal。窗口尺寸变化传到 PTY，支持方向键、Tab、Ctrl-C 和终端粘贴。

Chat View 是 Codex 自然语言对话，调用本机 Codex CLI 的 `exec --json`，提示词通过 stdin 传入。每个面板保存独立 thread ID，后续通过 `exec resume <id>` 继续上下文，绝不使用 `--last`。使用 Codex 本机登录与模型配置，不读取或复制登录密钥。项目工作目录固定为所属 Worktree，允许其中的工作区编辑，保留 sandbox workspace-write；外部操作不自动提权。

Shell 控制器和 Codex 子进程分别管理；Shell 命令记录标记为 shell，聊天仅显示 codex 消息。运行中的 Codex 回复可停止，关闭面板或退出应用结束进程组。重启保留会话 ID 与对话，将未结束回复标记为中断。CLI 未安装或登录／请求失败时显示实际错误，不自动重新提交。运行等待最多 15 分钟。

协议采用官方 [Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode) 文档的 JSONL 会话事件，展示 agent_message，保存 thread.started 线程标识；stderr 诊断不会混进正常回复。

终端工作台不显示额外的工作台标题与副标题，直接展示分屏面板。

SQLite 保存面板 ID、名称、视图和受限长度的对话与旧 Shell 记录；进程 ID 与 PTY 屏幕仅保留于运行中的 App。重启开启新 Shell，不重新执行历史命令。输入、输出事件与会话访问都绑定工作台 ID。输出批量发送，超过阈值暂停／恢复 PTY 流，避免无限增长。完成命令后通知同组文件树刷新。

原生模块作为 Electron 外部依赖；node-pty 整体放入 asarUnpack，构建与安装准备阶段修正 macOS spawn-helper 的执行权限，确保打包后可启动真实 Shell。

验证覆盖 OSC 跨块解析、独立环境、终端尺寸、退出码、中断、关闭、跨实例访问拒绝和重启保留。桌面验证通过实际键盘输入、向右拆分、Chat View 发送、同 PID 切换、关闭最后一个终端与重新新建、紧凑布局，并在打包版复测。


0.8.4 验证：99 项核心测试通过，含自然语言与 Shell 隔离、每面板线程续聊、重复提交保护、取消和历史保存。真实 CLI 两轮对话和桌面内两轮对话均验证上下文记忆，停止按钮正常，Shell PID 在视图／工作台切换后保持不变。

打包资源使用同样的真实账户完成自然语言回复、记忆追问和停止检查；截屏位于 output/terminal-review/terminal-chat.png。
