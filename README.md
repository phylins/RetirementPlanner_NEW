# Retirement Planner v6.0 PWA

## v6.0 個人決策版更新重點

這版針對林柏個人退休決策新增 5 個模組：

1. **再工作一年價值**  
   估算多工作一年帶來的稅後新增投資、貸款本金下降、成功率變化與第一年提領率下降幅度。

2. **貸款提前清償 vs 繼續投資**  
   比較維持貸款、清償短期個貸、優先清高利率貸款、全數清償貸款四種策略。

3. **生活費分層**  
   將年度生活費拆成基本生活、保險/車/房屋維護、旅遊娛樂、彈性消費，並估算熊市時可調整金額。

4. **退休燈號**  
   整合退休成功率、第一年提領率、SAFE MAX、貸款壓力，顯示綠/黃/紅燈號。

5. **個人版年度報告**  
   產出第一年度資產、生活費、貸款、提領率、投資報酬、貸款下降與下一年度生活費建議。

## 保留功能

- Balanced Markov Regime / Historical Backtest / Worst Historical / Conservative Regime / Extreme Stress Test
- Classic COLA / Dynamic COLA / Spending Smile / Guardrails
- Dynamic COLA Freeze 可自訂門檻
- 00631L / VOO / VTI / VXUS / SOXX / IEF / TLT / VCIT / SGOV Portfolio Engine
- 退休決策矩陣
- 年度支出與貸款明細
- CSV 匯出
- PWA 快取更新按鈕與重置預設值

## 部署 GitHub Pages

1. 解壓縮 ZIP。
2. 把解壓後最外層的 `index.html`、`sw.js`、`src/`、`data/`、`public/` 等全部覆蓋到 GitHub repo 根目錄。
3. 確認 repo 根目錄的 `index.html` 第一行含有 `v6.0 root index`。
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
