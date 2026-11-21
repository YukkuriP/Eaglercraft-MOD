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
   - `block-state-conversion.js`
   - `item-inventory-conversion.js`
   - `block-entity-machine-state.js`
   - `machine-power-systems.js`
   - `transport-networks.js`
   - `machine-process-analysis.js`
   - `machine-gui-interaction.js`
   - `machine-gui-converter.js`
   - `machine-gui-state-bridge.js`
   - `machine-gui-live-binding.js`
   - `machine-state-provider-sdk.js`
   - `machine-state-event-producer.js`
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

## Machine GUI conversion scaffold (Phase 19)

`machine-gui-converter.js` converts the static GUI inventory into a Zeus UI preview plan for Eaglercraft 26.2 / 26.3. It maps recognizable controls to the documented `ui.screen` widget family (button, toggle, slider, text field, text area, list and label), and creates visual-only Canvas placeholders for progress/gauge and inventory-slot layouts. PNG GUI textures are preserved under `assets/gui/` when they fit the package limits.

The generated `diagnostics/machine-gui-scaffold.lua` is a separately reviewable preview scaffold. It adds a button to the title screen that opens a sample preview. It does **not** replace the generated `main.lua` and does not connect Java callbacks, machine values, inventory operations, packets, server authority, source coordinates, localization keys or texture-atlas UVs. All preview actions are deliberately disconnected and show a notice. The report is `machine-gui-conversion-plan.json` and `diagnostics/machine-gui-conversion-plan.json`.

The scaffold uses the documented Zeus screen/widget API and drawing Canvas API. This is a conversion foundation only: the original machine GUI is not considered ported until its layout, data sources, permissions, callbacks, inventory behavior and synchronization are separately implemented and tested in the target game.

## Machine GUI state bridge and provider contract (Phases 20–21)

`machine-gui-state-bridge.js` combines the Phase 14 BlockEntity field inventory, Phase 15 power-field inventory, Phase 17 processing fields and Phase 19 GUI candidates into a semantic binding plan. It labels likely candidates such as progress, energy, temperature, fluid, fuel and operating state. These remain static name/category hints; it does not recover runtime values from Java bytecode.

The generated `diagnostics/machine-gui-state-bridge.lua` is a read-only probe. From a container screen it opens a small utility screen where the user enters exact block coordinates. It reads the block ID through the documented `world.exists()` and `world.block(x, y, z)` APIs. It does not write to the world or modify inventories.

For optional telemetry, the probe can query a separate running Zeus MOD through `mods.get(providerId)`. Phase 21 versions this contract as `jar2zeus.machine-state-provider.v1` (API version 1). The provider export declares `schema`, `api_version` and `read_machine_state(x, y, z, blockId)`; returned envelopes must include the provider ID, exact coordinates, exact block ID and a `values` table. The probe checks these fields, restricts values to an allow-list of scalar keys and validates primitive types/ranges. It rejects mismatched IDs, coordinates, block IDs, schemas and unsupported value types. These checks validate the envelope, not the truth of the provider’s underlying source.

**Important API boundary:** the reviewed public Zeus API reference documents block-ID reads and general world context, but does not document a general reader for arbitrary Java BlockEntity objects or their NBT contents. The tool therefore marks energy, progress, temperature, fluid, fuel and similar telemetry as provider-required instead of pretending those values were extracted. The state-bridge report keeps `machineValuesConnected=false`, `runtimeValuesRecovered=false` and `worldWritesPerformed=false`.

Reports are `machine-gui-state-bridge-plan.json` and `diagnostics/machine-gui-state-bridge-plan.json`; the read-only probe is `diagnostics/machine-gui-state-bridge.lua`. A companion-provider starter is exported separately as `diagnostics/machine-state-provider-template.lua`. It intentionally returns an empty `values` table until its author connects a genuine, supported data source; it is a development template, not a ready-made machine reader.

