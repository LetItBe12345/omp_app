# POST-MVP-03：多 Session 并行 Runtime

- 状态：已完成
- 优先级：P1
- 前置任务：MVP-02、MVP-05、MVP-10

## 目标

在一个 OMP Desktop 应用实例内，让多个 Session 可以并行运行 Agent，同时限制资源占用并隔离事件。

## 固定方案

- 一个正在生成的 Session 对应一个独立 OMP Runtime。
- 闲置 Session 只保留 OMP Session 文件，不长期占用进程。
- Settings 只提供新会话默认网络和最大并行 Session 数量两项。
- 最大并行数量默认为 5，允许设为 1–10。
- 达到上限后进入全局 FIFO 队列，不静默创建超额进程。
- 会话列表使用不同图标区分排队、执行、等待交互、失败和未查看完成。
- Runtime Network 使用新 Session 全局默认值和 Session 独立配置。

## 待确认项

- [x] 确认最大并行数量的可选范围和输入控件，见决策 8。
- [x] 确认全部 Runtime 处于 busy 时，新 Session Prompt 的等待、取消、后续消息和 UI 规则，见决策 9–10。
- [x] 确认等待任务的排序、公平性和是否按 Workspace 分组，见决策 11。
- [x] 确认 Runtime 进入空闲的完整判定条件，见决策 12。
- [x] 确认当前可见 Session、后台空闲 Session 和正在运行 Session 的 Runtime 保留与回收顺序，见决策 13。
- [x] 确认后台空闲 Runtime 是否保温，以及保温时间，见决策 14。
- [x] 确认调低最大并行数量时，已运行、空闲和排队 Runtime 的处理方式，见决策 15。
- [x] 确认 Runtime 是重新启动还是在条件相容时切换 Session 后复用，见决策 16。
- [x] 确认同一 Workspace 内多 Session 同时修改文件时的提示和限制，见决策 17。
- [x] 确认排队任务在应用退出或崩溃后是否恢复，见决策 18。

## 任务清单

