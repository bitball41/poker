# Third-party strategy references

## JsPoker status3Bot

The practice bot policy in `src/bots/tournamentPolicy.ts` is a clean-room TypeScript adaptation of the high-level strategy structure used by `status3Bot` from the MIT-licensed `mdp/JsPoker` project.

Source project: https://github.com/mdp/JsPoker
Original bot: `players/status3Bot.js`
License: MIT

The original JsPoker game engine and bot source are not bundled into this application. The policy was rewritten against this project's own rules engine, hand evaluator, equity calculator, and legal-action model.
