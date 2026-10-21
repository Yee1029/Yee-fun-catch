# 夾夾管家刮刮樂（第一版）

本套件以目前的 Yee-fun-catch 網站為基礎，新增管理員活動頁 `scratch-admin.html`、公開玩家頁 `scratch.html`、共用樣式/程式 `scratch.css`、`scratch-admin.js`、`scratch.js`，以及 Supabase SQL 遷移腳本 `supabase/migration_scratchcard.sql`。

## 目前實作範圍

- 僅已啟用的平台管理員可以進入刮刮樂管理頁。
- 建立活動，選擇既有場地與機台，設定 10–300 洞（每 10 洞一級）及店家定位。管理員可輸入店家地址，透過 Google Places API (New) 選取地址建議並自動取得座標；也可直接手動填入緯度／經度。建立活動不會要求管理員開啟手機 GPS。玩家參與及刮獎時才會要求 GPS。
- 可設定多個獎項與數量；獎項總數不能超過洞數，剩餘洞為未中獎洞。
- 草稿可隨機產生/重抽配置；鎖定後不能重新抽選，並開放玩家參加。
- 活動頁產生 QR Code，可重複查看、複製連結及列印。
- 玩家免登入，以瀏覽器匿名工作階段參與；公開資訊顯示獎項數量、剩餘洞數與動態剩餘配率，不公開中獎位置。
- 每夾出 1 樣可申報 1 次；累積歸還每 3 樣額外得 1 次。每刮一洞扣 1 次，同一活動的同一洞只能刮一次。
- 玩家參與及刮獎時，瀏覽器會請求 GPS，資料庫檢查是否在活動設定的 200 公尺範圍內。
- 管理員可結束活動；結束後不再允許申報或刮獎。

## 部署順序

1. 在 Supabase Dashboard → SQL Editor 建立新查詢，貼上並執行 `supabase/migration_scratchcard.sql`。
2. 確認 SQL 全部成功後，再將 ZIP 內的網站檔案更新到現有 GitHub Repository 根目錄。保留你的 `config.js`（其中只有公開 Publishable Key）。
3. 等待 GitHub Pages 部署完成，以已啟用管理員帳號登入夾夾管家。
4. 側邊欄會出現「刮刮樂活動」。建立一個測試草稿，輸入店家地址查詢座標（或手動填入座標）、設定少量獎項，先試用重抽，再鎖定啟用。
5. 用手機開啟 QR Code，允許定位，先申報一次夾取，再測試刮獎、剩餘洞數、剩餘獎項與重新整理後的狀態。
6. 測試通過前不要用正式活動或真實獎品投入營運。

## 重要防弊限制

此版本遵循「零新增設備、零人員操作、玩家自助申報」的低摩擦方案，但匿名系統無法證明玩家實際夾取或歸還了多少商品。GPS 可能被模擬，瀏覽器匿名 token 也可能被重設或偽造；自助申報亦可被虛報。資料庫會限制每次申報最多 30 件、申報間隔至少 8 秒、每個洞全活動只能刮一次，這些措施只能增加濫用成本，不能完全防作弊。依原規則，店家可透過監視器核對申報。

## 安全設計重點

- 中獎洞配置儲存在 `scratch_cells`，匿名玩家沒有直接資料表讀取權限。
- 公開頁透過 `scratch_public_campaign` 取得不含中獎位置的活動摘要。
- `scratch_reveal_cell` 在資料庫端扣次並只回傳被選中洞的結果。
- `scratch_claim_plays` 在資料庫端累積自助申報與計算可用次數。
- `scratch_sessions` 和 `scratch_claims` 不開放匿名直接讀寫；玩家操作透過 RPC。
- 前端只使用 Supabase Publishable Key；絕不可把 Secret/service_role key 放進 GitHub Pages。

## 尚需在實際 Supabase 專案驗證

此套件尚未在你的 Supabase 專案執行遷移或做端到端測試。SQL 執行完成後，請先以測試活動驗證建立、重抽、鎖定、玩家申報、刮獎扣次、跨裝置洞位更新、GPS 範圍及結束活動。若 SQL Editor 回報錯誤，請先停止部署並把錯誤文字貼回來，不要重複執行部分失敗的語句而不檢查狀態。

