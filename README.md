# Claude Auto RTL

Userscript (Tampermonkey) that auto-detects text direction per block on [claude.ai](https://claude.ai) and [gemini.google.com](https://gemini.google.com) — Hebrew/Arabic gets RTL, English gets LTR — the same way LinkedIn handles mixed-direction posts.

Direction is chosen by majority strong-character count per block, not just the first character, so a Hebrew paragraph that happens to start with an English word or a number still renders RTL correctly instead of getting mangled by the browser's bidi reordering.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or any userscript manager).
2. Click: [Install ClaudeAutoRTL.user.js](https://raw.githubusercontent.com/BarcDevs/claude-auto-rtl/main/ClaudeAutoRTL.user.js) — Tampermonkey will detect the `.user.js` file and open its install prompt automatically.
3. Confirm install. It runs automatically on `https://claude.ai/*` and `https://gemini.google.com/*`.

Updates: Tampermonkey periodically re-checks this URL for new `@version` values and offers to update.

## Notes

- Code blocks (`pre`, `code`) are always left LTR.
- Live input boxes (composer / contenteditable) update direction as you type.
- ChatGPT already handles this correctly natively, so it's not targeted.
- To extend to other sites, add a `@match` line in the script header — the block selector (`p, li, h1-h6, blockquote, td, th, dd, dt`) is site-agnostic.
