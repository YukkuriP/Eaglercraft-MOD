# Jar2Zeus

**Minecraft MOD JARを解析し、Eaglercraft Zeus向けのLua MODへ移植するブラウザツール**です。

移植先HTMLのアップロードは不要です。JARを選び、Zeusの対象ゲーム版（26.2 / 26.3）を指定します。

## 使い方

1. `index.html` と次のJavaScriptファイルを同じフォルダに置きます。
   - `converter.js`
   - `resource-converter.js`
   - `definition-converter.js`
   - `generic-mod-analyzer.js`
   - `java-bytecode-analyzer.js`
   - `java-reimplementation-engine.js`
   - `migration-pipeline.js`
   - `zeus-api-contract.js`
   - `package-validator.js`
2. ブラウザで `index.html` を開き、変換するJARを選択します。
3. 対象のZeusバージョン（26.2または26.3）を選び、「JARを解析して再実装を開始」を押します。
4. 解析結果を確認し、「Zeus MOD ZIP＋再実装レポートを出力」を押します。
5. 出力された外側ZIPを展開し、`<mod-id>-zeus-mod.zip` をEaglercraftのModsメニューからインポートします。

JSZipをCDNから読み込むため初回利用時にインターネット接続が必要です。JARの内容はブラウザ内で処理し、サーバーには送信しません。

## 変換パイプライン

- **JAR解析:** Fabric / Forge / NeoForge / Quiltのメタデータ、依存関係、Mixin、Access Transformer、Jar-in-Jar等を検出します。
- **Java解析:** クラスファイルの定数プール、メソッド、JVM命令、分岐、フィールド参照、メソッド呼び出しを解析します。アップロードされたJavaコードは実行しません。
- **リソース移植:** 対応するレシピ、単純なブロック・アイテムモデル、テクスチャ等をZeus形式に変換します。
- **Java処理の再実装:** 安全な限定範囲のJavaメソッドをLuaへ変換します。残りは機能別の再実装タスクとして整理し、未対応理由と参照したJava APIをレポートします。
- **検証と梱包:** 生成LuaのZeus API呼び出しを静的検査し、`metadata.json` と `main.lua` を含むMOD ZIPを生成します。

## Java再実装の現在の対応範囲

現在の自動バイトコード翻訳は、分岐・例外・フィールドアクセスを含まない純粋な整数型 `static` 補助メソッドの一部に限定しています。整数演算・ビット演算と、許可リストにある `java.lang.Math` の `abs` / `min` / `max` をLua関数に変換します。

ゲーム内の登録処理、イベント処理、独自機械、GUI、描画、ネットワーク等は、Java側の意味を読み取っただけでZeus上の同等機能になるわけではありません。Zeus APIに対応する機能アダプターの再実装が必要です。現在のレポートはその残作業を隠さず表示します。したがって、任意のJARが完全移植できる、あるいはZIPを入れれば必ず元MODと同じ動作になる、とは保証しません。

## 出力ファイル

- `<mod-id>-zeus-mod.zip`: ZeusへインポートするMOD本体。`metadata.json` と `main.lua` がZIP直下にあります。
- `diagnostics/report.json`: JAR・変換・パッケージ全体の診断。
- `diagnostics/reimplementation-report.json`: Javaメソッドごとの変換状況。
- `diagnostics/reimplementation-plan.json`: 未実装機能の再実装タスク。
- `diagnostics/api-validation.json`: 使用したZeus APIの静的検証結果。
- `diagnostics/zeus-runtime-probe.lua`: 対象ゲーム内でAPIの存在を確認する読み取り専用プローブ。

Zeusのパッケージ制限に合わせ、展開後4,096ファイル・64 MiB以内を検査します。超過や欠落があればレポートに記録します。

## Zeus APIと対象バージョン

Eaglercraftの公式Modding資料に基づき、Zeus Lua API v1 / Eaglercraft 26.2・26.3を対象にしています。1.8 / 1.12クライアントはZeus MODに対応していません。

- API Reference: https://dev.eaglercraft.com/docs/modding/api
- Blocks, items and mobs: https://dev.eaglercraft.com/docs/modding/blocks-items-and-mobs
- Events and timers: https://dev.eaglercraft.com/docs/modding/events-and-timers
- Packaging: https://dev.eaglercraft.com/docs/modding/packaging

静的検証はAPI名やパッケージ構造を調べるもので、対象ゲーム内での表示・動作成功を証明しません。実際のワールドで確認してください。

## 安全上の制限

安全上扱えない機能群は変換対象から除外します。JARは実行せず、クラスファイルとリソースを静的に解析します。