## Google Maps 地址搜尋設定
1. 在 `config.js` 的 `googleMapsApiKey` 填入專供本網站使用、已設定 HTTP referrer 與 API 限制的 Google Maps API Key。
2. Google Cloud 專案需啟用 `Maps JavaScript API` 與 `Places API (New)`。
3. API Key 是瀏覽器端金鑰，會出現在前端程式；必須限制網站來源為 `https://yee1029.github.io/*`，並限制只可使用上述 API。不要把未受限制的金鑰公開。
4. 地址查詢由管理員按「搜尋地址」時觸發，選擇 Google 建議結果後取得座標並儲存至活動。玩家 GPS 驗證不呼叫 Google Maps API。


## 答案預覽與存證（v1.3）
- 活動列表新增「預覽答案位置／查看答案存證」，管理員可查看每一洞對應的獎項。
- 草稿可預覽及重抽；鎖定啟用後，配置固定，提供 JSON 存證、CSV 清單及列印／另存 PDF。
- JSON 存證包含活動 ID、公開代碼、場地／機台、鎖定時間、逐洞答案及 SHA-256 指紋。建議下載後另外備份。
- SHA-256 只用來比對檔案內容是否變動，不等於第三方時間戳或法律上的不可竄改證明；資料庫權限管理仍然重要。
- 若先前已執行過原版刮刮樂 SQL，請在 Supabase SQL Editor 執行 `supabase/migration_scratchcard_answer_evidence.sql` 一次。這個修正確保「鎖定啟用」會保留店家最後預覽的配置，不會在鎖定時再次洗牌。


## 自訂遊玩次數規則（v1.6）

請先在 Supabase SQL Editor 執行 `supabase/migration_scratchcard_play_rules.sql`，再部署前端檔案。
建立活動時可設定：
- 每夾出 N 個商品，獲得 M 次刮獎
- 每歸還 N 個商品，額外獲得 M 次刮獎

計算採累積總量的整數組合：`floor(累積夾取數 / 每夾數) × 夾取獎勵次數 + floor(累積歸還數 / 每歸還數) × 歸還獎勵次數`。
例如設定「夾 1 得 1 次、還 3 得 1 次」，本次夾 4 個、還 4 個，總計可得 5 次。每次申報最多夾 30 個、還 30 個；累積未達一組的數量保留在累積總數，之後達到門檻才發放獎勵。


## v1.7 玩家活動規則
- 玩家頁會顯示該活動設定的夾取與歸還獎勵規則。
- 新增活動條款：額外活動非機台販售商品、違規/多刮/作弊獎項無效、台主可變更或提前結束、僅刮中指定號碼或符號才中獎。
- 玩家必須勾選同意規則後，才能申報次數或刮開格子。
- 本版只修改前端，不需重新執行 SQL。


## v2.2 獎項標示與已刮洞資訊

執行 `supabase/migration_scratchcard_prize_labels_played_cells.sql` 後，玩家頁會在已刮洞位公開顯示洞號、對應獎項與「已刮出」；獎項依設定順序標示 A賞、B賞、C賞……。建立新活動時後台會自動為獎項名稱加上對應賞別。保留現有 `config.js`。


## v2.3 洞位狀態與已刮次數修正

執行 `supabase/migration_scratchcard_prize_labels_played_cells.sql` 更新函式。此版使用 `scratch_claims.claimed_at`（正確欄位），並回傳全活動 `holes_scratched`；玩家頁的「已刮次數」顯示全活動已刮洞數，不再誤用個別玩家的 `plays_used`。


## v2.5 中獎視窗與三處獎項色彩統一

中獎視窗增加場地名稱與台號；獎項卡片、玩家已刮中獎格、店家答案存證格使用同一組賞別色票。無 SQL 變更。


## v3.0：100 個賞別與統一高辨識配色

- 賞別順序使用試算表欄位命名：A～Z、AA～AZ、BA～BZ、CA～CV，共 100 個。
- 同一個 sort_order 在後台答案卡、玩家頁獎項卡、玩家已刮中獎格使用同一組配色。
- A 賞固定金色；其餘賞別採高辨識度的色相分布，避免淺藍、銀藍等相近色連續重複。
- 執行 `supabase/migration_scratchcard_prize_labels_played_cells.sql` 更新公開函式，然後部署前端；保留 config.js。
