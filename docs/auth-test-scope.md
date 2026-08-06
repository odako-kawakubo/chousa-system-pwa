# 認証確認版の範囲

## 目的
継ぎ足し状態の旧 app.html をそのまま持ち込まず、現行デザインを参考に画面構成のみを整理し、Microsoftログインの接続だけを最初に確認する。

## 実装済み
- Firebase Microsoft OAuth
- シングルテナント指定
- User.Read / Files.ReadWrite.All スコープ要求
- ログイン・ログアウト
- Graphアクセストークン取得確認

## 未実装
業務ロジック、Firebase同期、SharePoint操作、写真処理、各レコード処理。
