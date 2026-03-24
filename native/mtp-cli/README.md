# sTune MTP CLI

sTune が MTP デバイス（Walkman 等）に転送するために使う CLI。  
**ユーザー向けの「どうすればいいか」は [../docs/MTP_セットアップ.md](../docs/MTP_セットアップ.md) を参照してください。**  
go-mtpx（[ganeshrvel/go-mtpx](https://github.com/ganeshrvel/go-mtpx)）を利用し、標準入出力で JSON コマンドを受け取り結果を返す。

## 前提

- macOS（Intel / Apple Silicon）
- Go 1.19+
- libusb: `brew install libusb pkg-config`
- CGO 有効

## ビルド

```bash
cd native/mtp-cli
go mod tidy   # 未取得の場合は go get github.com/ganeshrvel/go-mtpx@master
CGO_ENABLED=1 go build -o mtp-cli .
```

- **macOS**: `brew install libusb pkg-config` を事前に実行してください。
- ビルド後、`mtp-cli` を sTune の `resources/bin/` に置くか、**OpenMTP をインストールしている**場合は sTune が自動で OpenMTP 内の mtp-cli を検出します（`/Applications/OpenMTP.app/Contents/Resources/bin/mtp-cli`）。

## プロトコル（1 行 1 JSON）

- **入力**: 標準入力に 1 行で JSON オブジェクトを送る。
- **出力**: 標準出力に 1 行で JSON オブジェクトを返す。

### コマンド

| cmd | 説明 | 入力例 | 出力例 |
|-----|------|--------|--------|
| `list_storages` | デバイス接続・ストレージ一覧取得 | `{"cmd":"list_storages"}` | `{"storages":[{"storageId":"...","description":"...","maxCapacity":0,"freeSpaceInBytes":0}],"deviceName":"WALKMAN"}` |
| `list_files` | 指定パスのファイル一覧 | `{"cmd":"list_files","storageId":"...","path":"/MUSIC"}` | `{"files":[{"objectId":1,"name":"...","fullPath":"/MUSIC/...","size":0,"isDir":false}]}` |
| `upload` | ローカルファイルを MTP へアップロード | `{"cmd":"upload","storageId":"...","source":"/local/path","destination":"/MUSIC"}` | `{"ok":true}` または `{"error":"..."}` |

## 参考

- [go-mtpx](https://github.com/ganeshrvel/go-mtpx)
- [OpenMTP](https://github.com/ganeshrvel/openmtp)