## Live machine GUI telemetry binding (Phase 22)

`machine-gui-live-binding.js` creates a read-only utility screen that consumes the Phase 21 provider contract. It adds a button to container screens, accepts exact block coordinates and a provider MOD ID, reads the block ID with the documented world API, and requests a matching state envelope from the explicit provider export. While the utility screen is open, `timer.every(0.5, ...)` refreshes the values; the timer is cancelled through the screen's `onClose` callback and the `screen_close` / `world_leave` events. A manual refresh button remains available if the timer API is missing.

The display is restricted to the fixed telemetry key/type allow-list and rechecks the provider schema/version, provider ID, coordinates, block ID, primitive types and numeric bounds on every update. It does not modify blocks, inventories or machine state. Its labels are a separate telemetry view; they do not recreate the original Java GUI, its button callbacks, slots or server-authoritative actions.

The consumer cannot create a real data source. A separate Zeus provider must explicitly register genuine readers for block IDs it can legitimately inspect. Static Java field names remain hints and are never treated as runtime values. Reports are `machine-gui-live-binding-plan.json` and `diagnostics/machine-gui-live-binding-plan.json`; the generated Lua consumer is `diagnostics/machine-gui-live-binding.lua`. No in-game runtime test is implied by static checks.

## Machine-state provider SDK and event bridge (Phase 23)

`machine-state-provider-sdk.js` generates a separate companion-provider template ZIP. Its ID is derived from the analyzed MOD ID with the `_state_provider` suffix, and the Phase 22 telemetry screen is prefilled with that same ID. The companion package contains `metadata.json` and `main.lua`; its report and standalone Lua source are also exported under `diagnostics/machine-state-provider-sdk-*`.

The generated provider is deliberately empty. It does not register any block reader, invent progress/energy/temperature values, or read arbitrary Java BlockEntity/NBT internals. It provides two explicit integration paths for real, supported sources:

- **Callback reader:** call the template's local `registerMachineReader(blockId, declaredKeys, reader)` for a namespaced block ID. The callback must obtain those values from state that the provider MOD legitimately owns or can read.
- **Event reader:** call `registerEventReader(blockId, declaredKeys)`. A source Zeus MOD that owns the data can publish `jar2zeus.machine-state-event.v1` using `events.emit`; the provider listens with `on`, validates the payload, and keeps a bounded short-lived cache.

Both paths enforce declared telemetry keys and primitive types. Coordinates, block IDs, reader count, cache size and age, and numeric ranges are bounded. The registry remains local to the provider; other MODs can only call the exported `read_machine_state` function. The exported event name lets an explicit producer obtain the channel through `mods.get(providerId)`.

**Important trust boundary:** custom MOD events are a transport, not authentication. The `source_id` field is self-asserted and does not prove the origin or truth of a value. The provider template contains no automatic source integration. A Java class/field name found in a JAR is only a static hint; it is not a live data source. The package validator requires the provider SDK report and matching provider IDs, and rejects claims that source readers or verified values were created automatically.

The generated companion ZIP is a development starter, not a finished machine-state integration. Register an actual source and test it in the exact Zeus 26.2/26.3 client before expecting live values. The synthetic tests do not replace an in-game test.

## Explicit machine-state event publisher (Phase 24)

`machine-state-event-producer.js` generates a sender helper for the exact provider ID and `jar2zeus.machine-state-event.v1` channel created in Phase 23. The helper is appended to the generated source MOD `main.lua` and exported as `mod.export.publish_machine_state(x, y, z, blockId, values)`. It obtains the companion provider through `mods.get(providerId)`, checks the provider schema/version/event name, validates integer coordinates, a namespaced block ID, and the fixed scalar telemetry key/type allow-list, then submits the event through `events.emit`.

