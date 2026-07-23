# 决策记录 03：模型授权、Provider 与模型选择

- 对应任务：`TODO/done/03-model-authorization-provider-and-selection.md`
- 状态：已确认
- 确认日期：2026-07-22

## OMP 二进制与首次授权

1. MVP 不修改 OMP 源码，不自建 OMP 二进制，继续使用官方发布的 Runtime。
2. MVP 假定用户已在 Desktop 之外配置好 OMP；Desktop 不负责首次授权。
3. 没有可用模型凭据时，Desktop 只显示“OMP 尚未配置”，不打开系统终端、不运行 OMP TUI，也不提供手工命令。
4. 首次外部配置完成且 Runtime 可以正常启动后，Desktop 仍保留 Provider 登录功能，允许用户通过 RPC `login(providerId)` 添加其他 Provider。

## Provider 列表与登录

5. Desktop 显示 `get_login_providers` 返回的全部 Provider，不维护本地允许列表；RPC 无法完成某个 Provider 的登录交互时，提示改用 OMP TUI。
6. Provider 页面不显示“已登录/未登录”徽标，避免 `storeCredentialsAs` 与 `hasAuth(provider.id)` 不一致导致误判；所有 Provider 都提供“登录或重新登录”，实际可用性以模型列表为准。
7. 同一时间只允许一个 Provider 登录流程；登录期间禁用其他 Provider 的登录入口，但允许取消当前登录。
8. Desktop 不设置 Provider 登录总超时；只遵守 OMP 交互事件自带的超时，没有事件超时时一直等待用户取消。
9. Provider 登录只允许在 Runtime 空闲时发起，Agent 正在生成或执行工具时禁用登录。

## 模型与 Thinking Level

10. Agent 运行期间可以选择待切换模型，但 Desktop 不立即调用 `set_model`。
11. 当前回复和全部 Follow-up 执行完成后，Desktop 再应用待切换模型；新模型用于用户下一次手动发送的消息。
12. 运行期间可以同时选择待生效 Thinking Level；`provider + modelId + thinkingLevel` 作为一组待生效配置，执行链结束后先切换模型，再设置 Thinking Level。
13. 切换模型时，Thinking Level 默认使用新模型返回的 `thinking.defaultLevel`；用户可以从 `thinking.efforts` 中手动改选。
14. Model 和 Thinking Level 在 UI 中使用两个相邻的独立下拉框，不使用矩阵；Thinking Level 选项由当前或待切换模型的元数据决定。
15. 应用待切换配置时，如果模型切换成功但 Thinking Level 设置失败，保留新模型，不强制回滚；Desktop 调用 `get_state` 恢复 OMP 真实状态，并提示用户重新选择 Thinking Level。

## 登录结果与模型选择

16. 用户取消登录后，Desktop 先发送取消响应；5 秒内 OMP 仍未结束登录请求时，重启 Runtime 并恢复原 Workspace 和 Session。
17. `get_available_models` 返回的模型没有通用的 Provider 默认模型标记；Desktop 不根据列表位置或 `priority` 推测默认模型。
18. Provider 登录成功并刷新模型后，Desktop 自动打开完整模型选择器，不按登录 Provider ID 过滤；这样可以兼容 `openai-codex-device → openai-codex` 类似别名，不需要 Desktop 维护 `storeCredentialsAs` 映射。
19. 登录成功后模型列表没有新增项仍视为成功；重新登录或 Provider 别名都可能导致列表不变，Desktop 不因此报错。
20. 当前模型因授权失效、Provider 下线或模型目录刷新而消失时，Desktop 阻止发送，刷新模型列表并打开选择器，不自动切换或静默使用 fallback。
21. 模型选择器使用一个可搜索的下拉框，按 Provider 分组，每项显示模型名称和 Provider。
22. 每个 Provider 分组内保持 `get_available_models` 返回的顺序，Desktop 不重新排序。
23. 模型下拉项始终以模型名称为主文字，并以较小的辅助文字显示 `modelId`。
24. 模型搜索同时匹配 Provider 名称、Provider ID、模型名称和 `modelId`。
25. 模型有 `thinking.defaultLevel` 时使用它；没有时使用 `thinking.efforts` 第一项；两种情况都允许用户手动切换。

