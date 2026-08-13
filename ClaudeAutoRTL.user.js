// ==UserScript==
// @name         Claude/Gemini Auto RTL (per-block, LinkedIn-style)
// @namespace    bar.rtl.claude
// @version      1.11
// @description  Auto-detect direction per text block by majority word count (Hebrew=RTL, English=LTR), like LinkedIn posts. Live input boxes lock to first-strong-char instead. Always on, no manual toggle needed. Code blocks stay LTR.
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
    // Majority by WORD count, not char count and not first-strong-char.
    // Char-count breaks on technical Hebrew prose: English words average
    // longer than Hebrew ones, so a handful of terms like "cosine
    // similarity"/"declining/improving" can out-weight a Hebrew-majority
    // paragraph on raw character count alone. Word count doesn't have that
    // length bias, and first-strong-char breaks whenever the paragraph opens
    // with an English word/number - then the browser's bidi algorithm
    // reorders the embedded Hebrew runs inside an ltr block into a mess.
    let rtlWords = 0
    let ltrWords = 0
    for (const word of text.split(/\s+/)) {
      if (RTL_CHAR.test(word)) rtlWords++
      else if (LTR_CHAR.test(word)) ltrWords++
    }
    if (rtlWords === 0 && ltrWords === 0) return null // no strong char - leave as-is
    return rtlWords >= ltrWords ? 'rtl' : 'ltr'
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

  // Text for direction-counting purposes, skipping inline <code> spans
  // (variable/function names) - those are technical tokens embedded in prose,
  // not evidence of the paragraph's actual reading direction, and long
  // identifiers like DEFAULT_WEIGHTS/adaptWeights/semanticScore can otherwise
  // outweigh the surrounding Hebrew and flip the whole paragraph to ltr.
  function directionText(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest('code') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      },
    })
    let text = ''
    let node
    while ((node = walker.nextNode())) text += node.nodeValue
    return text
  }

  function tagElement(el) {
    if (el.closest(SKIP_ANCESTOR_SELECTOR)) return
    if (el.closest(LIVE_INPUT_ANCESTOR_SELECTOR)) return // handled by bindInputs instead
    if (!el.textContent?.trim()) return
    const text = directionText(el).trim()
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

  if (DEBUG) console.log('[claude-rtl-auto] loaded v1.11')

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