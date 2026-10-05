# Aurora notifications update

Copy each file to the SAME path in your project (new files are marked NEW), then follow the steps.

NEW files
- migration-notifications.sql            -> run in Supabase SQL Editor (not a project file)
- supabase-backend/server/notify.js
- supabase-backend/server/orderNotify.js
- supabase-backend/server/routes/notifications.js
- public/sw.js
- public/js/notify.js

CHANGED files (small edits; search for the words in quotes to see them)
- api/index.js                      "notificationRoutes" (2 lines)
- vercel.json                       second cron "/api/cron/daily-nudges"
- public/js/app.js                  loader for js/notify.js at the bottom
- public/shop.html                  "AuroraNotify.mountFollow" (follow button)
- supabase-backend/server/routes/orders.js     "orderNotify" (new order, seller chat, status change)
- supabase-backend/server/routes/payments.js   "orderNotify" (card payment confirmed)
- supabase-backend/server/routes/track.js      "orderNotify" (buyer messages; select now includes shop_id, buyer_id, tracking_id)
- supabase-backend/server/routes/admin.js      "orderNotify" (support reply)
- supabase-backend/server/routes/messages.js   "orderNotify" (shop <-> buyer direct messages)
- supabase-backend/server/routes/products.js   "notifyMany" (new product -> followers)
- supabase-backend/server/routes/cron.js       "daily-nudges" (cart reminders + older-products picks)

STEPS
1. Supabase SQL Editor: run migration-notifications.sql
2. In the folder whose package.json lists express:   npm install web-push
3. Make push keys:   npx web-push generate-vapid-keys
4. Vercel -> Settings -> Environment Variables (then redeploy):
     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   (from step 3)
     VAPID_SUBJECT = mailto:you@yourmail.com
     APP_URL = https://aurora-wheat-seven.vercel.app
     RESEND_API_KEY, EMAIL_FROM = Aurora <notifications@yourdomain.com>   (optional until you have a domain)
     CRON_SECRET  (you already have this)
5. git add -A ; git commit -m "Notifications" ; git push
