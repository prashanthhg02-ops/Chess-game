# Quiet Knight

A responsive, browser-based chess game for two players sharing the same device. No installation or build step is required.

## Play

1. Open `index.html` in a modern web browser.
2. Click one of your pieces, then click a highlighted square to move it.
3. White moves first. Players alternate turns on the same board.

The 10-minute clocks start when the first move is made. A game ends on checkmate, timeout, or a recognized draw.

## Features

- Legal move validation, including check and checkmate.
- Castling, en passant, and pawn promotion.
- Draw detection for stalemate, threefold repetition, the fifty-move rule, and insufficient material.
- Move history, undo, board flipping, and optional move sounds.
- Responsive layout for desktop and mobile screens.

## Project files

- `index.html` — page structure and controls.
- `styles.css` — layout, theme, and responsive styles.
- `game.js` — chess rules, game state, clocks, and interactions.

The game has no third-party runtime dependencies. Google Fonts are loaded from the web when available; system fonts are used as fallbacks.
