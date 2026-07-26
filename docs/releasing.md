# 发布流程

1. 在 `main` 上完成 CI。PR 只需要 GitHub Hosted CI 通过即可合并。
2. 在本机原生 Wayland + RTX 3090 上构建当前 commit，完成 [发布验收](release-acceptance.md)，生成与 commit 同名的验收记录。
3. 在 GitHub Actions 手动运行 `Release`，输入不带 `v` 的稳定版本，例如 `0.1.0`。Workflow 会先在 self-hosted runner 检查 Wayland、GPU、Runtime 和验收记录；记录不存在或 commit/version 不匹配时不会打包。
4. GPU gate 通过后，GitHub x64 Hosted Runner 下载并校验固定的 OMP，构建 AppImage 和 `.deb`，生成各自 SHA-256 文件，并创建 Draft Release `v<release_version>`。Workflow 不创建 Tag。
5. 检查 Draft Release 的文件、校验值、Release Notes、GPU 摘要和已知问题。确认无误后在 GitHub 页面点击 Publish；此时 GitHub 才创建 Tag。

版本参数只接受 `X.Y.Z`。同版本同 commit 的 Draft 可更新；同名 Tag 指向其他 commit 时必须停止。发布前不要把 Token、`gpu-acceptance.json` 外的本机日志或认证文件上传到 artifact。
