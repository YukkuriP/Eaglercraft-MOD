# Jar2Zeus

**Minecraft MOD JARを解析し、Eaglercraft Zeus向けのLua MODへ移植するブラウザツール**です。

移植先HTMLのアップロードは不要です。JARを選び、Zeusの対象ゲーム版（26.2 / 26.3）を指定します。

## 使い方

1. `index.html` と次のJavaScriptファイルを同じフォルダに置きます。
   - `archive-inspector.js`
   - `converter.js`
   - `config-converter.js`
   - `resource-converter.js`
   - `definition-converter.js`
   - `entity-model-converter.js`
   - `bytecode-verifier.js`
   - `bytecode-analysis.js`
   - `class-object-analyzer.js`
   - `java-type-compat.js`
   - `generic-mod-analyzer.js`
   - `fabric-api-compat.js`
   - `minecraft-internal-api-compat.js`
   - `java-event-lifecycle.js`
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

## ZIP/JARの事前検査

`archive-inspector.js` はZIP中央ディレクトリと各ローカルファイルヘッダーを、JSZipがファイルを展開する前に読み取ります。ZIP64、圧縮方式（Stored / Deflate）、CRC・サイズ情報、データ範囲、ファイル名の一致、重複パス、危険なパス、シンボリックリンク、暗号化、入れ子JARの数などを確認します。暗号化、分割ZIP、未対応圧縮方式、重複・不正パス、壊れたヘッダー、異常な圧縮率やサイズ超過を検出した場合は、展開前に処理を停止します。

初期上限は圧縮入力256 MiB、エントリー50,000件、単一ファイルの展開後64 MiB、全ファイル合計512 MiB、圧縮率1,000:1です。これらはブラウザでのメモリ消費とZIP爆弾対策のための事前検査上限であり、Minecraft MOD仕様そのものの制限ではありません。大容量のMODは現状この上限により処理できない場合があります。大きな入れ子JARは検出しますが、まだ自動で展開・依存解決しません。

検査結果は `archive-preflight-report.json` と `diagnostics/archive-preflight-report.json` に保存されます。検査はZIPの整合性と安全性を確認するもので、MODのJava処理が移植できることや、ゲーム内で動くことを保証するものではありません。

## 変換パイプライン

- **JAR解析:** Fabric / Forge / NeoForge / Quiltのメタデータ、依存関係、Mixin、Access Transformer、Jar-in-Jar等を検出します。
- **Java解析:** クラスファイルの定数プール参照整合性、メソッド、JVM命令、分岐先、switch表、例外テーブル、ローカル変数インデックス、メソッド呼び出し形式を静的検査します。命令の分岐先が命令境界にあるか、`max_locals` とメソッド引数スロットが整合するかも検証します。整数定数は定数プールの型タグまで確認し、float/doubleを整数として誤変換しません。アップロードされたJavaコードは実行しません。
- **リソース移植:** 対応するレシピ、ブロック状態、ブロック・アイテムモデル、テクスチャ等をZeus形式に変換します。標準レシピJSONは元のgroup/category/show_notification等を保持して `recipes.add` で登録します。
- **設定データ:** 単純なJSON/TOML/propertiesのスカラー設定をZeusの設定画面と `mod.export.jar2zeus.config.get()` に移します。秘密情報らしいキーは除外し、元Javaの設定読み取りAPIは自動置換しません。対応するモデルJSONは簡易テクスチャへ潰さず、ZIP内に保持してZeusの `model` 定義から参照します。MOD IDと異なる素材名前空間は誤登録を防ぐため未対応としてレポートします。
- **3Dエンティティモデル:** 対応するBlockbench/Bedrock形式のgeometry JSONをZeusの `entities.register` 用モデル定義へ変換します。ボーン階層、パーツ、キューブ、UV、ピボット、回転、ミラー、inflateを扱い、対応するPNGテクスチャを同梱します。
- **モーション:** Zeus公式仕様にある `head` / `leg` / `arm` / `spin` / `bob` / `wing` のパーツモーションへ、ボーン名とアニメーション名から安全に対応付けられる範囲を変換します。独自キーフレームの時刻・補間・任意ボーン曲線は同じ意味で再現できないため、アニメーション診断に未移植として記録します。
- **Java処理の再実装:** 安全な限定範囲のJavaメソッドをLuaへ変換します。残りは機能別の再実装タスクとして整理し、未対応理由と参照したJava APIをレポートします。
- **検証と梱包:** 生成LuaのZeus API呼び出しを静的検査し、`metadata.json` と `main.lua` を含むMOD ZIPを生成します。

