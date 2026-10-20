# 夾夾管家 V8｜多客戶帳號隔離升級套件

本套件以你提供的 V7 ZIP 為基礎，加入「帳號必須 active 才能使用」的前端檢查、SQL 遷移腳本，以及管理員邀請／停用客戶的 Supabase Edge Functions 原始碼。

## 重要：部署前

1. 先在 Supabase 對資料庫建立備份或確認可還原點。
2. 確認目前登入管理員為 `yee861029@gmail.com`，Auth UUID 為 `10ad5dfa-8877-4d94-87fb-16cde4a7ac47`。
3. 先在 Supabase SQL Editor 執行 `supabase/migration_v8_multitenant.sql`。該腳本保留五張現有營運表與資料，新增 `profiles` 並強化 RLS。
4. 執行後檢查 `public.profiles` 中你的帳號是 `admin` / `active`，且五張營運表的既有資料筆數不變。
5. 下載 ZIP 並保留你的實際 `config.js` Project URL 和 Publishable Key。不要把 `sb_secret_`、`service_role` 或資料庫密碼放進前端。

## Edge Functions

函式原始碼位於：
- `supabase/functions/admin-invite-customer/index.ts`
- `supabase/functions/admin-set-customer-status/index.ts`

請在 Supabase CLI 專案中部署兩個函式，並在函式 Secrets 設定 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。Service role key 只能留在 Edge Function secrets，絕不可提交 GitHub。

部署命令範例：

```bash
supabase functions deploy admin-invite-customer
supabase functions deploy admin-set-customer-status
```

邀請函式接收 POST JSON `{ "email": "customer@example.com" }`，只有 active admin 可呼叫。狀態函式接收 `{ "user_id": "客戶 UUID", "status": "active" }` 或 `{ "user_id": "客戶 UUID", "status": "suspended" }`。

## 目前版本範圍與限制

- 網站登入後會讀取 `profiles`，只有 `active` 帳號可載入營運介面。
- SQL RLS 也會檢查 active 狀態，因此停用客戶不會只靠前端擋住。
- 管理員邀請／停用的 Edge Function 已提供原始碼，但 V8 前端尚未提供完整的「客戶管理 UI」；管理員可先透過安全的 Edge Function 呼叫流程操作，下一階段再把客戶管理頁面整合進網站。
- Supabase Auth 邀請信範本與 Site URL / Redirect URLs 必須在 Dashboard 設定為你的 GitHub Pages 網址。
- 這套件尚未連到你的實際 Supabase 專案執行整合測試；先在測試環境驗證，確認通過再正式部署。

## 回滾提示

不要直接刪除 `profiles` 或重置五張表。若部署後發生問題，先停用新版前端並檢查 Supabase Logs。SQL 腳本會改寫五張表的 owner-only policy，回滾應由熟悉 RLS 的人依備份與原政策復原。

## 帳號自助功能（本次更新）

前端已加入：
- 申請帳號（Supabase Auth signUp；新帳號由資料庫 trigger 建立 `profiles`，預設 `customer` / `invited`，不能使用營運資料直到核准）。
- 忘記密碼郵件與重設密碼表單。
- 登入後「我的帳戶」資訊與變更密碼（目前密碼先重新驗證）。

部署前必須在 Supabase Dashboard → Authentication → URL Configuration：
1. 將 Site URL 設為實際 GitHub Pages 網址。
2. 在 Redirect URLs 加入實際網站網址（包含需要的路徑；例如 `https://<帳號>.github.io/<repo>/`）。
3. 在 Authentication → Providers → Email 設定是否要求 Email confirmation。建議保留信箱驗證。
4. 若要開放前端自助申請，Supabase Auth 必須允許 Sign ups；資料庫 `profiles.status='invited'` 仍會阻擋未核准客戶使用營運資料。

注意：本次尚未加入完整的管理員客戶審核頁面，也尚未在使用者的 Supabase 專案實際寄信或做端到端測試。管理員核准／拒絕／停用 UI 與 Edge Function 部署仍是後續工作。不要把 service role key 放在 `config.js` 或 GitHub。

## V8 客戶管理介面補充

- 管理員登入後，側邊欄會顯示「客戶管理」，可依狀態篩選、搜尋 Email、核准/啟用、拒絕或停用客戶。
- 此頁透過 `admin-set-customer-status` Supabase Edge Function 更新狀態；請先部署該 function，並設定 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` function secrets。Service role key 絕不可放進 `config.js` 或 GitHub Pages。
- 若要使用「拒絕」狀態，先在 Supabase SQL Editor 執行 `supabase/migration_v8_customer_rejection.sql`。此 SQL 只擴充 `profiles.status` 的允許值，不刪除營運資料。
- 部署 Edge Function 範例：`supabase functions deploy admin-set-customer-status`（需先安裝並登入 Supabase CLI，並連結正確專案）。
- 「客戶管理」目前依賴 `profiles` 的 `profiles read own or admin` SELECT policy 與 `is_platform_admin()`；請確認這些政策/函式已部署。
- 申請帳號會由 Auth trigger 建立 `profiles` 並設定 `invited`；管理員核准後才會變成 `active`。仍須在 Supabase Auth 設定 Site URL 與 Redirect URLs，才能讓郵件驗證/密碼重設正確返回網站。