## Provider 入口与验证

26. “添加 Provider”入口放在模型下拉框底部，点击后打开 Provider 登录弹窗；MVP 不新增独立工具栏按钮或 Settings 页面。
27. CI 使用 Fake OMP 覆盖 OAuth、手动输入、API Key、取消、超时和错误流程，不在公开 CI 中使用真实凭据。
28. 发布前人工完成一次真实 OAuth 和一次真实 API Key 登录；不固定 Provider 名称，选择当时可用的 Provider，并记录实际 Provider ID。

## Session 与持久化

29. 模型和 Thinking Level 按 Session 管理；切换 Session 后通过 `get_state` 显示该 Session 的真实模型和 Thinking Level。
30. Agent 运行期间已选择待切换配置时，用户确认切换 Session 后，Desktop 先停止旧 Session 的执行链，再将待切换模型和 Thinking Level 应用到旧 Session，最后进入新 Session。
31. 切换 Session 前应用旧 Session 配置失败时，仍继续进入新 Session，同时提示“旧 Session 的模型配置未完全保存”；以后切回旧 Session 时通过 `get_state` 恢复真实状态。
32. OMP 默认在当前用户的 `~/.omp` 中持久化凭据；Desktop 不读取该目录，并在应用重启、Session 切换和 Workspace 切换时复用 OMP 授权。只有 OMP 判定凭据失效时才要求重新登录。

## Provider 可用性与搜索

33. `available` 由 OMP Provider 定义决定，不是登录或网络状态；Desktop 不自行探测或修改它。每次打开“添加 Provider”弹窗时重新调用 `get_login_providers`；`available: false` 时仍显示该 Provider，但禁用登录并标注“当前不可用”。
34. “添加 Provider”弹窗使用可搜索列表，同时匹配 Provider 名称和 Provider ID，并保持 OMP 返回顺序；Desktop 不自行按 OAuth、API Key 或本地模型分类。

## 授权交互与 Renderer 边界

35. OMP RPC 的登录 `input` 没有敏感类型标记；Desktop 将所有登录输入默认隐藏，提供临时“显示内容”，并在提交、取消或失败后立即清空，不写日志、不持久化。
36. OMP 发出 `open_url` 后，Desktop 自动调用系统浏览器；登录弹窗显示“已打开浏览器”和“重新打开”，不显示或记录完整 OAuth URL。
37. Main 只向 Renderer 传递模型选择所需的 `provider`、`id`、`name`、`reasoning`、`thinking.efforts` 和可选 `thinking.defaultLevel`，不传递 OMP 的完整模型对象。
38. Runtime 空闲时，用户选择模型后立即调用 `set_model`；成功后更新 Thinking Level，失败后通过 `get_state` 恢复原状态，不增加“应用”按钮。
39. OMP 在发出 `ready` 前退出且 stderr 精确包含 `No models available.` 时，Desktop 标记为“OMP 尚未配置”；其他 `ready` 前退出统一视为 Runtime 启动失败。
40. 模型分组能按 ID 匹配到 OMP Provider 名称时，显示“名称 + Provider ID”；无法匹配时只显示 Provider ID，不维护本地名称映射。
41. 已知登录错误分别显示“已取消”“输入超时”“需要在 OMP Terminal 登录”或“授权失败”；未知错误脱敏并限制长度，详细脱敏信息写入 Runtime 日志。
42. 当前模型不支持手动调节 Thinking Level 时，UI 保留控件位置并禁用：非推理模型显示“不支持”，会推理但不能调档的模型显示“自动”。