The sender is callable but deliberately inert until source logic calls it. It does not create a source-state reader, inspect Java BlockEntity/NBT data, register a tick callback, schedule a timer, scan the world, or publish on its own. A developer must connect a real state source already owned by the converted MOD and call the helper from a supported source-owned callback. The companion provider must also be installed and configured to accept the matching block ID and keys.

A successful `events.emit` call means only that submission did not throw; it does not confirm provider receipt or display. Zeus custom events are broadcast to every listening MOD, not only the companion provider, so publish only non-sensitive game telemetry. The `source_id` is self-reported through `mod.id`, not authenticated. The diagnostics are `machine-state-event-producer-plan.json` and `diagnostics/machine-state-event-producer.lua`. No in-game event-delivery test is implied by static validation.

Official API references: [Share code with other mods](https://dev.eaglercraft.com/docs/modding/packaging), [Events and timers](https://dev.eaglercraft.com/docs/modding/events-and-timers), [API reference](https://dev.eaglercraft.com/docs/modding/api).

Official API references: [API reference](https://dev.eaglercraft.com/docs/modding/api), [Screens and menus](https://dev.eaglercraft.com/docs/modding/screens), [Share code with other mods](https://dev.eaglercraft.com/docs/modding/packaging).

## Machine-state source getter evidence map (Phase 25)

`machine-state-source-analysis.js` links the Phase 20–24 telemetry field hints to statically visible Java getter candidates. It examines only methods in machine-related classes and accepts no-argument primitive or `java.lang.String` return signatures. It records method visibility, instance/static status, exact return type, decoded `GETFIELD` references and the bytecode verifier's structural result. A candidate is marked higher confidence only when its signature and field evidence agree; private, static, synthetic or unverified methods remain manual-review candidates.

The result is exported as `machine-state-source-analysis-plan.json` and `diagnostics/machine-state-source-analysis-plan.json`. For each telemetry metric it lists matching fields and getter candidates, including methods for which no getter evidence was found.

**Important boundary:** this is a source-review worksheet, not an execution bridge. A getter name or `GETFIELD` instruction does not prove that the method returns the raw value; it may scale units, clamp values, calculate a derived result or have side effects. Java methods are not callable from Zeus Lua, so the analyzer generates no reader callbacks, tick hooks or event publications. A developer working in the source MOD must review the actual method logic and connect a genuine source-owned value to the Phase 24 publisher. No live machine values are claimed to have been recovered.

## Machine-state getter body semantics (Phase 26)

`machine-state-getter-semantics.js` examines the decoded instruction body of each Phase 25 no-argument getter candidate. It summarizes field reads and writes, numeric constants, arithmetic and conversion operations, method calls, conditional branches, monitor/throw instructions and return opcodes. For a narrow, straight-line subset, it builds a bounded symbolic expression such as a direct field read or a field value multiplied by a numeric constant.

The analyzer distinguishes direct field returns, calculated field returns, constant/static-field returns, conditional or loop-dependent methods, helper-call-dependent methods, state-mutating getters, decode errors and unresolved bytecode. Unverified methods are explicitly marked low confidence. Branches, loops, helper calls, unsupported opcodes and complex stack shapes are reported as unresolved/dependencies rather than simulated.

The plan is exported as `machine-state-getter-semantics-plan.json` and `diagnostics/machine-state-getter-semantics-plan.json`. It is static evidence only: expressions do not establish units, rounding, overflow, clamping, update timing or server authority. No Java method is executed, no runtime value is recovered, and no source callback, Lua bridge or event publication is generated. A source-MOD developer must verify the original logic and implement the actual data reader independently.

## Machine-state field write trace (Phase 27)

`machine-state-write-trace.js` maps the Phase 20–25 machine telemetry field candidates to decoded JVM `PUTFIELD` / `PUTSTATIC` sites. Each writer candidate records the target owner/name/descriptor, bytecode offset, method visibility/static status, verifier result, field reads in the same method, local method calls, branch sites, and a small role label.

The role labels distinguish constructor initialization, setter/update methods, processing-like methods, tick/lifecycle-like methods, persistence-like methods and synchronization-like methods. They are deliberately heuristic: a method name or call name does not prove the actual event timing or server/client authority. Exact local call edges are recorded only when owner, method name and descriptor match a method in the analyzed machine classes. Reflection, dynamic dispatch, runtime call order and external helpers remain unresolved.

The plan is exported as `machine-state-write-trace-plan.json` and `diagnostics/machine-state-write-trace-plan.json`. A `PUTFIELD` instruction proves a static write site only; the analyzer does not reconstruct the value on the operand stack, calculate the assignment expression, execute methods, or recover update timing. No tick hooks, callbacks, Java bridge, event publication or live machine values are generated. A source-MOD developer must verify the real update path and connect a supported source-owned value to the explicit Phase 24 publisher.

## Machine-state update condition context (Phase 28)

`machine-state-update-conditions.js` inspects a bounded window of decoded JVM instructions immediately before each Phase 27 telemetry-field write. It records nearby comparison opcodes, branch offsets and targets, field reads, and helper calls, together with their bytecode positions relative to the write. The report is intended to help a developer navigate the original source when reviewing a machine's update conditions.

**Important boundary:** proximity is not proof of control dependence. The analyzer does not establish that a branch gates a write, pair comparison operands, reconstruct operand-stack provenance, evaluate conditions, or prove runtime call order/tick timing. Branch targets are listed as offsets only; full dominance, exception-edge, virtual-dispatch and interprocedural control-flow analysis are not performed. It executes no Java and generates no callbacks, event publications, Java bridge or live telemetry connection.

The plan is exported as `machine-state-update-conditions-plan.json` and `diagnostics/machine-state-update-conditions-plan.json`. All findings remain static review evidence and require confirmation against the original source implementation.

## Machine-state control-flow analysis (Phase 29)

`machine-state-control-flow.js` reuses the structural CFG generated by `bytecode-verifier.js`. For each Phase 28 write candidate, it locates the containing basic block and calculates reachable blocks, dominators and postdominators. It then reports a **CFG control-dependence candidate** only when a conditional/switch branch block dominates the write block, the write block postdominates at least one branch successor, and it does not postdominate the branch block.

This is a stronger static relationship than simple instruction proximity, but it remains bounded evidence from the verifier's structural CFG. Exception-table edges are included conservatively; these edges may over-approximate exception reachability. Methods with invalid/missing CFGs, no reachable exit, malformed edges, non-convergent fixed points, or exceeded resource limits remain unresolved rather than guessed. Aggregate block, edge, method, and iteration limits bound analysis work.

**Important boundary:** this report does not execute Java, evaluate branch conditions, reconstruct operand stacks, determine which branch outcome occurs at runtime, recover assigned values or establish ticking/threading/server authority. A CFG candidate is not runtime verification. No callbacks, event publications, Java bridge or live telemetry connection are generated.

The plan is exported as `machine-state-control-flow-plan.json` and `diagnostics/machine-state-control-flow-plan.json`.

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
- `diagnostics/machine-state-source-analysis-plan.json`: 機械のフィールド候補と、JVMのgetter候補を結び付けた静的解析結果。
- `diagnostics/machine-state-getter-semantics-plan.json`: getter本体の計算・分岐・呼び出し・状態変更を静的分類した診断。
- `diagnostics/machine-state-write-trace-plan.json`: 機械フィールドのPUTFIELD/PUTSTATIC書き込み箇所と、ローカル呼び出し関係の静的追跡。
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
- `diagnostics/machine-gui-state-bridge-plan.json`: 機械GUIデータ候補と、Zeusから直接読める情報・外部プロバイダーが必要な情報の区分。
- `diagnostics/machine-gui-state-bridge.lua`: 座標指定によるブロックID確認と、任意のZeus外部プロバイダーの読み取り専用接続プローブ。
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

## アイテム・インベントリ移植インベントリ

`item-inventory-conversion.js` は、Javaクラスの継承・descriptor・バイトコード呼び出しからアイテムクラス、ItemStack、Container／Inventory／Slot参照、アイテム登録候補、アイテム使用・数量・耐久値・NBT・スロット操作を抽出します。各候補に元クラス・メソッド・descriptor・バイトコード位置・根拠・未変換状態を記録し、最大5,000件まで詳細を保持します。建築・装飾・収納・農業・一般ユーティリティ・機械系MODの通常アイテムとインベントリを対象とし、制限対象の機能は除外します。

現段階は**解析と移植タスクの生成まで**です。ItemStackの実行時数量・NBT値、コンストラクタ引数、アイテム使用時のコールバック、登録順序、クリエイティブタブ、装備属性、コンテナ同期を完全復元したり、Zeus APIへ自動置換したりはしません。API名が一致しただけで移植成功とは判定しません。アイテム・インベントリ関連の未解決候補・クラスが残るパッケージは `conversionComplete=false` となります。

出力は `item-inventory-conversion.json` と `diagnostics/item-inventory-conversion.json` です。静的テストは解析結果の分類を確認するもので、Zeus 26.2 / 26.3上でのアイテム登録・使用・耐久値・インベントリ保存を証明しません。実ゲームでの確認は別途必要です。

## BlockEntity・機械状態の移植インベントリ

`block-entity-machine-state.js` は、Javaクラスの親クラス・フィールドdescriptor・バイトコード呼び出しからBlockEntity派生クラス、NBT型参照、永続化処理、同期処理、Tick／Lifecycleメソッドを抽出します。対象にはチェスト・かまど・ホッパー・樽・醸造台などの一般的なブロックエンティティと、一般機械系MODのBlockEntityを含みます。各検出結果に元クラス・メソッド・descriptor・PC・根拠を記録し、詳細配列ごとに最大5,000件を保持します。

現段階は**解析と移植タスクの生成まで**です。NBTの実際のキー／値、フィールド実行時値、JavaコンストラクタやTick本体、保存順序、チャンク再読込、クライアント同期を完全復元したり、Zeus APIへ自動置換したりはしません。名前や型の一致だけで機械が動くとは判定しません。BlockEntityのクラス・操作・フィールドが残るパッケージは `conversionComplete=false` となります。

出力は `block-entity-machine-state.json` と `diagnostics/block-entity-machine-state.json` です。静的解析はZeus 26.2 / 26.3上の保存・再読込・Tick・同期の動作を証明しません。実ゲームでの検証は別途必要です。

## 機械・動力システムの移植インベントリ

`machine-power-systems.js` は、Javaクラスの継承・descriptor・フィールド・バイトコード呼び出しから、電力・エネルギー・蓄電・発電・回転動力系のAPI候補を抽出します。Forge／NeoForge Energy API、一般的なEnergyStorage系、Create系のKinetic／Rotation／Stress APIなどを対象に、エネルギー受け取り・取り出し・容量・残量、発電・消費量、回転速度・トルク・Stress・ネットワーク更新候補を分類します。MOD内の独自親クラスを経由する継承関係も追跡し、元クラス・親クラス・メソッド・descriptor・PC・根拠を保持します。操作・フィールド・メソッドの詳細配列は各最大5,000件です。

現段階は**静的解析と移植タスク生成まで**です。数値の実行時値、単位、符号規約、ネットワーク接続トポロジー、エネルギー損失、転送順序、Tickタイミング、レッドストーン条件は復元しません。似た名前のAPIを見つけただけでZeus側の動作へ自動置換したり、発電・蓄電・動力ネットワークが動くと判定したりはしません。未解決の動力系クラス・操作・フィールド・メソッドが残るパッケージは `conversionComplete=false` となります。

出力は `machine-power-systems.json` と `diagnostics/machine-power-systems.json` です。静的テストはZeus 26.2 / 26.3上での発電・蓄電・エネルギー転送・動力ネットワークの動作を証明しません。実ゲームでの検証は別途必要です。

## アイテム・液体・エネルギー輸送ネットワーク解析

`transport-networks.js` は、搬送・配管・タンク・ポンプ・コンベア・接続ノード等のクラス名、親クラス、インターフェース、descriptor、フィールド、バイトコード呼び出しから、アイテム／液体／エネルギーの輸送候補とネットワーク操作を抽出します。Forge系の `IItemHandler`／`IFluidHandler`、Fabric Transfer APIの `Storage`／`ItemVariant`／`FluidVariant`、NeoForgeの `ResourceHandler`／`ItemResource`／`FluidResource` 系を別のAPI系列として記録します。NeoForgeの `EnergyHandler` は汎用リソースハンドラーと区別します。クラス継承をたどってMOD内の独自実装も候補に含め、元クラス・API owner・メソッド・descriptor・PC・根拠・未変換状態を保持します。詳細配列は各最大5,000件です。

現段階は**静的解析と移植タスク生成まで**です。接続形状、隣接ブロック探索、面ごとの接続可否、フィルター、搬送優先度、実転送量、転送速度、経路探索、トランザクション確定条件、チャンク境界、Tick順序は復元しません。Fabricの汎用StorageやNeoForgeの型付きResourceHandlerを、型情報なしに特定の資源種別と断定もしません。検出された候補をZeus用のパイプ・ポンプ・コンベア・ネットワークとして自動実装したとは扱わず、未解決のクラス・API参照・操作・フィールド・メソッドが残るパッケージは `conversionComplete=false` となります。

出力は `transport-networks.json` と `diagnostics/transport-networks.json` です。静的解析はZeus 26.2／26.3上での搬送速度・接続・フィルター・永続化・同期を証明しません。実ゲームでの検証は別途必要です。

## 機械加工・生産工程の解析

`machine-process-analysis.js` は、JAR内の機械系Javaクラスと `data/<namespace>/recipe(s)/<path>.json` のレシピ定義を組み合わせて解析します。レシピ実装・RecipeType・RecipeSerializer・RecipeManager・Ingredient・RecipeInputの参照、`matches`／`assemble`／レシピ検索等の操作候補、機械側の進捗・加工時間・燃料・電力・入力・出力・稼働条件・Tick処理を静的に抽出します。JSON側では型、入力候補、液体／化学物質候補、完成品、副産物、加工時間、エネルギー／燃料条件、温度・圧力等の条件を候補として記録します。各詳細配列は最大5,000件で、元クラス・メソッド・descriptor・バイトコード位置または元JSONパスを保持します。レシピJSONの解析入力は1ファイル2 MiB・合計64 MiBを上限とし、上限超過または読込失敗は `recipeJsonReadErrors`、不正JSONは `recipeJsonInvalid` と `recipeParseIssues` に記録して完全移植判定を止めます。

MinecraftのバージョンやローダーでレシピのJSON形式とJava APIは異なります。たとえば、近年のNeoForge資料ではデータレシピを `data/<namespace>/recipe/` に置き、独自レシピは `Recipe`・`RecipeType`・`RecipeSerializer` を組み合わせる構成として説明しています。Fabric資料もレシピJSONとデータ生成を扱い、旧バージョンの資料では `recipes` という複数形ディレクトリが使われています。そのため本解析器は両方のフォルダ名を認識し、ローダー間の独自フィールドを一つの固定スキーマとして決めつけません。

現段階は**静的解析と移植タスク生成まで**です。カスタムSerializerのdecode／encode、レシピの実際のmatches／assemble、機械の入力検証、進捗のTick更新、燃料・電力の実消費、完成処理、副産物の確率、流体の単位、温度・圧力・環境・レッドストーン条件は実行・再現しません。JSONに加工時間や燃料が見つからなくても、Javaコードや設定ファイルに存在しないとは断定しません。未解決のレシピ・Serializer・機械クラス・操作・フィールドが残るパッケージは `conversionComplete=false` となります。

出力は `machine-process-analysis.json` と `diagnostics/machine-process-analysis.json` です。合成データでの分類テストはZeus 26.2／26.3上で実際に機械が稼働することを証明しません。材料消費、加工時間、エネルギー／燃料、完成品・副産物、保存・再読込、サーバー同期の実ゲーム検証は別途必要です。

参考資料：<https://docs.neoforged.net/docs/1.21.1/resources/server/recipes/>、<https://docs.neoforged.net/docs/1.21.10/resources/server/recipes/custom/>、<https://docs.fabricmc.net/develop/data-generation/recipes>、<https://wiki.fabricmc.net/tutorial:recipes>。

## 機械GUI・操作・同期の解析

`machine-gui-interaction.js` は、Javaクラスの親クラス・インターフェース・descriptor・フィールド・バイトコード呼び出しから、Screen／ContainerScreen、AbstractContainerMenu／ScreenHandler、Widget、Slotの候補を別々に抽出します。画面の初期化・描画・リサイズ・閉じる処理、マウス／キー入力、ボタンや値変更コールバック、Slot登録・DataSlot登録、クイック移動、入力／取り出し可否、状態broadcast、パケット送受信候補を記録します。機械加工解析で見つかったクラスとの参照関係も照合し、機械GUIとの関連候補を示します。

GUI資産は `assets/<namespace>/textures/gui/`、GUI／Screen／Menu／ContainerのJSON定義、言語ファイルのパスを確認します。GUI JSONは1ファイル512 KiB・合計16 MiBまで構造を調べ、Widget種別や座標・ラベル・テクスチャ候補のフィールドパスを抽出します。上限超過・読み込み失敗・不正JSONは診断に残します。詳細配列はそれぞれ最大5,000件です。

Zeus側には `screen_init` と独自UI画面、ボタン・ラベル・トグル・スライダー・テキスト欄・リスト・Canvas等の仕組みがあります。しかし元MODのJava GUIを見つけただけでZeusの画面に置き換わるわけではありません。Minecraft側ではScreenとMenuは役割が分かれ、Slot／DataSlotによる表示値・インベントリの同期、クリック処理、サーバー側の検証が関係します。そのため解析結果は変換済みではなく未解決候補として扱い、完全移植判定に残します。

現段階は**静的解析と移植タスク生成まで**です。画面レイアウト・座標スケーリング、独自描画、テクスチャUV、翻訳、Slotの並びと検証、Shiftクリック等の移動規則、ボタン操作の意味、値変更の検証、サーバー権限、パケットpayload、同期タイミング、画面の開閉・再構築は再実装していません。未解決の画面・メニュー・Widget・Slot・操作・同期・GUI資産があるパッケージは `conversionComplete=false` となります。

出力は `machine-gui-interaction.json` と `diagnostics/machine-gui-interaction.json` です。合成データでの分類テストはZeus 26.2／26.3上で機械GUIが実際に開き、入力・変更・同期できることを証明しません。実ゲームでのクリック、Shiftクリック、数値変更、画面再構築、切断・再接続、サーバー同期の検証は別途必要です。

参考資料：<https://dev.eaglercraft.com/docs/modding/screens>、<https://dev.eaglercraft.com/docs/modding/events-and-timers>、<https://docs.minecraftforge.net/en/1.20.x/gui/menus/>、<https://docs.minecraftforge.net/en/1.20.x/gui/screens/>。

- `diagnostics/machine-state-event-producer-plan.json` and `diagnostics/machine-state-event-producer.lua`: explicit source-side event publisher helper and manual wiring plan.
