#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/.." && pwd)"
references_dir="${1:-$(dirname -- "$project_dir")/omp-references}"

repositories=(
  "opencode|https://github.com/anomalyco/opencode.git"
  "assistant-ui|https://github.com/assistant-ui/assistant-ui.git"
  "ohmypi-craft|https://github.com/BRCOO/ohmypi-craft.git"
  "oh-my-pi|https://github.com/can1357/oh-my-pi.git"
)

mkdir -p -- "$references_dir"

for repository in "${repositories[@]}"; do
  name="${repository%%|*}"
  url="${repository#*|}"
  target_dir="$references_dir/$name"

  if [[ -e "$target_dir" ]]; then
    if [[ ! -d "$target_dir/.git" ]]; then
      echo "目标已存在，但不是 Git 仓库：$target_dir" >&2
      exit 1
    fi

    current_url="$(git -C "$target_dir" remote get-url origin 2>/dev/null || true)"
    if [[ "$current_url" != "$url" ]]; then
      echo "已有仓库的 origin 不匹配：$target_dir" >&2
      echo "当前：${current_url:-<未配置>}" >&2
      echo "预期：$url" >&2
      exit 1
    fi

    echo "已存在，跳过：$target_dir"
    continue
  fi

  git clone --depth 1 --single-branch "$url" "$target_dir"
done

echo
echo "参考仓库版本："
for repository in "${repositories[@]}"; do
  name="${repository%%|*}"
  target_dir="$references_dir/$name"
  commit="$(git -C "$target_dir" rev-parse HEAD)"
  printf '%-14s %s\n' "$name" "$commit"
done
