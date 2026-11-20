# Jar2Zeus

**Minecraft MOD JARを解析し、Eaglercraft Zeus向けのLua MODへ移植するブラウザツール**です。

移植先HTMLのアップロードは不要です。JARを選び、Zeusの対象ゲーム版（26.2 / 26.3）を指定します。

## 使い方

1. `index.html` と次のJavaScriptファイルを同じフォルダに置きます。
   - `converter.js`
   - `config-converter.js`
   - `resource-converter.js`
   - `definition-converter.js`
   - `entity-model-converter.js`
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
- **Java解析:** クラスファイルの定数プール、メソッド、JVM命令、分岐、フィールド参照、メソッド呼び出しを解析します。整数定数は定数プールの型タグまで確認し、float/doubleを整数として誤変換しません。アップロードされたJavaコードは実行しません。
- **リソース移植:** 対応するレシピ、ブロック状態、ブロック・アイテムモデル、テクスチャ等をZeus形式に変換します。標準レシピJSONは元のgroup/category/show_notification等を保持して `recipes.add` で登録します。
- **設定データ:** 単純なJSON/TOML/propertiesのスカラー設定をZeusの設定画面と `mod.export.jar2zeus.config.get()` に移します。秘密情報らしいキーは除外し、元Javaの設定読み取りAPIは自動置換しません。対応するモデルJSONは簡易テクスチャへ潰さず、ZIP内に保持してZeusの `model` 定義から参照します。MOD IDと異なる素材名前空間は誤登録を防ぐため未対応としてレポートします。
- **3Dエンティティモデル:** 対応するBlockbench/Bedrock形式のgeometry JSONをZeusの `entities.register` 用モデル定義へ変換します。ボーン階層、パーツ、キューブ、UV、ピボット、回転、ミラー、inflateを扱い、対応するPNGテクスチャを同梱します。
- **モーション:** Zeus公式仕様にある `head` / `leg` / `arm` / `spin` / `bob` / `wing` のパーツモーションへ、ボーン名とアニメーション名から安全に対応付けられる範囲を変換します。独自キーフレームの時刻・補間・任意ボーン曲線は同じ意味で再現できないため、アニメーション診断に未移植として記録します。
- **Java処理の再実装:** 安全な限定範囲のJavaメソッドをLuaへ変換します。残りは機能別の再実装タスクとして整理し、未対応理由と参照したJava APIをレポートします。
- **検証と梱包:** 生成LuaのZeus API呼び出しを静的検査し、`metadata.json` と `main.lua` を含むMOD ZIPを生成します。

## Java再実装の現在の対応範囲

現在の自動バイトコード翻訳は、Javaの状態変更や外部API呼び出しを含まない、整数・真偽値などのプリミティブ型 `static` 補助メソッドの限定された命令セットに対応します。変換前に制御フロー全体のオペランドスタック高・分岐先・`max_stack`・`max_locals`・ローカル変数の初期化状態を検証し、条件分岐の合流点でスタック状態が一致しないメソッドや不正なメソッドは変換しません。整数定数はJVM定数プールのInteger型だけを受け入れます。条件分岐、ループ、整数演算、ビット演算と、許可リストにある `java.lang.Math` の `abs` / `min` / `max` を、実行ステップ上限付きのLua関数に変換します。Lua 5.4上でJavaの32bit符号付き整数の折り返し、ゼロ除算例外、ゼロ方向への整数除算を再現する補助関数を生成します。

3Dモデル変換はBedrock/Blockbench系のボーン＋キューブ形式のうち、Zeusが受け付けるUV・パーツ構造に合うものが対象です。Javaコード内で組み立てられる独自モデル、任意のレンダラー、複雑な面別UV、独自シェーダーは自動移植できるとは限りません。独自アニメーションのキーフレーム曲線も、Zeusの組み込みモーション名だけでは完全再現できません。

機械アニメーションの解析では、ギア・車輪・ファン・ローターなど、ループする回転キーフレームを持つリグパーツをZeusの組み込み `spin` に近似マッピングします。これは連続回転への近似で、元のキーフレーム時間・回転曲線は保持しません。ピストンやコンベアの直線移動、ドア・バルブ・レバーの角度制限付き回転、およびJavaのblock-entity tick / rendererによる機械ブロックの動作は、現行のZeus公式APIでは同等に表現できないため未移植として `machine-animation-report.json` に記録します。

設定値の移行はユーザーが変更できるZeus設定を作るもので、元のJavaコードの設定参照を置き換えるものではありません。ゲーム内の登録処理、イベント処理、独自機械、GUI、描画、ネットワーク等は、Java側の意味を読み取っただけでZeus上の同等機能になるわけではありません。Zeus APIに対応する機能アダプターの再実装が必要です。現在のレポートはその残作業を隠さず表示します。したがって、任意のJARが完全移植できる、あるいはZIPを入れれば必ず元MODと同じ動作になる、とは保証しません。

## 出力ファイル

- `<mod-id>-zeus-mod.zip`: ZeusへインポートするMOD本体。`metadata.json` と `main.lua` がZIP直下にあります。
- `diagnostics/report.json`: JAR・変換・パッケージ全体の診断。
- `diagnostics/reimplementation-report.json`: Javaメソッドごとの変換状況。
- `diagnostics/reimplementation-plan.json`: 未実装機能の再実装タスク。
- `diagnostics/entity-model-report.json`: 3D形状・ボーン・モーションの変換結果と未対応アニメーション。
- `diagnostics/api-validation.json`: 使用したZeus APIの静的検証結果。
- `diagnostics/zeus-runtime-probe.lua`: 対象ゲーム内でAPIの存在を確認する読み取り専用プローブ。

Zeusのパッケージ制限に合わせ、展開後4,096ファイル・64 MiB以内を検査します。超過や欠落があればレポートに記録します。

## Zeus APIと対象バージョン

Eaglercraftの公式Modding資料に基づき、Zeus Lua API v1 / Eaglercraft 26.2・26.3を対象にしています。1.8 / 1.12クライアントはZeus MODに対応していません。

- API Reference: https://dev.eaglercraft.com/docs/modding/api
- Blocks, items and mobs: https://dev.eaglercraft.com/docs/modding/blocks-items-and-mobs
- Events and timers: https://dev.eaglercraft.com/docs/modding/events-and-timers
- Packaging: https://dev.eaglercraft.com/docs/modding/packaging

ZeusのLuaランタイムは公式資料に記載されたLua 5.4を前提にします。PNGはチャンク境界・CRC・IHDR/IDAT/IENDを検査し、不正なPNGは定義・エンティティ変換アダプターへ渡しません。静的検証はAPI名やパッケージ構造を調べるもので、対象ゲーム内での表示・動作成功を証明しません。ブロック・アイテム等の追加は、自分が開いたシングルプレイまたはLANワールド向けで、通常のサーバーが新しいブロックやアイテムを認識するわけではありません。実際のワールドで確認してください。

## 安全上の制限

安全上扱えない機能群は変換対象から除外します。JARは実行せず、クラスファイルとリソースを静的に解析します。
