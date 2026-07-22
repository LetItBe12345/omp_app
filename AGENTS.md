# AGENTS.md

本文件的规则适用于整个仓库。

## 1. 沟通方式

- 使用平实、直接、克制的技术向白话中文。
- 先说具体事实，再给出判断。
- 多用精确的工程术语，不使用空泛的职场词汇。
- 使用短句和简单的词语，控制篇幅。

## 2. 检索与修改

- 回复或修改前，先检索相关代码、配置和文档。
- 动手前先理解现有实现，只修改完成当前任务所需的部分。
- 实现或修改 Desktop UI 前，必须先查看 `UI/16341.png`，并对照 `docs/product-spec.md`。
- 优先复用仓库现有代码和成熟的开源实现，能使用外部参考项目就使用，不要重复造轮子。
- 优先最简单、可验证的实现，避免过度设计。
- 不为极少发生的边界情况增加大量备用逻辑。
- 保留用户的现有修改，不擅自回退或删除无关内容。

## 3. 目录与文件

- 新文件必须放入职责对应的目录，不在根目录随意创建文件。
- `runtime/` 存放随应用分发的 OMP 二进制。
- `scripts/` 存放开发、下载、校验和测试脚本。
- `docs/` 存放项目文档。
- `TODO/in-progress/` 存放未完成或正在处理的任务。
- `TODO/done/` 存放已满足完成条件的任务记录。
- `tests/` 存放测试，`tests/fixtures/` 存放测试数据。
- `src/` 的结构尚未确定，未经确认不要预先创建子目录。

## 4. TODO 状态

- 新任务放入 `TODO/in-progress/`。
- 未开始和正在处理的任务都属于 `in-progress`。
- 任务和完成条件全部满足后，才能移入 `TODO/done/`。
- 产品规则写入项目文档，可执行动作写入 TODO，避免重复。

## 5. 决策管理

- 使用grill me skill 后 要将确定的内容以最小修改/添加的形式同步到TODO对应文件
- 并将全部决策按条目写入/home/jin/开源/omp_app/decision/ 文件夹中的一个
  文件内，并和todo编号保持一致。

## 6. 验证与发布

- 修改后执行与改动相匹配的检查和测试。
- 没有验证过的结果必须明确说明，不能宣称已通过。
- 提交、推送、创建 Tag 和发布 Release 是不同操作，不能相互代表授权。
- 只有用户明确要求时，才能推送代码、创建 Tag 或发布 Release。

## 7. 项目索引

- 产品定位、MVP 范围和界面规则见 `docs/product-spec.md`。
- Desktop 分层、技术选型和性能原则见 `docs/desktop-architecture.md`。
- OMP RPC 能力和命令索引见 `docs/OMP_RPC.md`。
- OMP 二进制位于 `runtime/omp`；配置模型凭据后，使用 `runtime/omp --mode rpc` 启动，使用 `node scripts/rpc-smoke.mjs` 验证。
- 当前 Desktop UI 视觉参考见 `UI/16341.png`；布局和交互以产品文档为准。

## 8. 外部参考项目

- Desktop UI 和参考仓库的使用规则见 `docs/desktop-ui-implementation-and-reference-workflow.md`。
- OpenCode：`../omp-references/opencode`；重点看 `packages/desktop/` 和 `packages/session-ui/`。
- assistant-ui：`../omp-references/assistant-ui`；重点看 `packages/react/` 和 `packages/ui/`。
- ohmypi-craft：`../omp-references/ohmypi-craft`；重点看 `apps/electron/` 和 `packages/core/`。
- Oh My Pi：`../omp-references/oh-my-pi`；重点看 `docs/rpc.md`、`packages/coding-agent/`、`packages/wire/` 和 `packages/collab-web/`。
- 外部仓库视为只读，只检索当前任务所需的文件。
- `AGENTS.md` 只提供精确路径和用途，不复制大段外部源码。
- 不把外部仓库加入当前 Workspace、Git Submodule 或提交历史。
- 复用最小组件和接口，不复制完整架构。
