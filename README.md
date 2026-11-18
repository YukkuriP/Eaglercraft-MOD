# Jar2Zeus

Minecraft MODのJARと移植先Eaglercraft HTMLをブラウザ内で解析し、Zeus用の移植パッケージと解析マニフェスト入りHTMLコピーを出力する実験ツールです。

## 使い方
1. `index.html` と `converter.js` を同じフォルダに置いて開く
2. インターネット接続がある状態でJARとEaglercraft HTMLを選択
3. 「両方を解析」を押す
4. 結果を確認し、ZIP出力する

## 現在実装している変換
- Fabric / Forge / NeoForgeのメタデータ検出
- JAR内のレシピJSONの検出
- 対応形式のレシピをZeus Lua APIへ変換
  - shaped crafting
  - shapeless crafting
  - smelting / blasting / smoking / campfire cooking
  - stonecutting
- レシピ以外のassets/dataリソースをZeusパッケージの正しい階層にコピー
- 変換済み・未対応・除外したレシピのレポートを出力
- 解析マニフェストを埋め込んだHTMLコピーを出力
- パストラバーサル対策、Lua文字列エスケープ、危険なコンテンツ名の除外

## 重要な制限
これはJAR全体の完全変換器ではありません。Javaバイトコード、Forge/Fabric/NeoForge API、Mixin、機械の動作やゲームプレイ処理は自動変換しません。ブロック・アイテムのJava登録処理も未変換です。レシピ変換は対応形式に限られ、結果アイテムや依存関係が移植先に存在しない場合は動作しません。

出力HTMLに埋め込むのは解析マニフェストだけです。HTMLへZeus本体やMOD機能を自動注入するものではありません。Zeus対応クライアントで、生成ZIPをMODとして別途読み込む必要があります。武器・砲撃などの機能は変換対象外です。

ZeusはEaglercraft 26.2 / 26.3向けです。古い1.8系・1.12系クライアントはZeus MODに対応しません。対象HTMLのバージョンとAPI互換性は必ず確認してください。

ファイルはブラウザ内で処理し、サーバーへ送信しません。JSZipをCDNから読み込むためインターネット接続が必要です。
