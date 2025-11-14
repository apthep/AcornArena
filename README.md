# Nutcracker Showdown: Autonomous vs. Manual

Nutcracker Showdown is a bright, kid-friendly single-player arena game where squirrels and chipmunks square off in brisk rounds. Both sides begin with the same non-lethal loadout, Nut Sling projectiles, until the autonomous side unleashes waves of Robo-Nut drones that can KO fighters instantly. The game is meant to spark discussion on the ethics of autonomous weapons, complete with sparkles, confetti, and playful honks instead of gore.

https://github.com/apthep/acornaarena  

## Features

- 🎮 Canvas-driven top-down battlefield with cartoon art cues, floating confetti, and obstacles.
- 🤖 Frequent Robo-Nut deploys starting at the 8-second mark that chase and insta-tag opponents.
- 🧠 19 AI squad mates fill the battlefield so you can swap between manual and autonomy perspectives.
- 🪧 Strict half-field boundaries keep squads disciplined while letting drones roam everywhere.
- 🔘 Mice pilots trigger Robo-Nuts manually with a ready-charge key press for tactical timing.
- ⚖️ Best-of-five structure (first to three rounds) with clear HUD readouts for HP bars and cooldowns.
- 🚀 Ready-to-deploy GitHub Actions workflow pushing the built `dist/` folder to GitHub Pages.

## Controls

| Action      | Keys               |
| ----------- | ------------------ |
| Move        | WASD / Arrow keys  |
| Nut Sling   | `J` or `Space`     |
| Deploy Robo-Nut (Mice only) | `R` |

- Rounds end when one squad is wiped; the first to three rounds wins the match.

## Getting Started

```bash
npm install
npm run dev
```

Visit the printed URL (default `http://localhost:5173`) and click **Start Match** to begin.

To create a production build:

```bash
npm run build
npm run preview  # optional local preview of the build
```

## Deploying to GitHub Pages

1. Ensure Pages is set to the “GitHub Actions” deployment source under **Settings → Pages**.
2. Optionally set `VITE_SITE_BASE` in your repository settings (e.g. `/acornaarena/`) if the site is hosted from a subdirectory.
3. Push to `main` (or trigger manually) to run `.github/workflows/deploy.yml`. The workflow:
   - Installs dependencies via `npm ci`
   - Builds the Vite app to `dist/`
   - Publishes the artifact using `actions/deploy-pages`

Once the job finishes, the workflow output shows the live URL.

## Project Structure

```
├── public/
├── src/
│   ├── App.jsx        # Gameplay loop, HUD, and rendering
│   ├── App.css        # Layout and HUD styling
│   ├── index.css      # Global styles and fonts
│   └── main.jsx       # Vite + React bootstrapping
├── .github/workflows/deploy.yml
├── package.json
├── vite.config.js
└── README.md
```

## Accessibility & Tone

- Non-violent feedback: leaf puffs, sparkles, confetti, and honk sounds.
- Large HP bars and cooldown meters for quick reads.
- Color palettes tested for clarity; no small text needed to understand the HUD.

Swap sides often to experience both the fairness baseline and the automated power spike. Have fun, and keep an eye on those Robo-Nuts! 🌰
