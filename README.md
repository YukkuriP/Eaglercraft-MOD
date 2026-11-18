# Jar2Zeus

Minecraft MODのJARと移植先Eaglercraft HTMLをブラウザ内で解析し、Zeus向けの移植作業パッケージを出力する実験ツールです。

## 使い方
1. `index.html`、`converter.js`、`resource-converter.js` を同じフォルダに置いて開く
2. インターネット接続がある状態でJARとEaglercraft HTMLを選択
3. 「両方を解析」を押す
4. 結果を確認し、ZIP出力する

## 実装済み
- Fabric / Forge / NeoForgeメタデータの検出
- 対応形式のレシピJSONをZeus Lua形式へ変換（shaped / shapeless / smelting / blasting / smoking / campfire / stonecutting）
- ブロック・アイテム・流体・エンティティタグの安全なインデックス化
- 言語ファイルの翻訳キー抽出
- モデル・blockstatesの参照一覧を作成
- assets / dataリソースの抽出
- 変換済み・未対応・除外内容のレポート
- パストラバーサル対策、Lua文字列エスケープ

## 出力
- `main.lua`: 対応したレシピ変換コード
- `resource-index.json`: タグ・翻訳・モデル・blockstatesの索引
- `conversion-report.json`: レシピ変換結果
- `report.json`: JARとHTMLの解析結果
- `output/*.jar2zeus.html`: 解析マニフェストを埋め込んだHTMLコピー
- `assets/` と `data/`: 対象リソース

## 重要な制限
これはJAR全体の完全変換器ではありません。Javaバイトコード、Forge/Fabric/NeoForge API、Mixin、機械の動作やゲームプレイ処理は自動変換しません。タグ・翻訳・モデル情報はZeus APIの互換性が確認できていないため、実行コードではなく索引データとして出力します。出力HTMLへのマニフェスト埋め込みはMOD機能の実装・動作を意味しません。武器・砲撃などの機能は変換対象外です。

Zeus対応クライアントとAPIの互換性を確認し、生成したパッケージは実際のゲーム内で検証してください。JSZipをCDNから読み込むためインターネット接続が必要です。ファイル本体はブラウザ内で処理し、サーバーへ送信しません。
