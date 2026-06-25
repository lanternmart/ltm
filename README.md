# 🏮 Lantern Mart

Store management PWA for Lantern Mart — Rockhampton & Townsville, QLD.

## Features
- 📷 Scan & product lookup (supply/retail/margin/GST)
- 📦 Inventory + BB/Expiry tracking (FEFO)
- 📋 Order management (Pending → Arrived)
- 💵 Daily cashflow + EOD reconciliation
- 📊 Weekly dashboard + Cash on Hand formula
- 👥 Payroll & timesheet
- 🔄 Lightspeed API sync (one tap)
- ⬇️ Export PDF/Excel (all features)

## Setup

### 1. Lightspeed API Key
1. Login to Lightspeed Retail
2. Go to **Settings → Personal Tokens**
3. Create a new token with scopes: `employee:inventory`, `employee:register_read`, `employee:reports`
4. Copy the token

### 2. Deploy
```bash
# Clone this repo
git clone https://github.com/YOUR_USERNAME/lantern-mart.git
cd lantern-mart

# Push to GitHub (auto-deploys to GitHub Pages)
git push origin main
```

### 3. GitHub Pages Setup
1. Go to [GitHub Pages](https://pages.cloudflare.com)
2. Connect your GitHub repo: `lantern-mart`
3. Build settings:
   - **Framework preset:** None
   - **Build command:** (leave empty)
   - **Build output directory:** `/`
4. Add secrets in GitHub → Settings → Secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

### 4. First use
1. Open app URL on your phone
2. Tap **Share → Add to Home Screen** (iOS) or **Install app** (Android)
3. Go to **Settings** tab → enter your Lightspeed Account ID + API Key
4. Tap **Sync now** → all products load
5. PIN default: `1234` (change in Settings)

## Auto-update
Every time you push to `main`, GitHub Pages deploys automatically.
The app detects the new version and shows **"Update now"** banner — tap it to update without reinstalling.

## Tech stack
- Pure HTML/CSS/JS — no build step needed
- Service Worker (PWA offline support)
- localStorage for local data cache
- Lightspeed Retail API v3
- GitHub Pages (hosting)
- GitHub Actions (CI/CD)

## Lightspeed Account ID
Find it in your Lightspeed URL:
`https://retail.lightspeedapp.com/account/XXXXXX/` ← that number
