# Shops near me — setup (about 10 minutes)

## 1. Database (Supabase -> SQL Editor)
Run `migration-location.sql` once. It adds two columns (lat, lng) to shops. Safe to run twice.

## 2. Copy files, then push to GitHub
Copy everything in this zip over your project (same folder names; it includes vercel.json and the whole public/ folder, which also carries the earlier redesign).
Important: vercel.json now allows the browser to ask for location (it used to block it completely) and to look up place names on OpenStreetMap.

## 3. Sellers: save the shop's position
- New shops: step 2 of "Open a shop" -> "Use my current location" (stand in the shop).
- Existing shops: Settings -> Shop -> "Use my current location" -> Save.
Until a shop has a position, buyers still see it if the shop's City matches the buyer's city (so nobody disappears on day one). Buyers never see exact coordinates, only "1.2 km away".

## How it behaves
- near.html ("Shops Near Me"): explains, asks for permission, then shows the spiral and list of shops within the chosen distance (5/10/25/50 km), nearest first.
- Buyer page "Nearby Shops": once location is set it shows only nearby shops. Tap "Change" to use GPS again, type another place, or change the distance.
- Browse & Search and product search always cover ALL stores.
- The homepage "Explore Nearby Shops" button opens near.html.
- The location is saved only in the buyer's browser.

## Notes
- Place names use OpenStreetMap's free Nominatim service straight from the browser; fine for launch traffic, but switch to a paid geocoder if you get heavy use.
- Browsers only share location on https (your Vercel/own domain is fine).
- The mobile app does not have this yet; say the word and I'll add it there.
