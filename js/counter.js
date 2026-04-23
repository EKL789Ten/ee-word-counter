/* =========================================================
   counter.js — IB EE rule-aware word counting
   Pure functions, no side effects. Safe to unit-test.
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------- Tokeniser ---------- */
  // Counts "words" as sequences of letters/numbers/apostrophes/hyphens separated
  // by whitespace. Aligns with how Microsoft Word and the IB EE guide describe
  // a word for assessment purposes.
  function countWords(text) {
    if (!text || typeof text !== 'string') return 0;
    const cleaned = text
      .replace(/\u00AD/g, '')            // soft hyphens
      .replace(/[\u2010-\u2015\u2212]/g, '-') // normalise hyphens
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return 0;
    // Split on whitespace; a token counts if it has at least one alphanumeric.
    const tokens = cleaned.split(' ').filter(t => /[\p{L}\p{N}]/u.test(t));
    return tokens.length;
  }

  /* ---------- Plain-text segmentation ---------- */
  // Identify structural regions in a plain-text paste so toggles can exclude them.
  // We use lightweight conventions:
  //   • Bibliography / Works Cited / References — heading line, to end
  //   • Appendix / Appendices — heading line, to end
  //   • Acknowledgements — heading line, to next heading
  //   • Contents / Table of Contents — heading line, to next heading
  //   • Abstract — heading line, to next heading (legacy, pre-2018)
  //   • Block quotes — lines that begin with ">" OR paragraphs indented 4+ spaces
  //   • Footnotes — bracketed [^n] style OR numeric "1. text" lines following a
  //     "Footnotes" heading, OR Markdown-style `[^1]: text` lines anywhere.
  //   • Tables — pipe-delimited markdown tables
  //   • Equations — $$...$$, $...$, \[...\], \(...\)

  const SECTION_PATTERNS = {
    bibliography: /^\s*(works\s+cited|bibliography|references|reference\s+list|sources\s+cited)\s*$/i,
    appendix:     /^\s*(appendix(?:\s*[a-z0-9]+)?|appendices)\b.*$/i,
    acknowledgements: /^\s*(acknowledg(e)?ments?)\s*$/i,
    contents:     /^\s*(contents|table\s+of\s+contents)\s*$/i,
    abstract:     /^\s*abstract\s*$/i,
    footnotesHdr: /^\s*(footnotes|endnotes|notes)\s*$/i,
  };

  const HEADING_LINE = /^\s*(#{1,6}\s+.+|[A-Z][^\.!?\n]{2,80})\s*$/; // permissive

  function segmentPlainText(raw) {
    const text = raw || '';
    const lines = text.split(/\r?\n/);
    const segments = {
      body:          [],  // counted by default
      bibliography:  [],
      appendix:      [],
      acknowledgements: [],
      contents:      [],
      abstract:      [],
      footnotes:     [],
      blockquote:    [],
      table:         [],
      equation:      [],
    };

    // Strip equations / inline math FIRST (on full text) so they don't land
    // in body by accident. Preserve with placeholders.
    let working = text;
    // $$...$$ (display math)
    working = working.replace(/\$\$[\s\S]+?\$\$/g, (m) => {
      segments.equation.push(m.replace(/\$\$/g, ''));
      return ' ';
    });
    // \[...\]
    working = working.replace(/\\\[[\s\S]+?\\\]/g, (m) => {
      segments.equation.push(m.replace(/\\\[|\\\]/g, ''));
      return ' ';
    });
    // Inline $...$  (avoid matching currency — require letters/ops inside)
    working = working.replace(/\$(?!\s)([^$\n]{1,200}?[a-zA-Z\\+\-*/=^_]{1,}[^$\n]{0,200}?)\$/g, (m, inner) => {
      segments.equation.push(inner);
      return ' ';
    });
    // \(...\)
    working = working.replace(/\\\([\s\S]+?\\\)/g, (m) => {
      segments.equation.push(m.replace(/\\\(|\\\)/g, ''));
      return ' ';
    });

    // Pipe tables
    working = working.replace(/(?:^\s*\|.*\|\s*$\n?){2,}/gm, (m) => {
      segments.table.push(m);
      return '';
    });

    // Markdown-style footnote definitions: [^1]: text...
    working = working.replace(/^\s*\[\^[^\]]+\]:\s.+(?:\n(?!\s*(\[\^|#|$)).+)*/gm, (m) => {
      segments.footnotes.push(m);
      return '';
    });

    const workingLines = working.split(/\r?\n/);
    let currentBucket = 'body';
    let footnoteLineMode = false; // active after a "Footnotes" heading

    for (let i = 0; i < workingLines.length; i++) {
      const line = workingLines[i];
      const trimmed = line.trim();

      // Detect section headings that switch bucket
      if (SECTION_PATTERNS.bibliography.test(trimmed)) { currentBucket = 'bibliography'; continue; }
      if (SECTION_PATTERNS.appendix.test(trimmed))     { currentBucket = 'appendix';     continue; }
      if (SECTION_PATTERNS.acknowledgements.test(trimmed)) { currentBucket = 'acknowledgements'; continue; }
      if (SECTION_PATTERNS.contents.test(trimmed))     { currentBucket = 'contents';     continue; }
      if (SECTION_PATTERNS.abstract.test(trimmed))     { currentBucket = 'abstract';     continue; }
      if (SECTION_PATTERNS.footnotesHdr.test(trimmed)) { currentBucket = 'footnotes'; footnoteLineMode = true; continue; }

      // A markdown-heading resets acknowledgements/contents/abstract back to body
      // (bibliography + appendix continue until EOF — common EE convention).
      const isHeading = /^#{1,6}\s+/.test(trimmed) || (/^[A-Z]/.test(trimmed) && trimmed.length < 80 && !/[.!?]$/.test(trimmed) && !/\s/.test(trimmed.slice(-1)) === false);
      if (isHeading && (currentBucket === 'acknowledgements' || currentBucket === 'contents' || currentBucket === 'abstract')) {
        currentBucket = 'body';
      }

      // Block quote (markdown '>' prefix)
      if (/^\s*>/.test(line)) {
        segments.blockquote.push(line.replace(/^\s*>\s?/, ''));
        continue;
      }

      // Footnote-style numbered line ("1. text" or "1) text") while in footnoteLineMode
      if (footnoteLineMode && /^\s*\d+[.)]\s+/.test(line)) {
        segments.footnotes.push(line);
        continue;
      }

      // Route line to current bucket
      segments[currentBucket].push(line);
    }

    return segments;
  }

  /* ---------- Compute against exclusion toggles ---------- */

  const LIMIT_EE = 4000;
  const LIMIT_RPPF = 500;

  // exclusions: { footnotes, bibliography, appendix, acknowledgements,
  //               contents, abstract, blockquote, table, equation }
  function computeFromSegments(segments, exclusions) {
    const breakdown = {};
    const keys = ['body', 'bibliography', 'appendix', 'acknowledgements', 'contents',
                  'abstract', 'footnotes', 'blockquote', 'table', 'equation'];
    for (const k of keys) {
      breakdown[k] = countWords(segments[k].join('\n'));
    }
    breakdown.raw = Object.values(breakdown).reduce((s, n) => s + n, 0);

    let counted = breakdown.body;
    if (!exclusions.bibliography)  counted += breakdown.bibliography;
    if (!exclusions.appendix)      counted += breakdown.appendix;
    if (!exclusions.acknowledgements) counted += breakdown.acknowledgements;
    if (!exclusions.contents)      counted += breakdown.contents;
    if (!exclusions.abstract)      counted += breakdown.abstract;
    if (!exclusions.footnotes)     counted += breakdown.footnotes;
    if (!exclusions.blockquote)    counted += breakdown.blockquote;
    if (!exclusions.table)         counted += breakdown.table;
    if (!exclusions.equation)      counted += breakdown.equation;

    breakdown.counted = counted;
    breakdown.limit = LIMIT_EE;
    breakdown.delta = counted - LIMIT_EE;
    breakdown.percent = Math.min(200, (counted / LIMIT_EE) * 100);
    return breakdown;
  }

  function statusFor(counted, limit) {
    if (counted > limit) return 'over';
    if (counted >= limit * 0.95) return 'warn';
    return 'ok';
  }

  /* ---------- Examiner view — truncate at N words ---------- */
  function truncateToWords(text, n) {
    if (!text) return { before: '', after: '' };
    let count = 0, i = 0, inWord = false, cut = -1;
    while (i < text.length) {
      const ch = text[i];
      const isWordChar = /[\p{L}\p{N}'’\-]/u.test(ch);
      if (isWordChar && !inWord) {
        inWord = true;
        count += 1;
        if (count > n) { cut = i; break; }
      } else if (!isWordChar && inWord) {
        inWord = false;
      }
      i += 1;
    }
    if (cut === -1) return { before: text, after: '' };
    return { before: text.slice(0, cut).trimEnd(), after: text.slice(cut) };
  }

  global.EECounter = {
    countWords,
    segmentPlainText,
    computeFromSegments,
    statusFor,
    truncateToWords,
    LIMIT_EE,
    LIMIT_RPPF,
  };
})(window);
