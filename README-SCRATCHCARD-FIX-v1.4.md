# 刮刮樂 v1.4 修正說明

本版以 v1.3 為基礎，修正兩項前端體驗：

1. 玩家頁連結、QR Code 與列印 QR Code 共用同一個 `playerUrl()`，依目前 GitHub Pages 專案路徑組出 `scratch.html?code=...`，避免相對路徑造成連結缺少活動代碼。若活動沒有 `public_code`，管理頁會停止產生有效連結，應重新整理並檢查該活動資料。
2. 「列印／另存 PDF」答案存證卡增加與答案預覽一致的獎項顏色及圖例，讓不同獎項可視覺區分。

本版不需要新增 SQL migration。更新 GitHub 時請保留自己的 `config.js`，不要覆蓋現有 Supabase 設定與 Google Maps API Key。

更新後請測試：
- 活動列表「開啟玩家頁」網址應包含 `?code=` 和活動公開代碼。
- QR Code 連結也應包含相同代碼。
- 「查看答案／存證」的預覽與列印 PDF 均應以顏色區分不同獎項。
