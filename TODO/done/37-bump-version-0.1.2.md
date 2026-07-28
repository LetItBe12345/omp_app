# 37 版本升级到 0.1.2

- 状态：已完成
- 优先级：P0

## 任务

- [x] 将 Desktop 版本改为 `0.1.2`。
- [x] 同步 Ubuntu 安装、Release 验收和发布文档。
- [x] Workspace/Session 状态回归测试加入 CI Quality。
- [x] 本地检查、Linux 打包和 `.deb` 安装通过。
- [x] 创建 PR；Release 在合并后使用 GitHub Actions workflow 生成，不在本地手工执行 CD。

## 验证记录

- `pnpm check`：25 个测试文件、166 项测试通过。
- `pnpm package:linux` 和 `pnpm package:check` 通过。
- `.deb`：`omp-desktop 0.1.2 amd64`，SHA-256 为 `06c87c0d1190fd4ab185c17db19a9cd9b01dadb106c0867266dfabc6f242751c`。
- 使用系统 Polkit 授权覆盖安装后，`dpkg-query` 和 `omp-desktop --version` 均返回 `0.1.2`。
- Draft PR：`#50`。
