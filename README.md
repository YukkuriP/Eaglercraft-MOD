# Jar2Zeus

**Minecraft MOD JARを解析し、Eaglercraft Zeus向けのLua MODへ移植するブラウザツール**です。

移植先HTMLのアップロードは不要です。JARを選び、Zeusの対象ゲーム版（26.2 / 26.3）を指定します。

## 使い方

1. `index.html` と次のJavaScriptファイルを同じフォルダに置きます。
   - `converter.js`
   - `resource-converter.js`
   - `definition-converter.js`
   - `entity-model-converter.js`
   - `machine-runtime-data-0.js`
   - `machine-runtime-data-1.js`
   - `machine-runtime-data-2.js`
   - `machine-runtime-source.js`
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
- **リソース移植:** 対応するレシピ、ブロック状態、ブロック・アイテムモデル、テクスチャ等をZeus形式に変換します。対応するモデルJSONは簡易テクスチャへ潰さず、ZIP内に保持してZeusの `model` 定義から参照します。MOD IDと異なる素材名前空間は誤登録を防ぐため未対応としてレポートします。
- **3Dエンティティモデル:** 対応するBlockbench/Bedrock形式のgeometry JSONをZeusの `entities.register` 用モデル定義へ変換します。ボーン階層、パーツ、キューブ、UV、ピボット、回転、ミラー、inflateを扱い、対応するPNGテクスチャを同梱します。
- **通常エンティティのモーション:** Zeus組み込みの `head` / `leg` / `arm` / `spin` / `bob` / `wing` へ安全に対応付けられる範囲を変換します。
- **独自機械モーション:** 機械パーツを含む対応geometryとanimation JSONがある場合、別のLua機械ランタイムをパッケージへ同梱します。キーフレーム時刻・位置・回転・スケール、linear / step補間、ループ再生を取り込みます。モデルの機械パーツはローカル仮想3Dオブジェクトとして描画し、20Hz更新、アニメーション再生、簡易アイテム搬送・電力ネットワーク、状態保存を行います。
- **Java処理の再実装:** 安全な限定範囲のJavaメソッドをLuaへ変換します。残りは機能別の再実装タスクとして整理し、未対応理由と参照したJava APIをレポートします。
- **検証と梱包:** 生成LuaのZeus API呼び出しを静的検査し、`metadata.json` と `main.lua` を含むMOD ZIPを生成します。

## Java再実装の現在の対応範囲

現在の自動バイトコード翻訳は、Javaの状態変更や外部API呼び出しを含まない、整数・真偽値などのプリミティブ型 `static` 補助メソッドの限定された命令セットに対応します。条件分岐、ループ、整数演算、ビット演算と、許可リストにある `java.lang.Math` の `abs` / `min` / `max` を、実行ステップ上限付きのLua関数に変換します。

3Dモデル変換はBedrock/Blockbench系のボーン＋キューブ形式のうち、Zeusが受け付けるUV・パーツ構造に合うものが対象です。Javaコード内で組み立てられる独自モデル、任意のレンダラー、複雑な面別UV、独自シェーダーは自動移植できるとは限りません。独自アニメーションのキーフレーム曲線も、Zeusの組み込みモーション名だけでは完全再現できません。

Lua機械ランタイムは、ギアだけでなく、対応するanimation JSONに正しく記述されたピストンの伸縮、ドアのヒンジ回転、ベルト部品の平行移動なども、位置・回転・スケールのキーフレームとしてローカル仮想モデル上で再生します。連続回転だけを `spin` とみなす旧来の近似に限定されません。Catmull-Rom等の未対応補間、無効なキーフレーム、機械パーツがないアニメーションはレポートで未対応として区別します。

この機械ランタイムはMinecraftのネイティブBlock Entityではありません。ゲームワールドのブロックを置き換えたり、通常のサーバーへ機械ブロックを登録したり、ほかのプレイヤーへ同期したりはしません。描画はWebGL2の単色キューブで、元のPNGテクスチャやUV面別マッピングはまだ描画に使用しません。アイテム搬送・電力もランタイム内の抽象シミュレーションであり、バニラのインベントリ・レッドストーンやJava MODの実際の電力APIに接続されていません。

