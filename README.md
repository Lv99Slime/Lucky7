# Lucky 7 Classroom

Play online: https://lv99slime.github.io/Lucky7/

A private classroom pass-and-play browser game inspired by press-your-luck card play.

This project does not use official Flip 7 artwork, card faces, logos, or branding.

## How To Play

Open `index.html` in a phone, iPad, or desktop browser.

The game supports:

- 3-8 players on one shared device
- Short 100-point games, standard 200-point games, or a custom target
- Classic and With Vengeance modes
- Hit / Stay turns
- Bust detection
- Second Chance
- Freeze
- Flip Three
- + score cards and x2 score card
- Lucky 7 bonus for seven different number cards
- With Vengeance Special Numbers, negative Modifiers, Just One More, Flip Four, Swap, Steal, and Discard
- Round summaries
- Tiebreak rounds
- One-step undo
- Game log
- Teacher controls for ending a round and editing scores
- Local browser save for continuing the last game

## Files

- `index.html` is the entry point.
- `styles.css` contains the phone/iPad layout and card styling.
- `game-core.js` contains the game rules and scoring logic.
- `app.js` connects the rules to the browser UI.
- `tests/game-core.test.js` checks core rules.

## Test

Run:

```powershell
npm.cmd test
```

If PowerShell blocks `npm`, run the test file directly with Node.
