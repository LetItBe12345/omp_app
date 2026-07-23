# POST-MVP-03：多 Session 并行 Runtime

- 状态：未开始
- 优先级：P1
- 前置任务：MVP-02、MVP-05、MVP-09

## 目标

在一个 OMP Desktop 应用实例内，让多个 Session 可以并行运行 Agent，同时限制资源占用并隔离事件。

## 固定方案

- 一个正在生成的 Session 对应一个独立 OMP Runtime。
- 闲置 Session 只保留 OMP Session 文件，不长期占用进程。
- Settings 提供最大并行 Session 数量。
- 达到上限后进入队列或提示用户选择，不突破限制静默创建进程。

## 任务清单

- [ ] 建立以 Session ID 为键的 Runtime 池和生命周期状态。
- [ ] 为每个 Runtime 注入对应 Workspace、Session、环境和网络配置。
- [ ] 将 RPC 请求、响应、流式事件和错误严格路由到对应 Session。
- [ ] 在 Settings 中提供最大并行数量，并定义默认值和允许范围。
- [ ] 达到上限时实现等待队列或用户可理解的处理提示。
- [ ] Session 完成、停止、关闭或崩溃后及时回收 Runtime。
- [ ] 应用退出时有序停止池内全部 Runtime，超时后强制结束。
- [ ] 展示每个 Session 的排队、启动、运行、停止和错误状态。
- [ ] 测试并行输出不会串到其他 Session。
- [ ] 测试最大并行限制、队列推进、崩溃隔离和进程清理。
- [ ] 记录不同并行数量下的 CPU、内存和启动耗时。

## 完成条件

- [ ] 两个及以上 Session 可在限制范围内同时生成。
- [ ] 消息、工具调用、权限请求和错误不会跨 Session。
- [ ] 最大并行设置始终生效，达到上限时行为明确。
- [ ] Session 结束或应用退出后不残留 OMP 进程。
- [ ] 闲置 Session 不占用长期 Runtime。