## 待切换配置与恢复

43. Agent 运行期间选择待切换配置后，底部 Model 和 Thinking Level 控件显示待切换值并标注“下次使用”；当前回复仍明确使用原配置。
44. 运行期间多次修改待切换模型或 Thinking Level 时，只保留最后一次选择，不建立切换队列。
45. Provider 登录等待期间 Renderer 刷新或崩溃重载时，OMP 登录请求继续运行；Renderer 恢复后重新显示尚未回答的登录步骤，但输入框必须为空。
46. Agent 运行期间 Runtime 崩溃并自动恢复原 Session 后，Desktop 尝试应用待切换模型和 Thinking Level；失败时通过 `get_state` 恢复真实状态。
47. 用户点击 Stop 后，Desktop 先按已定 Stop 流程恢复当前 Session，再应用待切换模型和 Thinking Level。
48. 待切换状态提供明确的“取消下次切换”入口；点击后清除待切换状态，底部控件恢复显示当前运行配置。
49. Runtime 空闲时手动修改 Thinking Level 立即调用 `set_thinking_level`；失败时通过 `get_state` 恢复 OMP 实际值。
50. 模型列表刷新失败时，保留本次应用运行期间最后一次成功获取的列表，显示“刷新失败”和“重试”；该列表只存在内存中，不写入磁盘。
51. 新建 Session 后，初始模型和 Thinking Level 完全以 OMP 新 Session 的 `get_state` 为准，Desktop 不复制旧 Session 配置，也不强制先选择。
52. Agent 运行期间存在待切换配置且用户确认切换 Workspace 时，Desktop 先停止当前执行链，将待切换配置应用到当前 Session，再关闭旧 Runtime 并切换 Workspace；该配置不带到新 Workspace。

## 组件、登录弹窗与 Thinking 显示

53. 模型选择器和 Provider 登录弹窗使用 Radix Dialog、Radix Popover 和 `cmdk`，复用它们的搜索、键盘导航和焦点管理；样式继续使用现有 Tailwind。
54. OMP `open_url.instructions` 作为长度受限的纯文本显示，不解析 Markdown，不允许其中链接点击。
55. Provider 登录进行中，用户按 Esc、点击遮罩或点击弹窗关闭按钮都视为“取消登录”，执行同一套取消和必要时重启 Runtime 的流程。
56. 系统浏览器打开失败时，保持 OMP 登录请求等待，显示“无法打开浏览器”、“重新打开”和“取消登录”，不显示完整授权 URL。
57. Provider 登录弹窗只显示最新一条脱敏进度，不展示完整进度时间线，登录结束后不保留进度历史。
58. Runtime 发出 `ready` 后，Desktop 同时获取 Provider 列表和模型列表；每次打开“添加 Provider”弹窗时再刷新 Provider 列表，不在每次打开模型下拉框时重复请求。
59. Thinking Level 已知值使用中文显示名称：`minimal` 为“最低”、`low` 为“低”、`medium` 为“中”、`high` 为“高”、`xhigh` 为“超高”、`max` 为“最高”；未知值原样显示。该映射只影响文案，不决定模型支持哪些档位。
60. `get_state` 返回的当前 Thinking Level 不在模型最新 `thinking.efforts` 中时，Desktop 仍显示 OMP 实际值，并标注“当前档位已不受支持”，不自动修改。
61. “当前 Thinking Level 已不受支持”是非阻断警告；只要当前模型仍有效，用户可以继续发送，也可以手动切换到受支持档位。
62. Provider 登录成功后打开完整模型选择器；用户直接关闭而未选择时，保持当前模型不变，已由 OMP 保存的 Provider 授权仍然有效。
63. “添加 Provider”使用居中模态弹窗：先选择 Provider，再在同一弹窗内显示浏览器授权、输入、进度和错误；不把多步登录放在模型下拉框内，也不使用右侧抽屉。
