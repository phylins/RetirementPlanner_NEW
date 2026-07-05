# Retirement Planner v5.8 PWA

## v5.8 更新重點

- 「淨資產試算」按鈕只顯示淨資產金額，不再在按鈕內顯示對應投資金額。
- 點選淨資產試算後，會直接更新左側「2026 可投資資產」欄位。
- 保留 v5.7 的左側欄位順序：淨資產試算 → 模式 → 起始條件 → 收入與稅 → 股債現金 → 股票內部配置 → 債券內部配置。
- 快取版本更新為 `v5.8.0`。

## 更新 GitHub Pages

1. 解壓縮 ZIP。
2. 將檔案覆蓋到 GitHub repo 根目錄。
3. 確認根目錄 `index.html` 第一行包含：

```html
<!-- Retirement Planner v5.8 root index...
```

4. Commit 後等待 GitHub Pages 部署成功。
5. 若畫面仍是舊版，請在瀏覽器按 `Ctrl + F5`，或清除 Service Worker / site data。
