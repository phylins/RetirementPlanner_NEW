# Retirement Planner v6.1 PWA

## v6.1 更新重點

- 修正 v6.0 個人決策模組的標題重複顯示問題。
- 「再工作一年價值」、「貸款提前清償 vs 繼續投資」、「生活費分層」、「個人版年度報告」現在只保留卡片標題，內容區不再重複顯示同名標題。
- 保留 v6.0 的五個個人決策模組：
  1. 再工作一年價值
  2. 貸款提前清償 vs 繼續投資
  3. 生活費分層
  4. 退休燈號
  5. 個人版年度報告
- 保留 v5.10 之後的 PWA 更新機制：CSS / JS 版本參數、更新到最新版、重置預設值。

## GitHub Pages 更新方式

1. 解壓縮 ZIP。
2. 將最外層檔案覆蓋到 GitHub repo 根目錄。
3. 確認 repo 根目錄的 `index.html` 第一行含有 `v6.1 root index`。
4. Commit 到 main branch。
5. 等 GitHub Actions / Pages 部署完成。
6. 打開網站後如仍看到舊版，按右上角「更新到最新版」。

## 正確根目錄結構

```text
index.html
sw.js
README.md
package.json
data/
public/
src/
```
