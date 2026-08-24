// ==UserScript==
// @name         Claude/Gemini Auto RTL (per-block, LinkedIn-style)
// @namespace    bar.rtl.claude
// @version      1.22
// @description  Auto-detect direction per text block by majority word count (Hebrew=RTL, English=LTR), like LinkedIn posts, biased to favor RTL so scattered English filler words can't flip a Hebrew sentence. Multi-line plain-text pastes (e.g. link previews) get per-line direction instead of one whole-block tally. Also tags leaf div/span text (custom UI cards/pickers), not just p/li, including inside open shadow DOM nested arbitrarily deep (e.g. Gemini/Opal gem widgets), with a periodic fallback rescan in case MutationObserver ever misses staged shadow DOM construction. Lists (ol/ul) vote per-item then by item majority. Live input boxes use the same majority logic. Rescans on streamed text changes too. Always on, no manual toggle needed. Code blocks stay LTR.
// @match        https://claude.ai/*
// @match        https://gemini.google.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/BarcDevs/claude-auto-rtl/main/ClaudeAutoRTL.user.js
// @downloadURL  https://raw.githubusercontent.com/BarcDevs/claude-auto-rtl/main/ClaudeAutoRTL.user.js
// ==/UserScript==

;(() => {
  const DEBUG = true

  const TEXT_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt'
  const LIST_SELECTOR = 'ol, ul'
  // Custom UI (approval cards, option pickers, etc.) renders text in plain
  // div/span instead of p/li, so none of the above ever match it. Only the
  // leaf-most div/span (no nested block-level descendant) are eligible, so
  // a big wrapper div around a whole card doesn't get tagged over its
  // entire (mixed) content instead of each option individually.
  const LEAF_SELECTOR = 'div, span'
  const BLOCK_DESCENDANT_SELECTOR = 'p, div, li, ol, ul, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt'
  const SKIP_ANCESTOR_SELECTOR = 'pre, code'
  const LIVE_INPUT_ANCESTOR_SELECTOR = 'textarea, div[contenteditable="true"]'

  const RTL_CHAR = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/
  const LTR_CHAR = /[A-Za-z]/
  const LTR_BIAS_FACTOR = 2

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
    // LTR must clearly outnumber RTL (not just win by one word) to flip a
    // Hebrew sentence: short English filler/function words ("word", "one",
    // "below", "Pick") are common even in overwhelmingly-Hebrew sentences,
    // and a plain >= majority let a handful of them flip a sentence that
    // reads as Hebrew (e.g. "איזו word מנצחת today? Pick one מהאפשרויות
    // below:") to ltr.
    return ltrWords > rtlWords * LTR_BIAS_FACTOR ? 'ltr' : 'rtl'
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

  // Direction for a list: vote per-<li> then majority-of-items, not one
  // word-count tally over the whole list's text. A single spec-heavy item
  // (e.g. "VM.Standard.A1.Flex ... 24GB RAM") can rack up enough English
  // words on its own to outweigh two Hebrew-majority items combined - voting
  // per item first stops one item's word count from swamping the others.
  function detectListDirection(el) {
    let rtlItems = 0
    let ltrItems = 0
    ;[...el.children].filter((c) => c.tagName === 'LI').forEach((li) => {
      const dir = detectDirection(directionText(li).trim())
      if (dir === 'rtl') rtlItems++
      else if (dir === 'ltr') ltrItems++
    })
    if (rtlItems === 0 && ltrItems === 0) return null
    return rtlItems >= ltrItems ? 'rtl' : 'ltr'
  }

  // For plain-text elements (no inline formatting - just text nodes, e.g. a
  // pasted link-preview blob with white-space:pre-wrap) that contain literal
  // newlines: one word-count tally over the whole block picks a single
  // direction for everything, so a mostly-English pasted block with a
  // Hebrew line before/after it drags that Hebrew line along with it. Voting
  // per physical line and wrapping each in its own <span dir=...> - same
  // principle as the per-<li> list vote - lets each line render in its own
  // direction. Returns true if it handled (or already handled) the element,
  // so the caller skips the normal whole-block path.
  function tagMultilineText(el) {
    if (![...el.childNodes].every((n) => n.nodeType === Node.TEXT_NODE)) return el.getAttribute('data-rtl-auto') === 'mixed'
    const text = el.textContent
    if (!text.includes('\n')) return false
    const lines = text.split('\n')
    const dirs = lines.map((line) => detectDirection(line.trim()))
    if (new Set(dirs.filter(Boolean)).size <= 1) return false // uniform - normal whole-block path handles it
    el.textContent = ''
    lines.forEach((line, i) => {
      const span = document.createElement('span')
      const dir = dirs[i]
      if (dir) {
        span.setAttribute('dir', dir)
        span.style.setProperty('direction', dir, 'important')
        span.style.setProperty('text-align', dir === 'rtl' ? 'right' : 'left', 'important')
      }
      // display:block so dir/text-align actually take effect (inline elements
      // ignore text-align on themselves). An empty line's span would then
      // collapse to zero height and silently eat the blank line, so give it
      // a non-breaking space to hold its height instead.
      span.style.display = 'block'
      span.textContent = line || ' '
      el.appendChild(span)
    })
    el.setAttribute('data-rtl-auto', 'mixed')
    return true
  }

  function tagElement(el) {
    if (el.closest(SKIP_ANCESTOR_SELECTOR)) return
    if (el.closest(LIVE_INPUT_ANCESTOR_SELECTOR)) return // handled by bindInputs instead
    if (!el.textContent?.trim()) return
    if (el.matches(LEAF_SELECTOR) && el.querySelector(BLOCK_DESCENDANT_SELECTOR)) return // not a leaf - a child will be tagged instead
    if (!el.matches(LIST_SELECTOR) && tagMultilineText(el)) return
    const dir = el.matches(LIST_SELECTOR) ? detectListDirection(el) : detectDirection(directionText(el).trim())
    if (!dir) return
    if (el.getAttribute('data-rtl-auto') === dir) return
    applyDirection(el, dir)
  }

  // Lists are tagged as a whole (ol/ul), not per-<li>: per-item majority let
  // each item flip direction independently, so the marker/indent side jumped
  // from item to item within the same list. List items inherit direction/
  // text-align from the tagged ol/ul via normal CSS cascade.
  const BLOCK_SELECTOR = `${TEXT_SELECTOR}, ${LIST_SELECTOR}, ${LEAF_SELECTOR}`

  // querySelectorAll never crosses shadow-DOM boundaries, so custom elements
  // that render via an open shadow root (e.g. Gemini gem widgets using
  // declarative shadow DOM, <template shadowrootmode="open">) are otherwise
  // completely invisible to this scan - every element and its descendants
  // inside the shadow tree, recursively into nested shadow roots too.
  let shadowRootsSeen = 0
  function scanRoot(root) {
    if (!root || !root.querySelectorAll) return 0
    let count = 0
    if (root instanceof Element && root.matches?.(BLOCK_SELECTOR)) {
      try {
        tagElement(root)
      } catch (e) {
        if (DEBUG) console.error('[claude-rtl-auto] tagElement threw on root', root, e)
      }
      count++
    }
    root.querySelectorAll('*').forEach((el) => {
      if (el.matches(BLOCK_SELECTOR)) {
        try {
          tagElement(el)
        } catch (e) {
          if (DEBUG) console.error('[claude-rtl-auto] tagElement threw on', el, e)
        }
        count++
      }
      if (el.shadowRoot) {
        shadowRootsSeen++
        try {
          count += scanRoot(el.shadowRoot)
        } catch (e) {
          if (DEBUG) console.error('[claude-rtl-auto] scanRoot threw descending into shadow of', el, e)
        }
      }
    })
    return count
  }

  // Live input boxes (textarea / contenteditable): update direction as you type,
  // exactly like LinkedIn's post composer.
  function bindInputs() {
    document.querySelectorAll('textarea:not([data-rtl-bound]), div[contenteditable="true"]:not([data-rtl-bound])').forEach((el) => {
      el.setAttribute('data-rtl-bound', '')
      const update = () => {
        // Word-count majority, same as rendered blocks - not first-strong-char.
        // First-strong-char locked the box to whatever direction the first
        // typed word happened to be, so a Hebrew sentence that opened with an
        // English term (e.g. "VM רץ על ה..." or "maintenance window מה זה...")
        // stayed stuck ltr for its whole (majority-Hebrew) length.
        const text = el.value ?? el.textContent ?? ''
        const dir = detectDirection(text) || 'rtl' // default to RTL when empty
        applyDirection(el, dir)
      }
      el.addEventListener('input', update)
      update()
    })
  }

  if (DEBUG) console.log('[claude-rtl-auto] loaded v1.22')

  // Initial pass
  const initialCount = scanRoot(document.body)
  bindInputs()
  if (DEBUG) console.log(`[claude-rtl-auto] initial scan: ${initialCount} elements, ${shadowRootsSeen} shadow roots crossed`)

  // Debounced observer - watches characterData too (text streams into existing
  // paragraphs via text-node mutations, not childList), so a block that finishes
  // streaming without a later childList change would otherwise never get rescanned
  // and stay stuck on the browser's native first-strong-char dir. Throttled to one
  // scan per 200ms via the `pending` flag, so this doesn't reintroduce the freeze.
  let pending = false
  function scheduleScan() {
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      shadowRootsSeen = 0
      const count = scanRoot(document.body)
      bindInputs()
      observeDeep(document.body)
      if (DEBUG) console.log(`[claude-rtl-auto] scanned ${count} elements, ${shadowRootsSeen} shadow roots crossed`)
    }, 200)
  }

  // MutationObserver.observe(subtree:true) also never crosses shadow-DOM
  // boundaries, so a shadow tree's own mutations (e.g. streamed gem widget
  // text) would go unnoticed even though the initial scan can now find and
  // tag it. Track which roots already have an observer attached so we don't
  // re-call observer.observe() on the same root every pass, but - critically -
  // always keep walking children even for already-observed roots, since a
  // brand new shadow root can appear nested under one we're already watching
  // at any time (e.g. a newly streamed gem widget). Gating the whole function
  // on "already observed" (as an earlier version did) meant document.body -
  // already observed after the very first call - short-circuited before ever
  // re-discovering shadow roots created afterward.
  const observedRoots = new WeakSet()
  const observer = new MutationObserver(() => scheduleScan())
  function observeDeep(root) {
    if (!observedRoots.has(root)) {
      observedRoots.add(root)
      observer.observe(root, { childList: true, subtree: true, characterData: true })
    }
    root.querySelectorAll?.('*').forEach((el) => {
      if (el.shadowRoot) observeDeep(el.shadowRoot)
    })
  }
  observeDeep(document.body)

  // Belt-and-suspenders: some hosts (e.g. Gemini's Opal gem widgets) build
  // deeply-nested shadow DOM in stages across their own internal render
  // cycle, and specific mutation timings there have been observed to leave
  // MutationObserver never firing again for the rest of the page (root cause
  // unconfirmed - possibly a mutation batch that lands entirely inside a
  // shadow root discovered/observed only *after* that same batch already
  // happened). scanRoot/observeDeep are cheap and idempotent, so just also
  // re-run them periodically regardless of whether any mutation was observed,
  // as a reliable fallback.
  setInterval(() => {
    shadowRootsSeen = 0
    const count = scanRoot(document.body)
    observeDeep(document.body)
    if (DEBUG) console.log(`[claude-rtl-auto] periodic rescan: ${count} elements, ${shadowRootsSeen} shadow roots crossed`)
  }, 2000)
})()