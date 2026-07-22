# MVP-05：Workspace、Session 与上下文引用

- 状态：未开始
- 优先级：P0
- 前置任务：MVP-02、MVP-04
- 后续任务：MVP-08

## 目标

让用户可以管理本地 Workspace、恢复 OMP Session，并通过 `@` 引用加入上下文。

## 固定方案

- MVP 同一时间只激活一个 Workspace。
- 一个活动 Workspace 对应一个长期 OMP RPC 进程。
- 单个 OMP Runtime 同一时间只有一个活动 Session 可以生成。
- Session 消息和 Agent 状态由 OMP 持有。
- Desktop 只保存 Workspace 列表、置顶、归档和界面偏好。
- 不复制一份独立聊天数据库。

## 明确不做

- 不支持多个 Workspace 同时运行 Agent。
- 不为每个 Session 启动进程。
- 不建立复杂文件夹、标签和团队协作系统。
- 不把完整历史会话直接塞入模型上下文。

## 任务清单

### Workspace

- [ ] 支持选择本地目录作为 Workspace。
- [ ] 保存最近 Workspace 列表。
- [ ] 显示 Workspace 路径和可用状态。
- [ ] 切换 Workspace 前检查当前 Agent 是否运行。
- [ ] 切换时有序停止旧 OMP，再以新 `--cwd` 启动。
- [ ] 目录失效、无权限和 OMP 启动失败时显示明确错误。

### Session 能力确认

- [ ] 从 OMP 源码确认 Session 列表和元数据的唯一可信来源。
- [ ] 确认 RPC 是否已有列出 Session 的能力。
- [ ] 如果 RPC 没有列表接口，只读取 OMP 现有 Session 元数据，不新建消息存储格式。
- [ ] 记录 Session 文件路径、命名规则和兼容边界。
- [ ] 将最终方案补充到项目文档。

### Session UI

- [ ] 支持新建 Session。
- [ ] 支持切换 Session。
- [ ] 切换后使用 `get_messages` 恢复历史。
- [ ] 支持重命名 Session。
- [ ] 支持搜索 Session。
- [ ] 支持置顶和归档。
- [ ] 最近会话按今天、最近 7 天和更早分组。
- [ ] 运行中的 Session 显示明确状态。
- [ ] Agent 生成期间禁止另一 Session 同时发起 Prompt，并给出明确提示。
- [ ] 恢复时不重复消息，不丢失 Tool Call 和 Thinking 数据。

### `@` 引用

- [ ] 输入 `@` 后显示文件、目录和 Session 候选。
- [ ] `@file` 引用文件路径和所需内容。
- [ ] `@folder` 只加入目录说明和选定文件，不递归塞入全部内容。
- [ ] `@session` 默认引用摘要和关键消息。
- [ ] 明确显示每个引用的来源、大小和移除入口。
- [ ] 引用解析失败时不阻塞普通 Prompt。

### 持久化

- [ ] 定义最小 Desktop 配置结构。
- [ ] 只保存 Workspace、置顶、归档、布局和设置。
- [ ] 配置写入使用原子替换，避免损坏。
- [ ] 版本升级时保留向前迁移入口。
- [ ] 不保存模型密钥明文。
- [ ] 草稿设置长度和数量上限，成功发送、Session 删除或过期时清理，不保存图片 Base64。

### 测试

- [ ] 测试 Workspace 切换时只存在一个 OMP 进程。
- [ ] 测试 Session 新建、切换和历史恢复。
- [ ] 测试单 Runtime 不会并行生成两个 Session。
- [ ] 测试 Session 文件缺失和损坏。
- [ ] 测试搜索、置顶和归档持久化。
- [ ] 测试三类 `@` 引用的插入和移除。

## 完成条件

- [ ] 应用重启后可以恢复最近 Workspace。
- [ ] 可以新建、切换和恢复 Session。
- [ ] 多个 Session 可保存和切换，但同一时间只有一个 Session 生成。
- [ ] Session 消息只以 OMP 数据为准。
- [ ] Workspace 切换不会遗留旧 OMP 进程。
- [ ] `@file`、`@folder`、`@session` 可以加入输入上下文。
- [ ] 相关状态在重启后保持一致。

## 需要记录的决策

- OMP Session 列表来源：未确认
- Desktop 配置文件位置：未确认
- `@session` 摘要生成方式：未确认
- 置顶和归档元数据结构：未确认
