# MVP-03：流式对话与执行轨迹

- 状态：未开始
- 优先级：P0
- 前置任务：MVP-02
- 后续任务：MVP-04、MVP-07

## 目标

完成最小聊天闭环，并正确展示文本、Thinking、Tool Call 和 Permission。

## 核心交互

- Thinking、工具调用和最终文本属于同一个 Assistant Turn。
- 运行中默认展开执行轨迹。
- 成功完成后自动折叠执行轨迹。
- 失败、等待确认和用户手动展开时保持展开。
- 最终回答始终比过程信息更突出。

## 明确不做

- 不把 Thinking 和每次 Tool Call 渲染成独立聊天消息。
- 不展示模型未提供的隐藏推理。
- 不在每个 token 到达时触发一次完整 React 更新。
- 不先实现复杂主题系统和富媒体组件市场。

## 任务清单

### 数据模型

- [ ] 定义统一的 `AssistantTurn` 数据结构。
- [ ] 建立 `OmpEventReducer`，归并文本、Thinking 和 Tool Call。
- [ ] 正确处理 `message_start/update/end`。
- [ ] 正确处理 Thinking 增量。
- [ ] 正确处理 Tool Call 参数、进度、结果和错误。
- [ ] 正确处理 Agent、Turn、Retry、Compaction 和 Notice 状态。
- [ ] 历史消息恢复与实时事件使用同一数据模型。

### 流式性能

- [ ] 将高频增量写入内存 buffer。
- [ ] 每 16–33 ms 合并一次 UI 更新。
- [ ] 只更新当前 Assistant Turn。
- [ ] 已完成 Markdown 结果缓存，不重复解析完整历史。
- [ ] 长对话使用虚拟列表或等价方案。
- [ ] Tool Call 进度更新限频。

### UI

- [ ] 用户消息靠右，使用紧凑的极浅灰背景。
- [ ] Assistant 消息靠左，白底黑字，不使用头像和气泡。
- [ ] 当前执行轨迹在生成时展开。
- [ ] 完成后折叠为“耗时、工具数、状态”的单行摘要。
- [ ] Tool Call 可以展开查看输入、输出和错误。
- [ ] Permission 请求提供明确的允许、拒绝和范围选项。
- [ ] Diff 和文件改动使用独立卡片，不塞入纯文本。
- [ ] 自动滚动只在用户位于底部附近时生效。

### 输入区

- [ ] 支持普通 Prompt。
- [ ] 生成中显示 Stop。
- [ ] 支持 Steer。
- [ ] 支持 Follow-up 队列。
- [ ] 显示当前模型和 Thinking Level。
- [ ] 显示连接、生成、重试和错误状态。
- [ ] 禁止重复提交同一输入。

### 测试

- [ ] 为事件乱序、重复和缺失结束事件编写 reducer 测试。
- [ ] 测试运行中展开、成功折叠、失败保持展开。
- [ ] 测试历史恢复后不会重复消息。
- [ ] 测试长文本和高频 token 下的更新次数。
- [ ] 测试 Stop、Steer 和 Follow-up 的状态转换。

## 完成条件

- [ ] 用户发送 Prompt 后可以看到连续流式文本。
- [ ] Thinking 和 Tool Call 在运行中可实时更新。
- [ ] 成功完成后执行轨迹自动折叠。
- [ ] 失败或等待 Permission 时执行轨迹保持展开。
- [ ] 重新打开 Session 后消息结构和折叠状态正确。
- [ ] 高频输出时界面无明显卡顿。
- [ ] reducer 和关键交互测试通过。

## 复用重点

- assistant-ui：Thread、Message、Composer、自动滚动和流式原语。
- OpenCode Session UI：工具分组、状态摘要和 Diff 卡片交互。
- TanStack Virtual：长对话虚拟化。
- Radix UI：Permission、菜单和折叠交互。
