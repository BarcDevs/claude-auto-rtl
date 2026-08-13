# Claude Auto RTL

Userscript (Tampermonkey) that auto-detects text direction per block on [claude.ai](https://claude.ai) — Hebrew/Arabic gets RTL, English gets LTR — the same way LinkedIn handles mixed-direction posts.

Direction is chosen by majority strong-character count per block, not just the first character, so a Hebrew paragraph that happens to start with an English word or a number still renders RTL correctly instead of getting mangled by the browser's bidi reordering.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or any userscript manager).
2. Create a new script and paste the contents of `ClaudeAutoRTL.js`.
3. Save. It runs automatically on `https://claude.ai/*`.

## Notes

- Code blocks (`pre`, `code`) are always left LTR.
- Live input boxes (composer / contenteditable) update direction as you type.
- Only targets `claude.ai` — see `@match` in the script header to extend to other sites.
