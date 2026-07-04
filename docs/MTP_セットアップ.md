# MTP 対応の Walkman を sTune で使うには

**「mtp-cli を用意する」＝ Mac で MTP とやりとりするための小さなプログラム（mtp-cli）を、次のどちらかで用意する、という意味です。**

---

## 方法 1: 自分で mtp-cli をビルドする（推奨）

**Mac にインストールするもの**

- **Homebrew**（まだなら [brew.sh](https://brew.sh) でインストール）
- **Go**（`brew install go`）
- **libusb**（`brew install libusb pkg-config`）

**手順**

初回は **環境構築用スクリプト** を実行するだけで、上記のインストール・ビルド・配置までまとめて行われます。

```bash
# プロジェクトのルートで（初回のみ）
./scripts/setup.sh
# または
npm run setup
```

手動でやりたい場合は、次を実行します。

```bash
cd native/mtp-cli
go mod tidy
CGO_ENABLED=1 go build -o mtp-cli .
mkdir -p ../../resources/bin
cp mtp-cli ../../resources/bin/
```

**sTune をいったん終了し、あらためて起動**（`npm run electron:dev` やパッケージ後のアプリ）すると、MTP の Walkman が「WALKMAN」一覧に表示され、転送もできるようになります。**setup 実行後は必ずアプリを再起動してください。**

**まとめ**: 「Mac に Go と libusb を入れて、リポジトリ内で mtp-cli を 1 回ビルドし、`resources/bin/` に置く」だけです。**別の「sTune 以外のアプリを 2 つインストールする」必要はありません。**

---

## 方法 2: OpenMTP を Mac にインストールする

1. [OpenMTP](https://openmtp.ganeshrvel.com/) の公式サイトから Mac 用をダウンロードしてインストールする。
2. sTune は、インストールされた OpenMTP アプリの中にある **mtp-cli** を自動で探して使おうとします。

**注意**: OpenMTP の mtp-cli は、sTune が期待する「1 行 JSON のやりとり」と違う仕様の可能性があります。その場合は方法 1 でビルドした mtp-cli を使う必要があります。

---

## どちらもやらない場合

- **USB でストレージとして認識される Walkman**（一部の機種や接続モード）は、これまでどおり **mtp-cli なし**で sTune から使えます（Finder に WALKMAN が表示される場合）。
- **MTP 専用の機種**（Finder に一切出ないタイプ）は、上記のどちらかで mtp-cli を用意しないと、sTune では検出・転送できません。

---

## NW-A306（NW-A300 系）の場合

1. USB Type-C で Mac と接続する。
2. Walkman に「USBの接続用途」が出たら **「ファイル転送」** を選ぶ（「充電のみ」では検出されません）。
3. sTune は約 3 秒ごとに検出するので、5〜10 秒ほど待つ。
4. まだ出ない場合: ケーブルを抜き差しし、もう一度「ファイル転送」を選んで試す。

### 接続確認コマンド（ターミナル）

Walkman を USB で接続し「ファイル転送」を選んだ状態で、次を実行します。

```bash
cd プロジェクトのパス
echo '{"cmd":"list_storages"}' | ./resources/bin/mtp-cli
```

- **デバイスが検出された場合**: `{"storages":[...],"deviceName":"..."}` のような JSON が表示されます。sTune を再起動すると WALKMAN 一覧に出る可能性が高いです。
- **`{"error":"no MTP devices found"}` の場合**: まだ認識されていません。ケーブル・「ファイル転送」の選択・USB ポートを確認し、もう一度試してください。

### LIBUSB_ERROR_NOT_FOUND が出る場合

`OpenSession failed: LIBUSB_ERROR_NOT_FOUND` や `OpenSession after reset: LIBUSB_ERROR_NOT_FOUND` は、**macOS で libusb が USB デバイスを開けない**ときに出る既知の現象です（go-mtpfs / go-mtpx で報告あり）。

**試せること**

1. **他のアプリを終了する**  
   OpenMTP・Android File Transfer・Finder で WALKMAN を開いている場合は閉じる。
2. **ケーブルを抜き、もう一度「ファイル転送」で接続する**  
   接続直後に再度 `echo '{"cmd":"list_storages"}' | ./resources/bin/mtp-cli` を実行。
3. **sTune から試す**  
   ターミナルではなく、sTune を起動したまま Walkman を接続し、WALKMAN 一覧に出るか確認する（アプリ経由だと権限が違う場合があります）。
4. **OpenMTP で転送する**  
   同じ Mac・同じ機種で [OpenMTP](https://openmtp.ganeshrvel.com/) をインストールし、OpenMTP で転送できるか確認する。OpenMTP でだけ動く場合は、その Mac では libusb まわりの制約で sTune の mtp-cli が使えない可能性があります。

**補足**: OpenMTP は別の方式（Kalam 等）で USB を扱っているため、OpenMTP では動くが sTune の mtp-cli では LIBUSB_ERROR_NOT_FOUND になる、という組み合わせがあり得ます。

### 推奨ワークアラウンド（OpenMTP で転送できる場合）

**同じ Mac で OpenMTP なら転送できる**ことが確認できた場合は、次の運用を推奨します。

- **転送**: [OpenMTP](https://openmtp.ganeshrvel.com/) で NW-A306 へ音楽を転送する。
- **sTune**: ライブラリの管理（フォルダ登録・メタデータ・プレイリスト感覚の選曲）と、**USB でマウントされる Walkman**（Finder に WALKMAN が出る機種・接続）での転送に使う。

sTune の MTP 対応（mtp-cli）は、環境によっては libusb の制約で使えませんが、上記の組み合わせで運用できます。

---

## 用語の整理

| 用語 | 意味 |
|------|------|
| **mtp-cli** | sTune が MTP デバイスと通信するために使う、コマンドラインの小さなプログラム。sTune に「同梱」するか、OpenMTP アプリ内のものを「利用」する。 |
| **「mtp-cli を用意する」** | 上記のプログラムを、ビルドして `resources/bin/` に置くか、OpenMTP をインストールして sTune に探させること。 |
| **Mac に 2 つインストール** | 不要。sTune は 1 本。もう 1 つは「mtp-cli という小さな実行ファイル」をビルドして置くだけ（または OpenMTP を 1 つ入れる、という選択肢）。 |
