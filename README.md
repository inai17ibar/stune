# sTune

Mac と Sony Walkman 向けの音楽管理・転送アプリ（Electron + React）。

## 初回環境構築

**初めてリポジトリをクローンした人**は、次のいずれかで環境をそろえてください。

```bash
# 方法 A: シェルスクリプトで一括セットアップ（推奨）
./scripts/setup.sh

# 方法 B: npm から実行
npm run setup
```

これで以下が行われます。

- **macOS**: Homebrew が無ければ案内、Go・libusb・pkg-config のインストール、Node 依存の `npm install`、MTP 用 **mtp-cli** のビルドと `resources/bin/` への配置
- **その他 OS**: Node 依存の `npm install` のみ（MTP 用ビルドはスキップ）

**setup 実行後は sTune を再起動してください**（MTP 用バイナリを読み込むため）。

## 起動・ビルド

```bash
# 開発で起動
npm run electron:dev

# 配布用にビルド
npm run electron:build
```

## MTP 対応の Walkman について

- **方法 1（推奨）**: 上記 `./scripts/setup.sh` を実行すると、mtp-cli がビルドされ `resources/bin/` に置かれ、sTune から MTP 機種を認識・転送できます。
- 詳細は [docs/MTP_セットアップ.md](docs/MTP_セットアップ.md) を参照してください。

## 技術スタック

- Electron, React, TypeScript, Vite
- MTP: go-mtpx ベースの CLI（`native/mtp-cli`）
