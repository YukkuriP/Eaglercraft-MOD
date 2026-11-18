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
- `cube_all` / `cube` / `cube_column` / `cube_bottom_top` / `cube_top` 系のフルキューブブロック登録\n- カスタム親モデルの継承、テクスチャ変数（`#side` 等）の解決\n- 上面・下面・側面・前面の別テクスチャ対応\n- 複数variantが同一モデルを使うブロックの登録（異なるモデルを混在させる状態は保留）
- `item/generated` / `item/handheld` と継承モデルのアイテム登録\n- 親モデルとして参照されているテンプレートモデルをアイテムとして誤登録しない
- 対応するPNGテクスチャのZeusパッケージ内配置
- 変換結果と未対応理由のレポート

## 大型MODの汎用解析
- Fabric / Forge / NeoForge / Quilt の形式を検出
- Java classファイルのバージョンと定数プール内クラス参照を解析（コード実行・完全デコンパイルはしない）\n- ブロック・アイテム、描画、ネットワーク、ワールド生成、GUI、音声、コマンド、保存領域などの機能群を棚卸しし、移植難易度の判断材料を出力
- Entrypoint、Mixin設定、Access Transformer、ServiceLoader、Jar-in-Jarを検出
- 依存関係とMinecraftバージョン候補を抽出
- assets / data内のテクスチャ、モデル、blockstates、レシピ、タグ、言語、音声、シェーダー、設定を分類
- 大型JAR向けにclassを逐次解析し、全classバイト列を同時保持しない
- 同じMOD内に対象外機能が含まれていても、無関係な安全なリソースは個別に解析・抽出
- 変換処理をアダプター方式に分離し、工程ごとの追加実装・失敗隔離が可能\n- `generic-analysis.json`、`conversion-assessment.json`、`source-mod.json`、`adapter-report.json` を出力

## 出力パッケージの上限
Zeus公式のパッケージ制限に合わせ、移植先パッケージは展開後4,096ファイル・64 MiB以内に制限します。超過する素材は黙って欠落させず、出力レポートに記録し、完全な移植成功とは判定しません。JARの解析自体にもブラウザ・端末のメモリ上限があります。

## 制限
任意のJavaバイトコード、Forge/Fabric API、Mixin、独自機械処理、複雑なモデル・状態・アニメーションを自動移植するものではありません。単純モデル以外は未対応としてレポートします。生成したMODはZeus対応Eaglercraft 26.2 / 26.3で実機確認が必要です。Zeusの公式パッケージ形式（metadata.json / main.lua / assets / data）に沿って出力します。Zeusのブロック・アイテム追加機能は自分のワールド向けで、サーバー側にMOD機能が追加されるわけではありません。

HTMLに解析マニフェストを追加したコピーも出力しますが、ゲーム本体を改造するものではありません。Javaコードの完全自動変換は保証しません。武器・砲撃機能は変換対象外です。

JSZipをCDNから読み込むためインターネット接続が必要です。JARとHTMLの内容はブラウザ内で処理され、サーバーへ送信しません。
