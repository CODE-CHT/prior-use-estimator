# Prior Use Estimator

A tool for buyers of pre-owned furniture. Describe a piece you're considering and it estimates the **FFi (Flatulence Factor Index)** — the cumulative number of flatus events the item has likely absorbed over its service life — then generates a ready-to-send negotiation brief you can paste to the seller.

The estimate is a genuine model, not a random score: it's built from published flatus-frequency research and adjusted for household size, children, dogs, activity patterns, seat capacity, material, and age.

**Live:** https://code-cht.github.io/prior-use-estimator/

## How the estimate works

- Adults emit a baseline of ~32 flatus events/day, spread across a 24-hour day.
- Children emit at the adult rate with roughly half the social suppression.
- Dogs emit at ~1.5× the human rate, with no suppression, on their own schedule.
- Seat capacity caps how much of the household can occupy the piece at once.
- The daily total is compounded over the item's age; material sets a separate odor-retention rating.

Full methodology and citations are shown in the app.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/
```

Built with React, Vite, and Tailwind CSS. Deployed to GitHub Pages via GitHub Actions.

## About

A [WristSkill](https://wristskill.com/projects) project. See more work at **https://wristskill.com/projects**.

## License

MIT © 2026 WristSkillLabs LLC — see [LICENSE](LICENSE).
