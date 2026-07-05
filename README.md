# Retirement Planner v5.10 PWA

## v5.10 更新重點

- 改善 GitHub Pages / PWA 快取：`index.html`、`.js`、`.css`、`data/*.json` 採 network-first，不再長期吃舊版。
- `index.html` 的 CSS / JS 路徑加入 `?v=5.10.0`。
- 新增「更新到最新版」按鈕：會 unregister service worker、清除 Cache Storage，並以時間戳重新載入。
- 新增「重置預設值」按鈕：清除本機 Local Storage 設定後重新載入，方便檢查新版預設值。
- 版本號為 v5.10.0，沒有使用 4.x。

## 部署 GitHub Pages

1. 解壓縮 ZIP。
2. 將最外層檔案覆蓋到 GitHub repo 根目錄。
3. 確認 repo 根目錄的 `index.html` 第一行含有 `v5.10 root index`。
4. Commit 後等待 Actions / Pages 綠色成功。
5. 打開 Pages 網址；若仍看到舊版，按右上角「更新到最新版」。

## 本機測試

```bash
python -m http.server 8000
```

打開：

```text
http://localhost:8000
```
