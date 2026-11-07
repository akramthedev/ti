# Did you do it? — daily check-in

No to-do list. Two tasks, one exact timer each, and a planner of day blocks until the INF401 exam (15.01.2027).
Plain HTML, CSS and JS. No build, no server, no dependencies. Everything is saved in your browser's localStorage.

**Open it:** open `index.html` in any browser (or enable GitHub Pages to use it on your phone).

## Tasks (fixed in code)
- **Math INF401 · focused** — 5 h / day
- **telc C1 · Sprechen** — 3 h / day

## The rule: only the timer counts
A task is **done only when its timer reaches the goal**. There is no manual time, no manual Yes, no reset, no goal editing and no import. A past day below the goal is a miss (red).

- **Away guard:** if the page was closed, asleep or frozen for more than 3 minutes, the timer stops and that gap is **not counted**. Changing tabs is fine as long as the tab stays alive.
- **One timer at a time**, and two open tabs stay in sync, so time can't be double counted.
- **Tamper seal:** if the saved data is edited by hand (DevTools / localStorage), the app detects it and shows a permanent red warning.
- Goals are read from the code, never from storage.

Limits: this runs only in your browser, so someone who edits `app.js` itself or changes the system clock can still cheat. It stops the easy cheats and makes the hard ones visible.

## Features
- **Planner:** one block per day until the exam. Green = both goals hit, half-orange = one, red = missed, 🏁 = exam. Click a block to open that day.
- **Goal moment:** full-screen celebration with confetti and a streak counter, pings at 25 / 50 / 75 % and at +1 h overtime.
- **Achievements:** first goal, double day, 3 / 7 / 14-day streaks, overachiever, 20 / 50 / 100 hours.
- **Stats:** streak, days done in the last 30, last 7 days, all-time total, 7-day bars, 17-week heatmap.
- **Telegram (optional):** Settings → Telegram. Paste your bot token, press *Find my chat ID* (after sending `/start` to the bot), save. Each task gets **one live message per day** that is edited in place (every 30 s while running, instantly on start/pause/goal), with a ⏸ Pause button. Yesterday's message gets a final ✅/❌. One extra message (with sound) when you hit a goal; you can turn it off. `/pause` and `/status` work from the chat. There is no remote start and no remote add-time. It only works while the app tab is open, and the token stays on your machine: either in `telegram.config.js` (git-ignored, copy `telegram.config.example.js`) or in Settings → Telegram (browser only). It is never exported. If it leaks, revoke it in @BotFather.
- **Tab title** shows the running time. Export a read-only backup under Settings.
