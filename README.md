# Jar2Zeus

Minecraft MODのJARと移植先Eaglercraft HTMLを解析し、対応する一部機能を実際のZeus Lua MODとして出力するブラウザツールです。

## 使い方
1. `index.html`、`converter.js`、`resource-converter.js`、`definition-converter.js` を同じフォルダに置く
2. インターネット接続がある状態でJARとEaglercraft HTMLを選択
3. 「両方を解析」→「インポート用Zeus MOD ZIP＋診断レポートを出力」
4. 出力された外側ZIPを展開し、`<mod-id>-zeus-mod.zip` を取り出す。このZIPは `metadata.json` と `main.lua` が直下にある単体Zeus MODパッケージ
5. Eaglercraft 26.2 / 26.3のModsメニューから単体MOD ZIPをインポートし、有効化してページを再読み込みする

**注意：** アップロードしたHTMLは互換性の手掛かりを調べるだけで、ゲーム本体にMOD機能を注入しません。Zeus非対応の1.8 / 1.12クライアントではこのMOD ZIPは動きません。

## 実際にZeus Luaへ変換する範囲
- shaped / shapeless crafting
- smelting / blasting / smoking / campfire cooking / stonecutting
- `cube_all` / `cube` / `cube_column` / `cube_bottom_top` / `cube_top` 系のフルキューブブロック登録\n- カスタム親モデルの継承、テクスチャ変数（`#side` 等）の解決\n- 上面・下面・側面・前面の別テクスチャ対応\n- 複数variantが同一モデルを使うブロックの登録（異なるモデルを混在させる状態は保留）
- `item/generated` / `item/handheld` と継承モデルのアイテム登録\n- 親モデルとして参照されているテンプレートモデルをアイテムとして誤登録しない
- 対応するPNGテクスチャのZeusパッケージ内配置
- 変換結果と未対応理由のレポート

## 対象HTMLの内部構造解析（追加）

MOD入りEaglercraft HTMLを参考資料として指定すると、対象HTMLを実行せずに内部コンテナを検査します。

- Base64の `assetsURI` をバイナリとして取り出し、EPW（`EAG$WASM`）形式を識別
- EPWヘッダーのサイズ・オフセット範囲、loader.js、loader.wasmを検証
- EPW内のXZ圧縮領域を展開し、WASM領域とEPK資産パッケージを識別
- EPK v2の `Z`（deflate）、`G`（gzip）、`0`（非圧縮）を読み、レコード件数・CRC32・パス・重複を検査
- テクスチャ、モデル（JSON/OBJ/MTL/IE）、ブロックステート、レシピ、音声、言語などの資産を分類
- 任意の参考HTMLを追加し、EPK内のファイル追加・削除・変更を比較
- WASMセクションやTeaVM関連文字列を調査。ただし文字列の存在は特定MODの動作実装を証明しない

XZ展開にはブラウザ用 `xzwasm`、EPKの圧縮展開には `pako` をCDNから読み込みます。学校・職場などでCDNが制限される場合は、ライブラリをローカル配置する必要があります。

**重要：** この分析で確認できるのは完成済みクライアントのコンテナ・資産構造です。WASM内のJavaコードを元のJavaソースに完全復元したり、別バージョンのゲームへそのまま移植したりはできません。MODの動的処理は対象ランタイムに合わせた再実装とゲーム内テストが必要です。対象HTMLへの自動注入・任意JARの完全移植を保証する機能ではありません。

## テスト

Node.js 22以降で次を実行します。

```sh
node --test tests/*.test.js
```

EPW/EPKの構造、CRC32、複数圧縮方式、比較機能のテストを含みます。テスト用の小さな合成データによる検証であり、実際のゲームでの動作テストとは異なります。

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

出力物は、Zeusが直接インポートできる単体MOD ZIPと診断レポートZIPです。アップロードしたHTMLは解析のみで、ゲーム本体を改造しません。Javaコードの完全自動変換は保証しません。安全上の理由から武器・砲撃機能は変換対象外です。

JSZipをCDNから読み込むためインターネット接続が必要です。JARとHTMLの内容はブラウザ内で処理され、サーバーへ送信しません。
