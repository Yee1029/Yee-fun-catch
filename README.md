# 夾夾管家｜Supabase 雲端版（第一階段）

本版本保留原生 HTML / CSS / JavaScript 與 GitHub Pages 部署方式，新增 Supabase Email/Password 登入與雲端資料讀寫。

## 部署前必要設定

1. 在 Supabase 專案確認 5 張資料表與 RLS policies 已建立。
2. 編輯 `config.js`：
   - `url` 填入 Supabase Project URL。
   - `publishableKey` 填入 `sb_publishable_...` Publishable Key。
3. 絕對不要把 `sb_secret_...`、`service_role` 金鑰或資料庫密碼放進 `config.js`。
4. 將 `index.html`、`styles.css`、`app.js`、`config.js`、`README.md` 上傳至 GitHub repository 的 `main` 根目錄，等待 GitHub Pages 部署完成。
5. 開啟網站，以 Supabase Authentication 中已建立的管理員 Email 與密碼登入。

## 目前雲端資料表映射

- `venues`：場地。
- `machines`：機台與租金、投幣金額、初始讀值及一般商品成本。
- `meter_readings`：抄表讀值、出貨量、投幣單價與成本快照。
- `special_campaigns`：特殊活動、起訖讀值、成本與結算。
- `special_campaign_items`：活動獎品／商品成本明細。

新建立的記錄使用 UUID，對應 Supabase 資料表主鍵。登入後網站從雲端載入資料；新增或修改資料時會同步到 Supabase。未登入時網站營運介面不會顯示。

## 權限與安全

- 前端只使用 Publishable Key。
- RLS policies 仍是資料保護的核心；部署後請實際測試未登入不能讀寫、登入帳號可以操作。
- 請確認所有 5 張表都啟用 RLS，並保留 `authenticated` 的 owner-only policies。
- 不要將 Secret Key 或資料庫密碼提交至公開 GitHub repository。
- Supabase Auth 中的公開註冊設定應依實際使用情境限制；目前建議關閉公開註冊，只使用管理員帳號。

## 重要注意事項

- 這一版不會自動匯入舊瀏覽器 `localStorage` 資料；目前按需求從空白資料庫開始。
- GitHub Pages 是靜態前端，不能安全地在瀏覽器中執行資料庫備份或持有 Secret Key。
- 每日自動備份需要另外設定受保護的排程環境（例如私有電腦工作排程或安全的伺服器/CI secrets），並定期測試還原；請勿將備份檔或資料庫密碼提交到 GitHub。
- 首次部署後請先建立一筆測試場地、機台與抄表紀錄，確認重新整理／登出再登入後資料仍在雲端，再開始輸入真實營運資料。
- 目前租金歷史快照、每期租金分攤、活動與一般抄表區間的重複營收防呆仍需進一步完善；不要將尚未驗證的報表直接當作正式帳務。


### V9 本期與歷史區間查詢
- 右上角本期標籤依系統日期動態顯示；每期從每月 10 日開始，到次月 10 日前一天結束。
- 首頁營收、成本與估算營利使用本期日期範圍；歷史頁可選擇開始與結束日期，兩端日期均包含。
- 歷史頁分開列出投幣／抄表紀錄與特殊活動，活動營收不會重複加入投幣營收。
- 歷史估算營利目前未扣歷史租金，因目前資料模型尚未保存每期租金快照；請勿把它當作已完成的正式結算。