- [x] 按决策 51 分四段实现：上限 1 的 Pool 接口与路由、上限 1 的隔离与重载恢复、多进程与队列、Settings 与 UI 及性能基线。
- [x] 建立 Runtime Pool，使每个 Runtime Supervisor 只管理一个 OMP 进程。
- [x] 建立稳定的 Workspace ID、Session ID 和 Runtime Instance ID 关联。
- [x] 定义启动、运行、等待交互、停止、空闲、失败和后续确认的超限处理状态。
- [x] 为每个 Runtime 注入对应 Workspace、Session、环境和网络配置。
- [x] 让 Prompt、Follow-up、Stop、模型、权限、Extension UI 和 Tool Approval 请求显式携带目标 Session。
- [x] 将 RPC 请求、响应、流式事件、交互请求和错误严格路由到对应 Session。
- [x] 用 Runtime Instance ID 或等价 generation 隔离同一 Session 重启前后的迟到事件。
- [x] 将 Extension UI、Tool Approval、高频事件批处理和计时器按 Session 隔离。
- [x] 按决策 41–42 保持全局单一 Provider 登录流程，并将发起 Session、Runtime、网络配置和池名额正确关联。
- [x] 按决策 43 对最终 Runtime 环境计算仅内存的脱敏相容性指纹。
- [x] 在 Desktop 状态中保存最大并行数量，缺失或无效时使用默认值 5。
- [x] 按决策 31 将现有 Runtime Network 全局配置迁移为新 Session 默认值和旧 Session 迁移基准值，并为正式 Session 持久化独立网络配置。
- [x] 在 Settings UI 的 Runtime 分区中只显示新会话默认网络和最大并行数量，由 Main 做最终校验，并显示当前运行与等待数量的只读摘要。
- [x] 将输入框控制栏的网络选择改为只修改当前 Session，并支持复制当前全局默认值。
- [x] 按决策 9–20 实现超限处理、取消和队列推进。
- [x] 对全局 Runtime 等待队列实施 20 项和 64 MiB 上限，对全部 Follow-up 实施每 Session 5 项和全局 64 MiB 上限。
- [x] 按决策 12–16 和 32–34 选择、复用、替换和回收 Runtime。
- [x] 按决策 35 并行关闭池内全部 Runtime，共用 5 秒退出期限，超时后强制结束进程组。
- [x] 将当前可见 Session 与正在运行的 Session 解耦，切换界面时不停止后台任务。
- [x] 为每个 Session 保存运行状态摘要，不再只保存一份全局 Runtime Snapshot。
- [x] 按决策 36 让 Renderer 重载后恢复 Pool Snapshot、正在运行的对话投影和待处理交互。
- [x] 所有 Runtime 事件和交互请求使用 Runtime Instance ID、generation 和原始 ID 组成复合键，并核对 Workspace 与 Session 绑定。
- [x] 按决策 21–22 和 27 在 Session 与 Workspace 行显示执行、排队、等待交互、失败和未查看完成状态。
- [x] 按决策 26 扩展 Renderer 的对话投影缓存，确保运行中 Session 的后台事件不串入当前会话。
- [x] 按决策 28 只在提交 Prompt 或 Follow-up 时更新 Session 排序，取消排队时恢复原位置。
- [x] 为后台运行 Session 提供只作用于目标 Runtime 的“停止任务”菜单项。
- [x] 按决策 30 处理新 Session 在首条 Prompt 前的 Temporary Session ID、列表临时行和正式绑定。
- [x] 按决策 45–46 为取消、启动失败和 Runtime 崩溃提供不覆盖现有草稿的统一消息恢复条。
- [x] 按决策 38 让需要 OMP 的 Slash Command 使用同一 Runtime Pool 和全局队列。
- [x] 持久化每个 Session 的未查看完成布尔值，并按决策 39–40 区分跨重启的未查看状态和仅内存的失败状态。
- [x] 测试并行输出不会串到其他 Session。
- [x] 测试不同 Runtime 使用相同 RPC 请求 ID、Tool Approval ID 或 Extension UI ID 时仍能正确隔离。
- [x] 测试默认并行数量 5、设置持久化、上限生效和非法值回退。
- [x] 测试最大并行限制、超限处理、崩溃隔离和进程清理。
- [x] 测试全局默认网络、Session 独立网络、相容 Runtime 复用和不相容 Runtime 替换。
- [x] 测试 Session 与 Workspace 行的各类状态、未查看蓝点、状态优先级和列表稳定排序。
- [x] 测试 Temporary Session ID 的排队、取消、失败、正式绑定和退出清理。
- [x] 测试 Renderer 重载不停止 Runtime 或清空队列，且能恢复多 Session 状态和待处理交互。
- [x] 测试多 Runtime 并行退出共用 5 秒期限，且不遗留任何进程组。
- [x] 测试 OMP Slash 与普通 Prompt 共用 Runtime Pool 和全局队列。
- [x] 当前产品没有纯 Desktop Slash；命令目录和执行都由 OMP 提供，不硬编码本地命令。后续如新增这类命令，必须验证其不占 Runtime 名额。
- [x] 测试未查看完成状态的持久化与清除。
- [x] 测试 Runtime 失败状态只存在内存中，并在手动重试被接收后清除。
- [x] 测试 Provider 登录全局互斥、池满拒绝、发起 Runtime 失效取消和全局模型刷新。
- [x] 测试环境指纹不包含波动变量，不向日志、诊断或 Renderer 泄露敏感值。
- [x] 测试队列条数、全局队列字节和 Follow-up 字节上限，拒绝时保留输入。
- [x] 测试取消、启动失败和崩溃恢复条不覆盖现有草稿，且能交换文字、引用和附件。
- [x] 按决策 49 记录并行数 1、5、10 下的 CPU、RSS、Runtime 启动、Session 切换和首个可见文本耗时。
  - [x] 真实 OMP 进程树的启动到 `ready` 耗时和 ready 后 RSS，每组 5 轮，见 `docs/runtime-pool-performance-baseline.md`。
  - [x] 使用 Electron `app.getAppMetrics()` 和 5 秒 `/proc` 区间采样，记录 Main、Renderer、GPU、Utility、OMP 在运行、完成和 60 秒回收后的 CPU 与 RSS。
  - [x] 使用有头 Electron、固定 GPT-5.4 mini/low 和固定 Prompt，记录 Session 切换和 Prompt 到首个可见文本耗时，见 `docs/runtime-pool-performance-baseline.md`。
- [x] 按决策 50 为共享诊断日志的所有 Runtime 记录加关联前缀，并保持现有脱敏和大小限制。

## 完成条件

- [x] 两个及以上 Session 可在限制范围内同时生成。
- [x] 消息、工具调用、权限请求和错误不会跨 Session。
- [x] 首次使用时最大并行数量为 5，用户可以在 UI 中修改并持久化。
- [x] 最大并行设置始终生效，达到上限后不会静默创建超额 Runtime。
- [x] 超额 Prompt 按全局 FIFO 排队，用户可以查看队列位置并取消，取消、失败和崩溃恢复不覆盖现有草稿。
- [x] Session 和 Workspace 行能正确区分排队、执行、等待交互、失败和未查看完成，不将后台事件串入其他 Session。
- [x] 新 Session 默认网络和 Session 独立网络可以正确迁移、保存和生效，只复用最终环境相容的空闲 Runtime。
- [x] Renderer 重载不停止后台 Runtime 或清空等待队列，且能恢复每个 Session 的状态和待处理交互。
- [x] 全局队列和 Follow-up 的条数与字节上限生效，拒绝新输入时不丢失内容。
- [x] Session 结束或应用退出后不残留 OMP 进程。
- [x] 闲置 Session 不占用长期 Runtime。
