// ==UserScript==
// @name         Claude.ai Auto RTL (per-block, LinkedIn-style)
// @namespace    bar.rtl.claude
// @version      1.6
// @description  Auto-detect direction per text block by majority strong-char count (Hebrew=RTL, English=LTR), like LinkedIn posts. Always on, no manual toggle needed. Code blocks stay LTR.
// @match        https://claude.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

;(() => {
  const DEBUG = true

  const TEXT_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt'
  const SKIP_ANCESTOR_SELECTOR = 'pre, code'

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

  function applyDirection(el, dir) {
    el.setAttribute('dir', dir)
    el.style.setProperty('direction', dir, 'important')
    el.style.setProperty('text-align', dir === 'rtl' ? 'right' : 'left', 'important')
    el.setAttribute('data-rtl-auto', dir)
  }

  function tagElement(el) {
    if (el.closest(SKIP_ANCESTOR_SELECTOR)) return
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
        const dir = detectDirection(text) || 'rtl' // default to RTL when empty
        applyDirection(el, dir)
      }
      el.addEventListener('input', update)
      update()
    })
  }

  if (DEBUG) console.log('[claude-rtl-auto] loaded v1.6')

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