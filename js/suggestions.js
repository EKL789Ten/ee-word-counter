/* =========================================================
   suggestions.js — rule-based "low-load" sentence finder
   Advisory only. Never edits the user's text.
   ========================================================= */
(function (global) {
  'use strict';

  // Fillers / hedges / discourse markers often safely trimmed in academic prose.
  const FILLERS = [
    'basically', 'actually', 'really', 'very', 'quite', 'rather',
    'somewhat', 'perhaps', 'maybe', 'arguably', 'essentially',
    'in a sense', 'in many ways', 'it is important to note that',
    'it should be noted that', 'it is worth mentioning that',
    'it can be argued that', 'needless to say', 'in conclusion',
    'in summary', 'to sum up', 'as mentioned previously',
    'as stated above', 'as stated earlier', 'as previously mentioned',
    'at the end of the day', 'when all is said and done',
    'in order to', 'due to the fact that', 'despite the fact that',
    'for the purpose of', 'with regards to', 'with regard to',
    'on the other hand', 'on the one hand',
    'it goes without saying', 'for all intents and purposes',
  ];

  function splitSentences(text) {
    // Minimal sentence splitter: breaks on . ? ! followed by whitespace + capital,
    // preserving original spans for highlighting.
    const sentences = [];
    const rx = /[^.!?]+[.!?](?:["'”’)\]])?(?:\s|$)/g;
    let m, lastEnd = 0;
    while ((m = rx.exec(text)) !== null) {
      sentences.push({ text: m[0].trim(), start: m.index, end: m.index + m[0].length });
      lastEnd = m.index + m[0].length;
    }
    if (lastEnd < text.length) {
      const tail = text.slice(lastEnd).trim();
      if (tail) sentences.push({ text: tail, start: lastEnd, end: text.length });
    }
    return sentences;
  }

  function words(s) {
    const t = s.trim().split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
    return t;
  }

  function scoreSentence(s) {
    // Higher score = better cut candidate. Score combines:
    //   + filler density
    //   + length (very long sentences are often padded)
    //   + hedge words
    //   + passive voice markers
    const txt = s.text.toLowerCase();
    const w = words(s.text);
    const n = w.length;
    if (n < 6) return { score: 0, reasons: [], words: n };

    let score = 0;
    const reasons = [];

    // Filler matches
    let fillerHits = 0;
    for (const f of FILLERS) {
      const rx = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const matches = txt.match(rx);
      if (matches) fillerHits += matches.length;
    }
    if (fillerHits) {
      score += fillerHits * 6;
      reasons.push(`${fillerHits} filler phrase${fillerHits > 1 ? 's' : ''}`);
    }

    // Length
    if (n > 40) {
      score += (n - 40) * 0.6;
      reasons.push(`very long (${n} words)`);
    } else if (n > 28) {
      score += (n - 28) * 0.3;
      reasons.push(`long (${n} words)`);
    }

    // Passive voice (heuristic: be-verb + past participle)
    if (/\b(is|was|were|been|being|are|be)\s+\w+ed\b/.test(txt)) {
      score += 3;
      reasons.push('passive voice');
    }

    // Redundant connectors at start
    if (/^(however|moreover|furthermore|additionally|thus|hence|therefore|indeed),/i.test(s.text)) {
      score += 2;
      reasons.push('connector trim');
    }

    // Self-reference / meta ("this essay will...", "in this paper...")
    if (/\b(this essay|this paper|this study|in this section)\b/.test(txt)) {
      score += 4;
      reasons.push('meta self-reference');
    }

    return { score, reasons, words: n };
  }

  function suggest(text, targetCut) {
    const sentences = splitSentences(text);
    const scored = sentences.map(s => {
      const r = scoreSentence(s);
      return { ...s, ...r };
    });
    scored.sort((a, b) => b.score - a.score);

    const out = [];
    let wordsSaved = 0;
    for (const s of scored) {
      if (s.score <= 0) break;
      out.push(s);
      wordsSaved += Math.round(s.words * 0.7); // assume trim, not full delete
      if (targetCut && wordsSaved >= targetCut * 1.5 && out.length >= 8) break;
      if (out.length >= 20) break;
    }
    return out;
  }

  global.EESuggest = { suggest };
})(window);
