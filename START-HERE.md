# Aurora update: Paystack removed + shop templates

1. Supabase -> SQL Editor -> run `supabase-backend/supabase-schema/migration-shop-themes.sql` (once).
2. Copy the files in this zip over your repo (same paths), then:
   git add .
   git commit -m "Remove Paystack, add shop templates, show shop branding in light mode"
   git push
3. Shop owners: Settings -> "How your shop looks" -> pick a Shop template -> Save.

Notes: Paystack is off on the server unless PAYSTACK_ENABLED=true (the mobile app still calls it, so it will get a 503 until updated).
