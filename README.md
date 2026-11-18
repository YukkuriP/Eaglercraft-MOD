# Jar2Zeus

ブラウザでMinecraft MODのJARを解析し、Zeus向け移植用ZIPのひな型を生成する実験ツールです。

## 使い方
1. GitHub PagesまたはローカルHTTPサーバーで `index.html` を開く
2. `.jar` を選択して「解析する」
3. 「Zeus用ZIPを生成」でパッケージを保存
4. Eaglercraft 26.2 / 26.3 のZeusにZIPを読み込む

## 現在の機能
- Fabric / Forge / NeoForgeのメタデータ検出
- MOD ID、バージョン、依存関係の検出
- Javaクラス数とリソース数の集計
- `assets/` と `data/` の抽出
- Zeus形式の `metadata.json` + `main.lua` + レポートZIP生成

## 重要な制限
これは完全変換器ではありません。Javaバイトコード、Forge/Fabric/NeoForge API、Mixin、ゲームプレイ処理をLua/WASMへ自動変換しません。生成ZIPは移植用の土台であり、動作する変換済みMODではありません。各機能はZeus API向けに再実装・検証が必要です。

現在のページはJSZipをCDNから読み込むため、Web版の利用にはインターネット接続が必要です。ローカルZIP配布版には依存ライブラリを同梱したオフライン版も用意しています。
