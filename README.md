# Retirement Planner v5.9 PWA

## v5.9 更新重點

- 將目前常用選項設為預設：淨資產試算 2.0 億，對應 2026 可投資資產 NT$242,928,232。
- 市場模式預設：Balanced Markov Regime。
- 支出策略預設：Dynamic COLA。
- 年度生活費預設：NT$5,000,000。
- Dynamic COLA Freeze 預設啟用，Freeze 條件預設為「平衡」。
- 「淨資產試算」按鈕縮小，並將字體置中於按鈕正中央。
- 快取版本更新為 v5.9.0。

## 上傳 GitHub Pages

解壓縮後，把最外層的 `index.html`、`sw.js`、`src/`、`data/`、`public/` 等檔案直接覆蓋到 GitHub repo 根目錄。確認根目錄 `index.html` 第一行包含：

```html
<!-- Retirement Planner v5.9 root index...
```

再 commit，等 GitHub Pages 部署完成後按 `Ctrl + F5`。