## JVMバイトコード構造検証

`bytecode-verifier.js` はデコード済みメソッドについて、命令バイト範囲の連続性、命令オフセットの重複・順序、分岐先とswitch分岐先の命令境界、例外テーブルの範囲、ローカル変数スロット、引数のlong/double 2スロットを含む `max_locals` 収容、戻り命令とメソッド戻り値descriptorの整合性を検査します。基本ブロック、通常分岐・switch分岐・例外辺、ループ候補、到達不能ブロックも構築します。

`bytecode-analysis.js` はクラス全体の命令頻度、分岐・ループ数、メソッド複雑度の目安、JAR内部呼び出し関係、外部クラス呼び出し、`invokedynamic` の出現数を集計します。結果は `bytecode-analysis.json` と `diagnostics/bytecode-analysis.json` に出力します。パーサー側では定数プール参照、`invokeinterface` / `invokedynamic` の形式、switch padding・lookup key順序、Code属性長、クラスファイル末尾も検査します。

これはクラスファイルと命令配置の構造検査です。JVM仕様の全ての型検証（Verifierの完全なデータフロー型推論）、全属性の意味検証、Java仮想マシンの実行互換性を保証するものではありません。各メソッドの結果は `code.verification` に記録され、未検証・不正なメソッドは再実装エンジンでの変換成功と見なさないよう、個別の結果を確認する必要があります。

## Java再実装の現在の対応範囲

現在の自動バイトコード翻訳は、Javaの状態変更や外部API呼び出しを含まない、整数・真偽値などのプリミティブ型 `static` 補助メソッドの限定された命令セットに対応します。変換前に制御フロー全体のオペランドスタック高・分岐先・`max_stack`・`max_locals`・ローカル変数の初期化状態を検証し、条件分岐の合流点でスタック状態が一致しないメソッドや不正なメソッドは変換しません。整数定数はJVM定数プールのInteger型だけを受け入れます。条件分岐、ループ、整数演算、ビット演算と、許可リストにある `java.lang.Math` の `abs` / `min` / `max` を、実行ステップ上限付きのLua関数に変換します。Lua 5.4上でJavaの32bit符号付き整数の折り返し、ゼロ除算例外、ゼロ方向への整数除算を再現する補助関数を生成します。

3Dモデル変換はBedrock/Blockbench系のボーン＋キューブ形式のうち、Zeusが受け付けるUV・パーツ構造に合うものが対象です。Javaコード内で組み立てられる独自モデル、任意のレンダラー、複雑な面別UV、独自シェーダーは自動移植できるとは限りません。独自アニメーションのキーフレーム曲線も、Zeusの組み込みモーション名だけでは完全再現できません。

機械アニメーションの解析では、ギア・車輪・ファン・ローターなど、ループする回転キーフレームを持つリグパーツをZeusの組み込み `spin` に近似マッピングします。これは連続回転への近似で、元のキーフレーム時間・回転曲線は保持しません。ピストンやコンベアの直線移動、ドア・バルブ・レバーの角度制限付き回転、およびJavaのblock-entity tick / rendererによる機械ブロックの動作は、現行のZeus公式APIでは同等に表現できないため未移植として `machine-animation-report.json` に記録します。

設定値の移行はユーザーが変更できるZeus設定を作るもので、元のJavaコードの設定参照を置き換えるものではありません。ゲーム内の登録処理、イベント処理、独自機械、GUI、描画、ネットワーク等は、Java側の意味を読み取っただけでZeus上の同等機能になるわけではありません。Zeus APIに対応する機能アダプターの再実装が必要です。現在のレポートはその残作業を隠さず表示します。したがって、任意のJARが完全移植できる、あるいはZIPを入れれば必ず元MODと同じ動作になる、とは保証しません。

## 出力ファイル

- `<mod-id>-zeus-mod.zip`: ZeusへインポートするMOD本体。`metadata.json` と `main.lua` がZIP直下にあります。
- `diagnostics/report.json`: JAR・変換・パッケージ全体の診断。
- `diagnostics/archive-preflight-report.json`: 展開前のZIP/JAR検査結果。
- `diagnostics/bytecode-analysis.json`: JVM命令・制御フロー・呼び出し関係の集計。
- `diagnostics/reimplementation-report.json`: Javaメソッドごとの変換状況。
- `diagnostics/java-call-graph.json`: Luaへ再実装したstatic補助メソッド間の呼び出しグラフと再帰辺。
- `diagnostics/java-event-lifecycle.json`: Javaローダー初期化候補、イベント登録候補、Zeus側の候補イベント、タイマー候補、未対応理由。
- `diagnostics/forge-api-compatibility.json`: Forge APIのクラス参照・メソッド呼び出し・フィールドアクセス、分類根拠、操作候補、未変換状態。
- `diagnostics/minecraft-internal-api-compatibility.json`: Minecraft本体APIのブロック・アイテム・インベントリ・BlockEntity・ワールド・レシピ等の参照と未変換箇所の診断。
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

