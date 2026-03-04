# resti — Hudson Yards Restaurant Guide

---

## Part 1 — Get your Gemini API key

1. Go to https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click **Create API Key**
4. Copy the key — it looks like a long string of letters and numbers
5. Paste it somewhere safe (Notes app is fine) — you'll need it in Part 3

---

## Part 2 — Set up GitHub

**Create your GitHub account** (if you don't have one):
1. Go to https://github.com and sign up, verify your email

**Create the repository:**
1. Click the + icon (top right) then New repository
2. Name it exactly: resti
3. Set to Public
4. Leave everything else unchecked, click Create repository
5. On the next page, copy the URL shown (https://github.com/YOUR_USERNAME/resti.git)

---

## Part 3 — Set up the project on your computer

Open Terminal (Mac) or Command Prompt (Windows).

**Check Node.js is installed:**
```
node --version
```
If you get an error, download Node from https://nodejs.org (click the LTS button)

**Set up the project:**
```
cd ~/Downloads/resti
npm install
cp .env.example .env.local
```

**Add your API key:**
1. Open the resti folder in Finder/File Explorer
2. Show hidden files: Mac = Cmd+Shift+. / Windows = View > check Hidden Items
3. Open .env.local in any text editor
4. Replace your_gemini_api_key_here with your actual key from Part 1
5. Save the file

**Test it locally (optional):**
```
npm run dev
```
Open http://localhost:5173/resti/ — the app should load with AI search working.
Press Ctrl+C to stop when done.

---

## Part 4 — Push to GitHub

Run these in Terminal one at a time. Replace YOUR_USERNAME with your GitHub username.

```
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/YOUR_USERNAME/resti.git
git branch -M main
git push -u origin main
```

When prompted for a password, use a Personal Access Token (not your GitHub password):
GitHub > Settings > Developer Settings > Personal Access Tokens > Tokens (classic) > Generate new token > check "repo" > Generate > copy it

**Then deploy:**
```
npm run deploy
```

---

## Part 5 — Enable GitHub Pages

1. Go to https://github.com/YOUR_USERNAME/resti
2. Click Settings > Pages (left sidebar)
3. Source: Deploy from a branch
4. Branch: gh-pages / (root)
5. Click Save

Wait 1-2 minutes. Your site goes live at:
https://YOUR_USERNAME.github.io/resti/

---

## Updating later

Any time you make changes, just run:
```
npm run deploy
```

---

## Security note

Your API key is in .env.local which is gitignored and will NOT upload to GitHub.
It does end up in the compiled JS, so keep the URL to trusted people.
Gemini free tier limits are low enough that accidental abuse is not a real concern.
