#!/usr/bin/env bash
# sTune 初回環境構築用スクリプト（macOS）
# 使い方: ./scripts/setup.sh  または  bash scripts/setup.sh

set -e
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

echo "== sTune 環境構築 =="

# macOS 以外では MTP 用 mtp-cli はスキップ（Go ビルドは darwin 前提）
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "※ このスクリプトは macOS 向けです。Linux/Windows では Node 部分のみ実行します。"
  SKIP_MTP_CLI=1
else
  SKIP_MTP_CLI=0
fi

# --- Homebrew ---
if [[ $SKIP_MTP_CLI -eq 0 ]]; then
  if ! command -v brew &>/dev/null; then
    echo "Homebrew をインストールします: https://brew.sh"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Apple Silicon では PATH に brew を追加
    if [[ -x /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
  else
    echo "Homebrew: インストール済み"
  fi

  # --- Go, libusb, pkg-config ---
  for pkg in go libusb pkg-config; do
    if ! brew list "$pkg" &>/dev/null; then
      echo "インストール中: $pkg"
      brew install "$pkg"
    else
      echo "$pkg: インストール済み"
    fi
  done
fi

# --- Node 依存 ---
echo ""
echo "Node 依存をインストールしています..."
npm install

# --- mtp-cli ビルド（macOS のみ）---
if [[ $SKIP_MTP_CLI -eq 0 ]]; then
  echo ""
  echo "MTP 用 mtp-cli をビルドしています..."
  MTP_CLI_DIR="${PROJECT_ROOT}/native/mtp-cli"
  if [[ ! -d "$MTP_CLI_DIR" ]]; then
    echo "警告: native/mtp-cli が見つかりません。MTP はスキップします。"
  else
    (
      cd "$MTP_CLI_DIR"
      go mod tidy
      CGO_ENABLED=1 go build -o mtp-cli . || {
        echo "mtp-cli ビルドに失敗しました。libusb: brew install libusb pkg-config を確認してください。"
        exit 1
      }
      mkdir -p "${PROJECT_ROOT}/resources/bin"
      cp -f mtp-cli "${PROJECT_ROOT}/resources/bin/mtp-cli"
      echo "mtp-cli を resources/bin/ に配置しました。"
    )
  fi
fi

echo ""
echo "== 環境構築完了 =="
echo ""
echo "起動方法:"
echo "  開発: npm run electron:dev"
echo "  ビルド: npm run electron:build"
echo ""
