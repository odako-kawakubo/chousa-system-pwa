# 調査システムPWA UI骨格 v0.1.0

Claude作成のUI骨格8ファイルを、HTMLとJavaScript内の参照パスに合わせて配置し直した版です。

## 構成

```text
src/
├─ app.html
├─ css/
│  ├─ common.css
│  └─ layout.css
└─ js/
   ├─ app-init.js
   └─ ui/
      ├─ tabs.js
      ├─ drawer.js
      ├─ project-panel.js
      └─ modal.js
```

## 注意

- 今回はファイル配置だけを修正しています。
- UIコードの内容は変更していません。
- Microsoft認証はまだこの8ファイルには接続していません。
- Firebase Hostingの公開ディレクトリがリポジトリ直下 `.` のままの場合、`src/app.html` は `/src/app.html` で確認できます。
