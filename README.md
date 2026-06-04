# 🏆 Vivid Life Advisors — Discord Sales Bot

A fully automated Discord bot for tracking insurance sales, posting leaderboards, and assigning rank badges to your agents.

---

## ✨ Features

- `/sale` — Opens a form popup to log a new sale (client name, policy type, premium, carrier, notes)
- `/leaderboard` — Shows daily, weekly, or monthly leaderboards with team goal progress bar
- `/mystats` — Agent's personal production stats (ephemeral — only they can see it)
- `/recentsales` — Shows the 5 most recent sales
- `/deletesale` — Delete your own sale if you made a mistake
- 🏅 **Auto rank badges** next to names (Rookie → Producer → Senior Producer → Executive → Elite)
- 📊 **Team goal progress bar** on the monthly leaderboard
- ⏰ **Automatic daily leaderboard** posts at midnight

---

## 🚀 Setup Guide (Step by Step)

### Step 1 — Create Your Discord Bot

1. Go to https://discord.com/developers/applications
2. Click **"New Application"** → name it `Vivid Life Bot`
3. Go to **"Bot"** tab → click **"Add Bot"**
4. Under **"Token"** → click **"Reset Token"** → copy it (save this!)
5. Scroll down and enable these **Privileged Gateway Intents**:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Go to **"OAuth2"** → **"URL Generator"**
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Manage Roles`
7. Copy the generated URL, open it in your browser, and add the bot to your server

### Step 2 — Get Your IDs

Enable **Developer Mode** in Discord (User Settings → Advanced → Developer Mode ON)

- **Client ID**: Discord Developer Portal → Your App → "General Information" → Application ID
- **Guild ID**: Right-click your server name → "Copy Server ID"
- **Sales Channel ID**: Right-click the channel you want sale announcements → "Copy Channel ID"
- **Leaderboard Channel ID**: Right-click the leaderboard channel → "Copy Channel ID"

### Step 3 — Configure the Bot

```bash
# Copy the example config file
cp .env.example .env

# Edit .env with your values
nano .env   # or open in any text editor
```

Fill in all the values in `.env`:
```
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_guild_id_here
SALES_CHANNEL_ID=your_sales_channel_id_here
LEADERBOARD_CHANNEL_ID=your_leaderboard_channel_id_here
MONTHLY_GOAL=200000
```

### Step 4 — Install & Run

```bash
# Install dependencies
npm install

# Register slash commands with Discord (run once)
npm run deploy

# Start the bot!
npm start
```

You should see:
```
✅ Vivid Life Bot is online as Vivid Life Bot#1234
📊 Serving 1 server(s)
⏰ Daily leaderboard scheduled
```

---

## 🎖️ Rank System

| Rank | Monthly Premium | Badge |
|------|----------------|-------|
| Rookie | $0+ | 🟢 |
| Producer | $5,000+ | 🔵 |
| Senior Producer | $15,000+ | 🟣 |
| Executive | $30,000+ | 🟡 |
| Elite | $50,000+ | 🔴 |

Ranks update automatically every time a sale is logged.

---

## 🌐 Hosting (Keep It Running 24/7)

**Option A: Railway.app (Recommended — Free tier)**
1. Push your code to GitHub (make sure `.env` is in `.gitignore`!)
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add your environment variables in Railway's dashboard
4. Done — it runs forever

**Option B: Render.com (Free tier)**
1. Same process — connect GitHub repo
2. Set start command to `npm start`
3. Add env vars in Render dashboard

**Option C: Your own computer (not recommended for 24/7)**
```bash
npm install -g pm2
pm2 start src/index.js --name vivid-life-bot
pm2 save
```

---

## 📁 File Structure

```
vivid-life-sales-bot/
├── src/
│   ├── index.js          # Main bot file
│   ├── commands.js       # All slash commands + modal
│   ├── database.js       # SQLite database & queries
│   ├── leaderboard.js    # Embed builders
│   └── deploy-commands.js # Run once to register commands
├── sales.db              # Auto-created database (don't delete!)
├── .env                  # Your config (never commit this!)
├── .env.example          # Template
└── package.json
```

---

## ❓ Troubleshooting

**Commands not showing up?**
→ Run `npm run deploy` again and wait 1-2 minutes

**Bot not responding?**
→ Check `DISCORD_TOKEN` is correct and the bot is online in your server

**"Missing Permissions" error?**
→ Make sure the bot role is above other roles in Server Settings → Roles

**Bot goes offline when I close my computer?**
→ Deploy to Railway or Render (see Hosting section above)
