# 陀螺 Fun Day 多人計分

Helper 用同一網址、活動代碼及共用密碼加入。計時、隊名、比分和排名寫入 Postgres，其他裝置約每 1.5 秒輪詢更新。畫面仍是傳統中文。

這個版本不再使用 Supabase。瀏覽器只呼叫同一個網域的 `/api/...`。

## 環境變數

| 變數 | 必要性 | 說明 |
| --- | --- | --- |
| `DATABASE_URL` | 必填 | Postgres 連線字串。正式環境用 Railway Postgres 的公開網址，讓 Vercel 連得到。不要把真實密碼提交到 git。 |
| `SESSION_SECRET` | 可選 | 簽署 Helper session cookie。不設時會由 `DATABASE_URL` 衍生，同一資料庫的所有 instance 可以共用 cookie。 |

本機可複製 [`.env.example`](.env.example)。Vercel 專案 **fun-day-timer** 的 Production 必須設定 `DATABASE_URL`（合併前或合併後都可以，未設定時登入頁會顯示尚未設定資料庫）。

## 資料表

[`db/schema.sql`](db/schema.sql) 是純 Postgres schema（`lib/schema.sql` 是同一份，給 serverless 函式讀取）。API 冷啟動時會自動執行，使用 `CREATE TABLE IF NOT EXISTS`，不需要另外跑 migration。

- `events`：活動代碼、名稱、學校、密碼雜湊（scrypt）、格鬥輪次、結算時間
- `battle_teams`：組別
- `endurance_entries`：電動組／手動組耐力計時與最佳時間
- `battle_matches`：單循環對賽、盤數、2 分鐘計時

沒有 Supabase Auth、RLS 或 Realtime。Helper 密碼核對成功後，伺服器設定 HttpOnly cookie。

## 本機測試（不需要 Supabase）

需要 Node.js 20+ 和一個空的 Postgres 資料庫。

```bash
npm install
export DATABASE_URL=postgres://fun_day:fun_day@127.0.0.1:5432/fun_day_test
export SESSION_SECRET=local-dev-secret
npm start
```

開啟 `http://127.0.0.1:3000`：

1. 活動代碼用 3–20 位英文字母、數字或 `-`。
2. Helper 密碼最少 4 個字元。
3. 按「建立新活動」。
4. 另一部瀏覽器或無痕視窗用同一代碼和密碼按「加入活動」。

建立活動時會產生 13 組、電動組與手動組耐力名單，以及各 9 輪格鬥賽程。

自動測試：

```bash
npm test
```

測試會自行建表。請指到一個可以清空的資料庫，因為測試會 `TRUNCATE events`。

## 部署到 Vercel

專案已經以 **fun-day-timer** 部署。保持：

- Framework Preset：`Other`
- Build Command：留空
- Output Directory：`.`

`/api` 是 Vercel serverless function，靜態頁面仍是根目錄的 `index.html`。

CI/CD 或 Vercel 專案設定要做的事：

1. 在 Railway 取得 Postgres 連線字串。
2. 在 Vercel Production（以及需要預覽的 Preview）設定 `DATABASE_URL`。
3. 可選：設定長隨機字串 `SESSION_SECRET`。
4. 合併或重新部署後，第一次請求會自動建表。

更新程式不會清掉資料庫裡的賽事紀錄。

## 同步行為

- 耐力計時只在開始、完成、重設或清除紀錄時寫入；畫面用伺服器開始時間自己走。
- 電動組與手動組分開計時、分開排名。名次按最佳時間（較長較前；同分則桌號較小者在前）。總分是該名次的 F1 積分：第1名 25、第2名 18、第3名 15、第4名 12、第5名 10、第6名 8、第7名 6、第8名 4、第9名 2、第10名 1，第11名及以後 0。只有更長的嘗試才會更新紀錄。每個組別一場排名，不把每次嘗試的積分相加。耐力賽「即時排名」在名次旁顯示該組時間，右邊仍是 F1 總分。計時中且打破最佳紀錄時，名次旁用正在走的時間。
- 格鬥賽分開電動組與手動組。名次按已完成場次的勝場、盤差、得盤。總分是該名次的同一套 F1 積分，不是勝場 × 3。尚未出賽沒有名次。可隨時按「結算總分」，其他 Helper 會在下一輪輪詢看到。
- 現場共 12 桌：手動組桌號 1–6、電動組桌號 1–6。兩邊各自從 1 起計，不是共用 1–12。分桌表每邊只列這 6 桌，可列印。
- 輪轉表用按鈕選桌：電動 1–6、手動 1–6。按下某一桌，只顯示該桌由目前輪次起的對陣（輪次、A組、B組）。列印只印目前選中的那一桌。
- 排行榜最上方的「總排行榜」把同一組在四項的 F1 積分相加：耐力電動 + 耐力手動 + 格鬥電動 + 格鬥手動。沒有名次的一項計 0，再按這個總分排名。這張和下面的綜合總分分開。
- 排行榜「綜合總分」= 電動第N名的 F1 積分 + 手動第N名的 F1 積分。耐力賽與格鬥賽各自相加，總分不再換算一次。未有名次的一側計 0。
- 右上角「已連線」表示最近一次輪詢成功。斷線時顯示「離線」或「同步失敗」。
- 兩位 Helper 同時改同一場格鬥時，後寫入的一方會看到「另一位 Helper 剛剛更新了此場」。
