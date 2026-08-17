# Runtime Pool 性能基线

## 2026-08-16：OMP 启动和 ready 后进程树

本轮只测量不调用模型的部分。使用仓库内 `runtime/omp` 启动真实 RPC Runtime，不使用 fake Runtime。

环境：

- Linux 6.8.0-117-generic x86_64
- AMD Ryzen 5 5600，6 核 12 线程
- 62 GiB 内存
- Node.js v24.14.1
- OMP 17.1.0

命令：

```bash
pnpm benchmark:runtime-startup --output=/tmp/omp-runtime-startup-baseline.json
```

每个并行数运行 5 轮。Runtime 参数为 `--mode rpc --no-session --no-extensions --no-skills --no-rules`。所有 Runtime 发出 `ready` 后等待 500 ms，再从 `/proc/<pid>/stat` 做 5 秒区间 CPU 采样，同时通过 `ps` 采集 RSS。CPU 的 100% 表示占用一个逻辑核。

| 并行数 | 全部 ready 中位数 | 全部 ready 最大值 | 进程树 RSS 中位数 |  RSS 最大值 | 5 秒区间 CPU 中位数 | CPU 最大值 |
| -----: | ----------------: | ----------------: | ----------------: | ----------: | ------------------: | ---------: |
|      1 |        1457.24 ms |        1468.91 ms |        319.63 MiB |  320.13 MiB |               3.98% |      4.18% |
|      5 |        1805.39 ms |        1825.92 ms |       1592.49 MiB | 1593.89 MiB |              20.69% |     21.29% |
|     10 |        2702.92 ms |        2711.07 ms |       3174.58 MiB | 3178.57 MiB |              41.58% |     41.98% |

单个 OMP 主进程约占 306–311 MiB RSS，每个 Runtime 还有约 8.9 MiB 的 `node_repl` 子进程。RSS 和 ready 后区间 CPU 都随 Runtime 数量基本线性增长。测试轮次结束后，脚本启动的进程树均已退出。

## 2026-08-16：有头 Electron 真实模型调用

使用生产构建的 Electron 窗口和 `agent-browser` CDP 连接操作真实 UI。Desktop 状态、Workspace 和 Session 文件均位于每轮独立临时目录。固定参数如下：

- 模型：`openai-codex/gpt-5.4-mini`
- Thinking：`low`
- 禁用 tools、extensions、skills、rules、title 和 Runtime 自动重试
- Prompt：不调用工具，仅输出 1–100
- 每个有效轮次使用独立 Electron、userData 和 Workspace

命令：

```bash
pnpm build
pnpm benchmark:runtime-headed -- --preflight --output=/tmp/omp-headed-preflight.json
pnpm benchmark:runtime-headed -- --execute-model-calls --output=/tmp/omp-headed-result.json
```

测试中暴露了一个自动化问题：早期版本在点击“新建对话”后只等待输入框可用，没有等待新 Temporary Session ID。因此有一轮的 0–5 次调用无法准确计数。之后按上界计数，只继续提交剩余数量，所以本次总调用数为 **75–80**，没有超过 80。其中最后 65 次有逐条进度记录，且是 65 个独立 Session，失败数为 0。

下表只统计身份确认修正后的有效轮次。“首个可见文本”每轮只记录最后提交的可见 Session，不是所有 Session 的分位数。

| 配置上限 | 有效轮次 | 独立 Session | 失败 | 首个可见文本中位数 | Session 切换中位数 | 进程树峰值 RSS 中位数 | 峰值 RSS 最大值 |
| -------: | -------: | -----------: | ---: | -----------------: | -----------------: | --------------------: | --------------: |
|        5 |        3 |           15 |    0 |         6045.70 ms |          810.70 ms |           2076.98 MiB |     2101.48 MiB |
|       10 |        5 |           50 |    0 |         3762.10 ms |          810.30 ms |           2410.99 MiB |     2727.69 MiB |

之后的稳态采样使用 Electron `app.getAppMetrics()` 识别 Main、Renderer、GPU 和 Utility，再与 `ps` RSS 合并。Linux 下 zygote 和 sandbox 进程仍归入 `other`。

配置上限 5 的峰值采样中有 4 个 OMP Runtime，配置上限 10 时为 5–6 个。原因是 UI 自动化需要逐个等待 Temporary Session 绑定，较早任务完成后，同 Workspace 的空闲 Runtime 会被后续 Session 复用。因此这组数据验证了 Session 隔离、Runtime 复用、UI 切换和实际资源占用，但不代表 5 或 10 个 Runtime 在同一时刻全部生成的压力。全部 Runtime 同时启动的 RSS 仍以上一节无模型调用的启动基线为准。

### 运行、完成和 60 秒回收

稳态测试额外提交了 20 次 GPT-5.4 mini 调用。第一版脚本在回收后才做 Session 切换，5 次调用的结果因切换超时未保存。修正后的 15 次调用有完整数据，失败数为 0。每个阶段的 CPU 都是 5 秒区间值。

| 配置上限 | 阶段    | OMP 数 |      总 RSS | 总区间 CPU |   Main RSS | Renderer RSS |    GPU RSS | Utility RSS |
| -------: | :------ | -----: | ----------: | ---------: | ---------: | -----------: | ---------: | ----------: |
|        5 | 运行    |      5 | 2392.05 MiB |     85.53% | 175.85 MiB |   160.55 MiB | 233.13 MiB |   73.78 MiB |
|        5 | 完成    |      5 | 2376.07 MiB |      4.97% | 176.02 MiB |   160.84 MiB | 232.57 MiB |   73.78 MiB |
|        5 | 60 秒后 |      1 | 1096.77 MiB |      1.20% | 172.16 MiB |   143.47 MiB | 235.69 MiB |   73.74 MiB |
|       10 | 运行    |      5 | 2407.44 MiB |     61.25% | 174.32 MiB |   180.67 MiB | 237.05 MiB |   74.29 MiB |
|       10 | 完成    |      5 | 2406.12 MiB |      4.38% | 174.42 MiB |   182.14 MiB | 236.80 MiB |   74.29 MiB |
|       10 | 60 秒后 |      1 | 1128.66 MiB |      2.79% | 172.90 MiB |   167.18 MiB | 240.34 MiB |   74.27 MiB |

配置上限 10 的运行采样仍只有 5 个 OMP Runtime。这是真实 UI 提交和同 Workspace Runtime 复用的结果，不是上限失效。准确 10 个 Runtime 同时 ready 时的 RSS 和 CPU 见本文第一节。60 秒后只剩当前可见 Session 的 1 个 Runtime，符合后台 Runtime 60 秒回收、可见 Runtime 5 分钟保留的规则。

两轮 Electron 关闭都无需强杀，关闭后进程树剩余数为 0。决策 49 要求的 Runtime 启动、CPU、RSS、Session 切换和首个可见文本均已记录。
