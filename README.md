# Jar2Zeus

Minecraft MODのJARと移植先Eaglercraft HTMLを解析し、対応する一部機能を実際のZeus Lua MODとして出力するブラウザツールです。

## 使い方
1. `index.html`、`converter.js`、`resource-converter.js`、`definition-converter.js` を同じフォルダに置く
2. インターネット接続がある状態でJARとEaglercraft HTMLを選択
3. 「両方を解析」→「ZIP出力」
4. ZIP内の `migration-package/main.lua` と `metadata.json`、`textures/` をZeus MODとして確認・読み込み

## 実際にZeus Luaへ変換する範囲
- shaped / shapeless crafting
- smelting / blasting / smoking / campfire cooking / stonecutting
- 単純な cube_all 等のブロックモデルを持つブロックの登録
- item/generated の単純なアイテム登録
- 対応するPNGテクスチャのZeusパッケージ内配置
- 変換結果と未対応理由のレポート

## 解析・素材抽出
- Fabric / Forge / NeoForgeメタデータ検出
- タグ、翻訳、モデル、blockstatesの索引化
- assets / dataリソース抽出

## 制限
任意のJavaバイトコード、Forge/Fabric API、Mixin、独自機械処理、複雑なモデル・状態・アニメーションを自動移植するものではありません。単純モデル以外は未対応としてレポートします。生成したMODはZeus対応Eaglercraft 26.2 / 26.3で実機確認が必要です。Zeusのブロック・アイテム追加機能は自分のワールド向けで、サーバー側にMOD機能が追加されるわけではありません。

HTMLに解析マニフェストを追加したコピーも出力しますが、ゲーム本体を改造するものではありません。Javaコードの完全自動変換は保証しません。武器・砲撃機能は変換対象外です。

JSZipをCDNから読み込むためインターネット接続が必要です。JARとHTMLの内容はブラウザ内で処理され、サーバーへ送信しません。
