# Jar2Zeus

Minecraft MODのJARと移植先Eaglercraft HTMLをブラウザ内で解析し、移植作業パッケージと解析マニフェスト入りHTMLを出力する実験ツールです。

## 使い方
1. `index.html` をブラウザで開く（JSZip CDN読み込みのためインターネット接続が必要）
2. MODの `.jar` と移植先のEaglercraft `.html` の両方を選択
3. 「両方を解析」を押す
4. 結果を確認し「変換パッケージ＋解析済みHTMLをZIP出力」を押す

## 現在の機能
- Fabric / Forge / NeoForgeのメタデータ、MOD ID、バージョン、依存関係の検出
- Javaクラス、assets、dataの集計
- Eaglercraft HTML内のバージョン候補、Zeus関連文字列などの簡易検出
- `assets/` と `data/` の抽出
- 移植用パッケージ（metadata、main.luaのひな型、レポート、リソース）の生成
- 解析マニフェストを埋め込んだHTMLコピーの生成

## 重要な制限
この版は**完全自動変換器ではありません**。生成HTMLに埋め込まれるのは解析マニフェストであり、MODの機能を実装するコードではありません。Javaバイトコード、Forge/Fabric/NeoForge API、Mixin、ゲームプレイ処理は自動変換されません。Zeus APIへの機能別移植と、対象クライアントでの動作検証が別途必要です。Zeus関連文字列の検出も互換性を保証しません。

ファイルはブラウザ内で処理し、サーバーへ送信しません。JSZipをCDNから読み込むためインターネット接続が必要です。オフライン版はまだ用意していません。
