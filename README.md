# 陀螺 Fun Day 多人即時計分

這個版本使用 Supabase Realtime。不同 Helper 可在手機、平板或電腦開啟同一網址，以活動代碼及共用密碼加入，所有計時、名稱、比分和排名會同步更新。

## 1. 建立 Supabase 項目

1. 到 [supabase.com](https://supabase.com) 建立免費項目。
2. 在 **Authentication → Providers → Anonymous Sign-Ins** 啟用匿名登入。
3. 開啟 **SQL Editor**，貼上並執行 [`supabase/schema.sql`](supabase/schema.sql) 的全部內容。
4. 到 **Project Settings → API** 複製：
   - Project URL
   - `anon` / publishable key
5. 在 [`supabase-config.js`](supabase-config.js) 填入這兩個公開值：

```js
window.SUPABASE_CONFIG = {
  url: "https://你的項目.supabase.co",
  anonKey: "你的公開 anon key"
};
```

`anon` key 本來就是供瀏覽器使用，資料安全由 `schema.sql` 的 Row Level Security 規則保障。不要把 Supabase `service_role` key 放入此檔案。

## 2. 本機測試

在本資料夾啟動靜態伺服器，例如：

```powershell
npx serve .
```

開啟顯示的 localhost 網址。第一次使用：

1. 輸入 3–20 位英文字母、數字或 `-` 作活動代碼。
2. 輸入最少 4 個字元的 Helper 密碼。
3. 按「建立新活動」。
4. 其他 Helper 使用同一活動代碼和密碼按「加入活動」。

建立活動時會自動產生 13 組、兩類耐力賽名單，以及 9 輪格鬥賽程。

## 3. 部署到 Vercel

最簡單的方法是把資料夾上載至 GitHub，再在 [vercel.com](https://vercel.com) 選擇 **Add New Project → Import**：

- Framework Preset：`Other`
- Build Command：留空
- Output Directory：`.`

部署後把 Vercel 網址傳給 Helper 即可。更新檔案並重新部署不會清除 Supabase 內的賽事紀錄。

## 即時同步行為

- 耐力計時只在開始、完成或重設時寫入資料庫；畫面根據伺服器開始時間自行更新。
- 每場格鬥倒數可獨立運行，不同 Helper 可同時負責不同場次。
- 斷線時右上角會顯示「離線」；恢復網絡後會重新載入最新資料。
- 同一欄位若被兩位 Helper 同時修改，以資料庫最後收到的操作為準。
