# MTP 対応の方向性：OpenMTP の活用

Mac では MTP デバイス（多くの Walkman）が標準で `/Volumes` にマウントされないため、**OpenMTP** のようなソフトを使うと接続確認とファイル転送が可能になる。配布されている OpenMTP アプリは使いにくい面があるため、次のいずれかが現実的。

---

## 現状の整理

| 項目 | 内容 |
|------|------|
| **sTune** | `/Volumes` のポーリングで「USB ストレージとしてマウントされた Walkman」のみ検出。MTP 機種は検出できない。 |
| **OpenMTP** | Electron + Go（go-mtpx）。MTP で接続・転送可能。macOS（Intel / Apple Silicon）対応。MIT。 |
| **go-mtpx** | OpenMTP のコア。go-mtpfs ベースの MTP レイヤー。 |

---

## 選択肢 A：OpenMTP の OSS を改良する

- **やること**  
  [ganeshrvel/openmtp](https://github.com/ganeshrvel/openmtp) を fork し、UI/UX を改良する。
- **利点**  
  - 既存の MTP 実装（go-mtpx）をそのまま使える。  
  - コア部分に手を入れず、フロント（Electron）中心の変更で済む。  
- **注意**  
  - 汎用「Android ファイル転送」アプリの改善になり、sTune のような「音楽管理特化」にはしづらい。  
  - アップストリームとの追従や、UI の大改修が必要なら負荷は増える。

**向いているケース**  
「Mac で MTP 転送をしやすくしたい」というニーズが主で、sTune と別アプリのままでよい場合。

---

## 選択肢 B：OSS を組み込んだアプリを新たに作る（sTune に MTP を組み込む）

- **やること**  
  - sTune を「音楽ライブラリ管理 + Walkman（USB マウント & MTP）への転送」に特化した 1 本のアプリとして再構成する。  
  - MTP 部分は OpenMTP のコア（go-mtpx）を **サブプロセス or 同梱バイナリ** として組み込む。
- **利点**  
  - 音楽管理と転送が一つのアプリにまとまる。  
  - Walkman / 音楽用途に UI を絞れる（転送先を MUSIC に限定、プレイリスト対応など）。  
- **技術的な検討**  
  - go-mtpx が **CLI や RPC のようなインターフェース** を提供しているか確認する。  
  - 提供されていれば、Electron の main プロセスから子プロセスとして起動し、  
    - デバイス一覧の取得  
    - 転送（送信・受信）  
    を Node から制御する形が現実的。  
  - もし「FUSE マウントのみ」なら、  
    - 一時ディレクトリにマウント → 現在の sTune の「`/Volumes` 相当のパス」として扱う、  
    といった統合も可能（macOS で FUSE が使える環境が前提）。

**向いているケース**  
「sTune だけで、USB マウント機種も MTP 機種も扱いたい」というニーズが強い場合。

---

## 選択肢 C：A と B のハイブリッド

- OpenMTP 本体の UI 改善（A）はコミュニティや別 fork に任せつつ、  
- sTune では「MTP 対応」だけ go-mtpx を組み込む（B）。  
- 必要なら、go-mtpx の改善パッチを OpenMTP や go-mtpx リポジトリに PR して返す。

---

## 実装状況（B を採用済み）

1. **MTP サービス**（`electron/services/mtp.ts`）  
   - `mtp-cli` バイナリを検出（同梱 `resources/bin` または OpenMTP アプリ内）。  
   - JSON 1 行入出力で `list_storages` / `list_files` / `upload` を実行。
2. **デバイス検出**（`electron/services/device.ts`）  
   - USB マウント（`/Volumes`）と MTP デバイスを統合。  
   - `getConnectedWalkman()` が両方の一覧を返す。
3. **スキャン・転送**  
   - `mountPath` が `mtp://...` のときは `scanMtpDevice` で MTP 上をスキャン。  
   - 転送先が `mtp://...` のときは `mtpUpload` で MTP にアップロード。
4. **native/mtp-cli**  
   - go-mtpx を利用する Go 製 CLI。  
   - ビルド手順は `native/mtp-cli/README.md` を参照。  
   - ビルドした `mtp-cli` を `resources/bin/` に置くとパッケージに同梱される。

---

## 参考リンク

- [OpenMTP (GitHub)](https://github.com/ganeshrvel/openmtp)  
- [go-mtpx (OpenMTP のコア)](https://github.com/ganeshrvel/go-mtpx)  
- [go-mtpfs (ベースライブラリ)](https://github.com/hanwen/go-mtpfs)  
- [ソニー公式: Mac がウォークマンを認識しない場合](https://knowledge.support.sony.jp/electronics/support/articles/00234112)