## Javaクラス・オブジェクト構造モデル

`class-object-analyzer.js` は、クラス名・親クラス・実装インターフェース・アクセス修飾子・フィールド・メソッド・コンストラクタ・フィールド参照・メソッド呼び出し関係をまとめます。フィールドはstatic/instance、final、syntheticを区別し、`ConstantValue` 属性の定数値と型タグを保持します。JVM命令から `new` / 配列生成、`<init>` 呼び出し、`putfield` / `putstatic` の位置を記録し、内部クラスへの割当てとコンストラクタによるフィールド書き込み候補を集計します。メソッドdescriptorから引数・戻り値の型とスロット数も復元します。

出力は `class-object-model.json` と `diagnostics/class-object-model.json` です。これは静的な構造・命令サイトのモデルです。実行時のオブジェクト値・ヒープ・参照の別名関係・escape analysis・ジェネリック型情報・注釈の意味・パラメータ名・record component・reflectionの結果は復元しません。初期化メソッド候補は名前によるヒントで、Forge/Fabricの登録や実行順序を証明しません。Javaオブジェクトの挙動をLuaへ自動移植する段階ではありません。

## Java型・継承・インターフェース互換レイヤー

`java-type-compat.js` は、クラス構造モデルからZeus Lua向けの型メタデータと補助関数を生成します。クラス／インターフェースの割り当て可能性判定、`instanceof` 相当、nullセンチネル、参照キャスト、Java基本数値型の変換、JVM既定値で初期化した空のオブジェクト記録、instance/staticフィールドの読み書き、クラス階層上の仮想メソッド候補解決を出力します。

生成される主なLua補助関数は `__j2z_java_types` の `is_assignable` / `instanceof` / `checkcast` / `convert_primitive` / `new_object_record` / `get_field` / `set_field` / `get_static` / `set_static` / `resolve_virtual` です。レポートは `java-type-compatibility.json` と `diagnostics/java-type-compatibility.json` に出力します。

この機能はJava VMではありません。オブジェクト生成はJavaコンストラクタや `<clinit>` を実行せず、既定値を持つ空の記録を作るだけです。仮想メソッド解決はメタデータを返すだけで、Javaメソッド本体を実行しません。private/protected/packageアクセス制御、リフレクション、非null配列の完全な実行時型検査、インターフェースdefault methodの競合解決、外部クラスの未知の継承定義、static初期化値の実行は未対応です。Java longは対象Lua 5.4の整数表現範囲に制約されます。したがって、型互換レイヤーの出力だけで任意のMODのオブジェクト動作が移植されるわけではありません。パッケージ検証にもこの未実装状態を渡し、Javaクラス構造を含む出力を誤って完全移植扱いにしないようにしています。

## Javaメソッド呼び出し・制御フロー再実装

`java-reimplementation-engine.js` は、整数系プリミティブ型（boolean / byte / char / short / int）のstatic補助メソッドを対象に、対応するJVM命令をLuaへ再実装します。既存の条件分岐・switch・ループに加え、void戻りのstaticメソッドと、同じJARに含まれる検証済みstatic補助メソッドへの `invokestatic` 呼び出しを接続します。許可するJava標準呼び出しは `java.lang.Math.abs` / `min` / `max` の限定形式です。

変換前に候補メソッドの依存先を反復検査し、対象外のメソッドを呼ぶものは呼び出し元も変換候補から外します。生成Luaではメソッドシンボル表を経由して呼び出し、呼び出し深度は128で制限します。各メソッドの命令ループには既存の100,000命令予算があります。引数を一度ローカル変数へ取り出してから呼ぶため、複数引数のスタック順を保持します。レポートの `callGraph.nodes` / `edges` / `recursiveEdges` に変換された補助メソッドと依存関係を記録します。

