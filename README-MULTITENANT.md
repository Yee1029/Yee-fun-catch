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
