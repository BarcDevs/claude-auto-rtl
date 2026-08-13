// ==UserScript==
// @name         Claude/Gemini Auto RTL (per-block, LinkedIn-style)
// @namespace    bar.rtl.claude
// @version      1.9
// @description  Auto-detect direction per text block by majority strong-char count (Hebrew=RTL, English=LTR), like LinkedIn posts. Live input boxes lock to first-strong-char instead. Always on, no manual toggle needed. Code blocks stay LTR.
// @match        https://claude.ai/*
// @match        https://gemini.google.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/BarcDevs/claude-auto-rtl/main/ClaudeAutoRTL.user.js
// @downloadURL  https://raw.githubusercontent.com/BarcDevs/claude-auto-rtl/main/ClaudeAutoRTL.user.js
// ==/UserScript==

;(() => {
  const DEBUG = true

  const TEXT_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt'
  const SKIP_ANCESTOR_SELECTOR = 'pre, code'
  const LIVE_INPUT_ANCESTOR_SELECTOR = 'textarea, div[contenteditable="true"]'

  const RTL_CHAR = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/
  const LTR_CHAR = /[A-Za-z]/

  function detectDirection(text) {
    // Majority-count, not first-strong-char: a Hebrew paragraph that opens
    // with an English word/number would otherwise get tagged ltr, then the
    // browser's bidi algorithm reorders the embedded Hebrew runs inside an
    // LTR block and the whole thing turns into a jumbled mess.
    let rtlCount = 0
    let ltrCount = 0
    for (const ch of text) {
      if (RTL_CHAR.test(ch)) rtlCount++
      else if (LTR_CHAR.test(ch)) ltrCount++
    }
    if (rtlCount === 0 && ltrCount === 0) return null // no strong char - leave as-is
    return rtlCount >= ltrCount ? 'rtl' : 'ltr'
  }

  // First-strong-char, not majority: for a live composer, direction must lock
  // in on the first strong character typed and stay put (like dir="auto").
  // Majority-count would flip the whole box mid-sentence once an English word
  // outweighs the Hebrew already typed.
  function detectDirectionFirstStrong(text) {
    for (const ch of text) {
      if (RTL_CHAR.test(ch)) return 'rtl'
      if (LTR_CHAR.test(ch)) return 'ltr'
    }
    return null
  }

  function applyDirection(el, dir) {
    el.setAttribute('dir', dir)
    el.style.setProperty('direction', dir, 'important')
    el.style.setProperty('text-align', dir === 'rtl' ? 'right' : 'left', 'important')
    el.setAttribute('data-rtl-auto', dir)
  }

  function tagElement(el) {
    if (el.closest(SKIP_ANCESTOR_SELECTOR)) return
    if (el.closest(LIVE_INPUT_ANCESTOR_SELECTOR)) return // handled by bindInputs instead
    const text = el.textContent?.trim()
    if (!text) return
    const dir = detectDirection(text)
    if (!dir) return
    if (el.getAttribute('data-rtl-auto') === dir) return
    applyDirection(el, dir)
  }

  function scanRoot(root) {
    if (!(root instanceof Element)) return 0
    let count = 0
    if (root.matches?.(TEXT_SELECTOR)) {
      tagElement(root)
      count++
    }
    root.querySelectorAll?.(TEXT_SELECTOR).forEach((el) => {
      tagElement(el)
      count++
    })
    return count
  }

  // Live input boxes (textarea / contenteditable): update direction as you type,
  // exactly like LinkedIn's post composer.
  function bindInputs() {
    document.querySelectorAll('textarea:not([data-rtl-bound]), div[contenteditable="true"]:not([data-rtl-bound])').forEach((el) => {
      el.setAttribute('data-rtl-bound', '')
      const update = () => {
        const text = el.value ?? el.textContent ?? ''
        const dir = detectDirectionFirstStrong(text) || 'rtl' // default to RTL when empty
        applyDirection(el, dir)
      }
      el.addEventListener('input', update)
      update()
    })
  }

  if (DEBUG) console.log('[claude-rtl-auto] loaded v1.9')

  // Initial pass
  scanRoot(document.body)
  bindInputs()

  // Debounced observer - childList only, no characterData (that's what
  // caused the freeze in an earlier version during streaming responses).
  let pending = false
  function scheduleScan() {
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      const count = scanRoot(document.body)
      bindInputs()
      if (DEBUG) console.log(`[claude-rtl-auto] scanned ${count} elements`)
    }, 200)
  }

  const observer = new MutationObserver(() => scheduleScan())
  observer.observe(document.body, { childList: true, subtree: true })
})()