**未対応:** インスタンスメソッド、Javaオブジェクト／staticフィールドへのアクセス、コンストラクタ、例外ハンドラー、外部Java/Minecraft/Forge/Fabric API呼び出し、`invokedynamic`、参照型・配列型の実行時意味、ゲームイベントやローダーのライフサイクルへの自動接続は対象外です。未対応の呼び出しを含むメソッドはpendingとしてレポートに残します。これはJava仮想マシンではなく、任意のJava MODの完全移植を保証しません。

## Forge API互換性インベントリ

`forge-api-compat.js` は、Javaクラス解析で得たForge名前空間のクラス参照、フィールド／メソッドdescriptor内の型、メソッド呼び出し・フィールドアクセスを調べ、API領域別に分類します。呼び出しの詳細には、JAR内のパス、呼び出し元クラス／メソッド／メソッドdescriptor、バイトコード位置（PC）、Forge側の所有クラス・メンバー名・descriptor、分類根拠を記録します。単なる文字列一致ではなく、パーサーが復元したクラス／メンバー参照とJVM descriptor内の参照型を対象にします。

分類領域はModエントリポイント、イベントバス、ライフサイクル、レジストリ、Capability、ネットワーク、設定、ブロック／アイテム拡張、レシピ、描画、コマンド、ワールド生成、データ生成、その他のForge APIです。既知の `IEventBus.addListener/register`、`DeferredRegister.create/register`、`RegistryObject.get`、`RegisterEvent.register`、`NetworkRegistry.newSimpleChannel`、`SimpleChannel` の一部操作、Capability関連操作、設定登録・定義操作、`ForgeRegistries` のフィールドアクセスは「操作候補」として識別します。

**操作候補は変換済みAPIではありません。** 現段階ではForge API呼び出しをZeus Lua APIに置き換えず、全て `unmapped` または `unverified` として記録します。APIのバージョン差、ジェネリック型・イベント引数・コールバックの意味、アノテーションの型と値、登録順序、反射・Mixin等は未解決です。アノテーション属性の存在をイベント購読やModエントリポイントの確定証拠として扱いません。

出力は `forge-api-compatibility.json` と `diagnostics/forge-api-compatibility.json` です。詳細配列は種類ごとに最大5,000件で、切り詰めた場合も観測総数を保持します。未変換Forge API呼び出し・フィールド・クラス参照が残る場合、パッケージ検証は `conversionComplete=false` とし、手作業での再実装が必要であることを警告します。Forge MODの完全移植を保証する機能ではありません。