ゲーム内の登録処理、イベント処理、独自機械、GUI、描画、ネットワーク等は、Java側の意味を読み取っただけでZeus上の同等機能になるわけではありません。Zeus APIに対応する機能アダプターの再実装が必要です。現在のレポートはその残作業を隠さず表示します。したがって、任意のJARが完全移植できる、あるいはZIPを入れれば必ず元MODと同じ動作になる、とは保証しません。

## 機械ランタイムの操作

機械モデルを持つMODのLua実行環境では、シングルプレイワールド内で次のコマンドを使えます。

- `/j2z_machine list`: 検出した仮想機械タイプを表示
- `/j2z_machine spawn <type>`: プレイヤーの前に仮想機械を配置
- `/j2z_machine play <id> <animation>` / `stop <id>`: アニメーションを制御
- `/j2z_machine power <a> <b> [efficiency]`: 電力リンクを作成
- `/j2z_machine items <a> <b> [speed]`: アイテム搬送リンクを作成
- `/j2z_machine insert <id> <item-id> <count>` / `send <from> <to> <item-id> <count> [speed]`: 仮想インベントリ間で搬送
- `/j2z_machine power_profile <id> <generation> <consumption> <capacity>`: 仮想電力プロファイルを設定
- `/j2z_machine status <id>`: 状態を表示
- `/j2z_machine remove <id>`: 仮想機械を削除

機械ランタイムは `gl` 権限を使うため、ZeusのMOD権限画面で許可が必要です。

## 出力ファイル

- `<mod-id>-zeus-mod.zip`: ZeusへインポートするMOD本体。`metadata.json` と `main.lua` がZIP直下にあります。
- `diagnostics/report.json`: JAR・変換・パッケージ全体の診断。
- `diagnostics/reimplementation-report.json`: Javaメソッドごとの変換状況。
- `diagnostics/reimplementation-plan.json`: 未実装機能の再実装タスク。
- `diagnostics/entity-model-report.json`: 3D形状・ボーン・モーションの変換結果と未対応アニメーション。
- `diagnostics/machine-animation-report.json`: 機械パーツごとの変換・未対応チャネル。
- `diagnostics/machine-runtime-report.json`: 同梱したLua機械ランタイムの機能と制限。
- `lib/jar2zeus/machine_runtime.lua`: 機械アニメーションが検出された場合に同梱されるLua実行モジュール。
- `diagnostics/api-validation.json`: 使用したZeus APIの静的検証結果。
- `diagnostics/zeus-runtime-probe.lua`: 対象ゲーム内でAPIの存在を確認する読み取り専用プローブ。

Zeusのパッケージ制限に合わせ、展開後4,096ファイル・64 MiB以内を検査します。超過や欠落があればレポートに記録します。

## Zeus APIと対象バージョン

Eaglercraftの公式Modding資料に基づき、Zeus Lua API v1 / Eaglercraft 26.2・26.3を対象にしています。1.8 / 1.12クライアントはZeus MODに対応していません。

- API Reference: https://dev.eaglercraft.com/docs/modding/api
- Blocks, items and mobs: https://dev.eaglercraft.com/docs/modding/blocks-items-and-mobs
- Events and timers: https://dev.eaglercraft.com/docs/modding/events-and-timers
- Packaging: https://dev.eaglercraft.com/docs/modding/packaging

静的検証はAPI名やパッケージ構造を調べるもので、対象ゲーム内での表示・動作成功を証明しません。ブロック・アイテム等の追加は、自分が開いたシングルプレイまたはLANワールド向けで、通常のサーバーが新しいブロックやアイテムを認識するわけではありません。実際のワールドで確認してください。

## 安全上の制限

安全上扱えない機能群は変換対象から除外します。JARは実行せず、クラスファイルとリソースを静的に解析します。
