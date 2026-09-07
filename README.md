# Liminal Poker

Practice NL Hold em + Blackjack. Practice chips only.

## Play online

- GitHub Pages: https://bitball41.github.io/poker/
- One-file CDN launcher: open launcher.html locally (loads from jsdelivr gh/bitball41/poker@main/docs/)

## Quick start

npm install
npm run dev

## Game modes

1. NL Hold em — /play, /lobby/:code
2. Blackjack — /blackjack

## Bots

Mira, Rook, Jinx, Harbor, Volt, Quill, Sage, Fox

## Backend

Apply supabase/migrations/001_poker_schema.sql. Copy .env.example to .env and set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.

## Build

npx vite build

Output: docs/ with docs/assets/app.js and docs/assets/index.css.