参照する公式資料: [Forge Events](https://docs.minecraftforge.net/en/latest/concepts/events/)、[Registries](https://docs.minecraftforge.net/en/latest/concepts/registries/)、[Mod Lifecycle](https://docs.minecraftforge.net/en/latest/concepts/lifecycle/)。ForgeのバージョンごとにAPIやdescriptorが変わるため、検出した呼び出しのdescriptorは保存しますが、利用Forgeバージョンとの互換性までは自動確定しません。

## Fabric API・Fabric Loader互換性インベントリ

`fabric-api-compat.js` は、Fabric API（`net.fabricmc.fabric.api`）、Fabric Loader API（`net.fabricmc.loader.api`）、Fabric共通API（`net.fabricmc.api`）のクラス参照、JVM field／method descriptor内の型、メソッド呼び出し、フィールドアクセスを静的に調べます。呼び出しごとにJAR内のパス、呼び出し元クラス・メソッド・descriptor、バイトコード位置（PC）、Fabric側の所有クラス・メンバー・descriptor、分類根拠を記録します。

分類領域はイベント／ライフサイクル、プレイヤー・エンティティイベント、レジストリ・コンテンツ登録、ネットワーク、描画、画面・入力、コマンド、ワールド生成・Biome、データ生成、リソース再読み込み、Transfer API、Fabric Loader API、Fabric共通APIです。既知の `Event.register/invoker`、方向別 `PayloadTypeRegistry` 取得、`ServerPlayNetworking` / `ClientPlayNetworking` の一部操作、`FabricLoader` のMod・entrypoint照会、燃料レジストリ、カスタムレジストリ、アイテムグループ、エンティティ属性、キー割当、HUD登録などを「操作候補」として識別します。

`fabric.mod.json` のentrypoint（main / client / server / preLaunch等）について、宣言値・language adapter・対象クラスの存在を記録します。Mixin設定、Access Widener、Nested JAR、依存関係、環境指定も保持します。対象クラスがJAR内で見つかっても、entrypoint interfaceの実装、コンストラクタ実行、初期化順、コールバック実行は確認できません。

**操作候補は変換済みAPIではありません。** Fabric API／Loader APIをZeus Lua APIへ自動置換する機能ではなく、呼び出しはすべて `unmapped`、クラス参照は `unverified` として残します。Mixin変換、Access Widenerによる可視性変更、Nested JARの実行、lambdaのBootstrapMethods / MethodHandle、コールバックの実装、イベントpayload、APIバージョン差は未解決です。未解決のFabric API呼び出し・クラス参照・entrypoint・変換メタデータが残る場合、パッケージ検証は `conversionComplete=false` として手作業の再実装・確認を要求します。

出力は `fabric-api-compatibility.json` と `diagnostics/fabric-api-compatibility.json` です。呼び出し／フィールド／クラス参照の詳細配列は各5,000件、entrypoint詳細は1,000件までとし、切り詰めても観測総数を保持します。Fabric MODの完全移植やゲーム内動作を保証する機能ではありません。
## Minecraft本体API互換性インベントリ

`minecraft-internal-api-compat.js` は、MODのクラスファイルから `net.minecraft.*` の型参照、field／method descriptor、メソッド呼び出し、フィールドアクセスを静的に抽出します。ブロック・BlockState、アイテム・ItemStack、インベントリ／コンテナ、BlockEntity（機械の状態管理を含む）、エンティティ・プレイヤー、Level／ワールド、レジストリ・リソースID、レシピ、ワールド生成、コマンド、GUI、描画、音声・パーティクル、ネットワーク、座標・幾何APIを分類します。

既知の `Level.getBlockState/setBlock/getBlockEntity`、`ItemStack` の数量・状態操作、`Container` のスロット操作、`BlockEntity` の位置・変更通知、`Registry` の参照・登録、`ResourceLocation` の生成、`Entity`／`Player`／`Level` の状態参照、`RecipeManager` の検索などは、正確な所有クラスとメソッド名が一致した場合に操作候補として記録します。これはZeus Lua APIへの変換ではありません。候補はすべて `unmapped`、クラス参照は `unverified` のままです。

Minecraft本体の内部APIはバージョン・マッピング・難読化でクラス名やdescriptorが変わります。Mixin、Access Transformer／Widener、reflection、invokedynamic、実行時状態、クライアント／サーバー差は完全には復元できません。したがって、API参照や呼び出しが残るJava MODはパッケージ検証で `conversionComplete=false` になります。対象のクラス名・メソッド名が一致しただけで互換性を保証しません。

制限対象の武器関連クラス・参照は解析対象から除外し、それ以外の建築・装飾・農業・収納・工業・ワールド生成などのAPI参照を調べます。詳細配列は各5,000件、APIクラス一覧は1,000件までで、切り詰めても観測総数を保持します。

出力は `minecraft-internal-api-compatibility.json` と `diagnostics/minecraft-internal-api-compatibility.json` です。完全移植やゲーム内動作を保証する機能ではありません。

## Javaイベント・ライフサイクル解析

`java-event-lifecycle.js` は、クラスファイルとFabric / Forge / NeoForge等のローダーメタデータを静的に照合し、初期化メソッド名、宣言されたentrypoint、既知のイベント型参照、イベントバス登録呼び出し、Javaタイマー呼び出しを診断します。Zeus側の候補として記録するイベントは `tick` / `frame` / `resize` / `hud` / `screen_render` / `overlay` / `screen_open` / `screen_close` / `chat_receive` / `chat_send` / `world_join` / `world_leave` / `mod_loaded` / `mod_unloaded` / `unload` に限定しています。イベント名が似ているだけでは互換と判定せず、既知のソースイベント型を参照した場合も「候補」にとどめます。

FabricのClientTickEvents / ClientPlayConnectionEvents / HudRenderCallback / WorldRenderEvents / ScreenEvents、Forge / NeoForgeのtick・GUI描画・クライアント接続・画面イベント型を検出候補として扱います。イベントバスの `register` / `addListener` 等や、Javaの `Timer` / `ScheduledExecutorService` によるスケジュール呼び出しも記録します。 `scheduleAtFixedRate` 等は `timer.every` の候補、単発・周期を区別できない `schedule` は `timer.after` / `timer.every` の候補として扱います。

イベント登録サイトの検出は、Fabric `Event.register`、Forge / NeoForgeの既知の `IEventBus` / `EventBus` と登録メソッドの組み合わせに限定します。単にクラス名に `Event` が含まれるだけの第三者ラッパーは登録サイトと判定しません。イベント型と登録APIが同じクラスから見つかっても、個々の呼び出しへの紐付けまでは証明できないため候補扱いです。複数のイベント型が同一クラスから見つかった場合は曖昧として記録します。詳細配列は各5,000件までですが、観測総数は別に保持します。

`schedule` の判定はメソッド名だけでなくJVMメソッドdescriptorの引数型で行います。`java.util.Timer` は相対ミリ秒の単発予約、絶対日時予約、固定遅延、固定レートを区別し、`ScheduledExecutorService` は `Runnable` / `Callable`、`long` 遅延、`TimeUnit` 引数を確認して単発・固定レート・固定遅延を分類します。`Thread.sleep`、`Object.wait`、`LockSupport.park*`、`TimeUnit.sleep` はイベントタイマーではなくブロッキング待機として別枠に記録します。 `Thread.join` と `Condition.await*` も待機APIとして別枠に分類します。`CompletableFuture.delayedExecutor`、`orTimeout`、`completeOnTimeout` は通常のTimer予約と異なる非同期実行・Future完了期限として区別します。`Timer.cancel`、`TimerTask.cancel`、`Future.cancel` はキャンセル候補として記録しますが、以前の予約呼び出しやZeusのタイマーハンドルとの対応付けは未解決です。bytecode呼び出しのdescriptorから分かるのはオーバーロードと引数型までで、実際の数値、`TimeUnit` enum値、Dateの実行時値、Runnableの中身、キャンセルや例外・スレッド動作は復元しません。したがって `timer.after` / `timer.every` は候補にとどまり、Java待機処理をそのままLuaタイマーに置き換えません。

Zeus側は `main.lua` をMOD読み込み時に一度だけ先頭から実行し、その段階でイベントを登録します。`world_join` は実際にワールドへ参加した時に発火するため、すでにワールド内でMODを再読み込みした場合は現在のワールド状態を別途確認する必要があります。`tick` はタイトル画面・メニュー中も毎秒20回発火し、`timer.after` / `timer.every` は秒単位で指定され、タイマーはフレームごとに確認されます。これらの違いは `java-event-lifecycle.json` の `zeusRuntimeRules` にも記録します。

**自動接続はしません。** Javaコールバックの実体、ラムダのBootstrapMethods / MethodHandle、イベント引数オブジェクト、Forgeのアノテーション値、スレッド・キャンセルの意味を現行パーサーでは再構築できません。アノテーション属性を持つメソッドは `annotationCandidates` に個別記録しますが、属性名の存在だけではイベント購読を確認できず、注釈型・値・イベント型は未解決です。Zeus側は `on(name, fn, priority)` / `events.on` と `timer.after` / `timer.every` を提供しますが、Javaイベントの引数・実行タイミング・処理内容とは別物です。登録先Luaを自動生成せず、候補・根拠・手作業が必要な理由を `java-event-lifecycle.json` に記録します。パッケージ検証でも未解決候補が残る出力を完全移植扱いにしません。

公式資料: [Events and timers](https://dev.eaglercraft.com/docs/modding/events-and-timers) / [How mods run](https://dev.eaglercraft.com/docs/modding/how-mods-run) / [API reference](https://dev.eaglercraft.com/docs/modding/api)


## ブロック・BlockState移植インベントリ

`block-state-conversion.js` は、Javaクラスの継承・descriptor・バイトコード呼び出しからブロッククラス、BlockState／StateDefinition／Property参照、状態プロパティ操作、BlockBehaviour.Properties設定、設置・破壊関連の呼び出し候補を抽出します。各候補に元クラス・メソッド・descriptor・バイトコード位置・根拠・未変換状態を記録し、最大5,000件まで詳細を保持します。建築・装飾・農業・収納・一般ユーティリティ・機械系のブロック解析を対象とし、制限対象の機能は除外します。

現段階は**解析と移植タスクの生成まで**です。BlockStateの値、プロパティ定義、コンストラクタ引数、形状、光量、音、loot、redstone、fluid、tick、設置・破壊コールバックをJava bytecodeから完全復元したり、Zeus APIへ自動置換したりはしません。API名が一致しただけで移植成功とは判定しません。ブロック関連の未解決候補・クラスが残るパッケージは `conversionComplete=false` となります。

出力は `block-state-conversion.json` と `diagnostics/block-state-conversion.json` です。静的テストは解析結果の分類を確認するもので、Zeus 26.2 / 26.3上のブロック登録・表示・設置・保存を証明しません。実ゲームでの確認は別途必要です。
