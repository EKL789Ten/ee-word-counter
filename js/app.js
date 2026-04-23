/* =========================================================
   app.js — UI wiring for the EE Word Counter
   ========================================================= */
(function () {
  'use strict';
  const { countWords, segmentPlainText, computeFromSegments, statusFor,
          truncateToWords, LIMIT_EE, LIMIT_RPPF } = window.EECounter;

  /* ---------- Theme toggle (SC 1.4.3/1.4.11) ---------- */
  (function () {
    const toggle = document.querySelector('[data-theme-toggle]');
    const html = document.documentElement;
    let theme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    html.setAttribute('data-theme', theme);
    updateToggle();
    toggle?.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', theme);
      updateToggle();
    });
    function updateToggle() {
      if (!toggle) return;
      const next = theme === 'dark' ? 'light' : 'dark';
      toggle.setAttribute('aria-label', `Switch to ${next} mode`);
      toggle.setAttribute('aria-pressed', String(theme === 'dark'));
      toggle.innerHTML = theme === 'dark'
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }
  })();

  /* ---------- Tab switching (Paste / Upload) ---------- */
  const tabs = document.querySelectorAll('[role="tab"]');
  const panels = document.querySelectorAll('[role="tabpanel"]');
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(i));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        selectTab((i + 1) % tabs.length, true);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        selectTab((i - 1 + tabs.length) % tabs.length, true);
      } else if (e.key === 'Home') { e.preventDefault(); selectTab(0, true); }
      else if (e.key === 'End')    { e.preventDefault(); selectTab(tabs.length - 1, true); }
    });
  });
  function selectTab(i, focus) {
    tabs.forEach((t, j) => {
      const sel = j === i;
      t.setAttribute('aria-selected', String(sel));
      t.setAttribute('tabindex', sel ? '0' : '-1');
    });
    panels.forEach((p, j) => { p.hidden = j !== i; });
    if (focus) tabs[i].focus();
  }

  /* ---------- State ---------- */
  // Current parsed segments. Can come from paste (segmentPlainText) OR .docx parse.
  let currentSegments = emptySegments();
  let sourceMode = 'paste'; // 'paste' | 'docx'
  const exclusions = {
    footnotes: true,
    bibliography: true,
    appendix: true,
    acknowledgements: true,
    contents: true,
    abstract: true,
    blockquote: false,
    table: false,
    equation: true,
  };

  function emptySegments() {
    return {
      body: [], bibliography: [], appendix: [], acknowledgements: [],
      contents: [], abstract: [], footnotes: [], blockquote: [],
      table: [], equation: [],
    };
  }

  /* ---------- Exclusion toggles ---------- */
  document.querySelectorAll('[data-exclude]').forEach((cb) => {
    const key = cb.dataset.exclude;
    cb.checked = !!exclusions[key];
    cb.addEventListener('change', () => {
      exclusions[key] = cb.checked;
      render();
    });
  });

  /* ---------- Paste input ---------- */
  const textarea = document.getElementById('essay-input');
  const pasteCharCount = document.getElementById('paste-char-count');
  let pasteDebounce;
  textarea.addEventListener('input', () => {
    clearTimeout(pasteDebounce);
    pasteDebounce = setTimeout(() => {
      sourceMode = 'paste';
      currentSegments = segmentPlainText(textarea.value);
      pasteCharCount.textContent = `${textarea.value.length.toLocaleString()} characters`;
      render();
    }, 120);
  });

  /* ---------- .docx upload ---------- */
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const dropStatus = document.getElementById('drop-status');

  function setDropStatus(msg, tone) {
    dropStatus.textContent = msg;
    dropStatus.dataset.tone = tone || '';
  }
  function dragActive(on) {
    dropzone.classList.toggle('dropzone--active', on);
  }

  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dragActive(true); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dragActive(false); })
  );
  dropzone.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) handleFile(fileInput.files[0]);
  });

  async function handleFile(file) {
    if (!/\.docx$/i.test(file.name)) {
      setDropStatus('That file isn’t a .docx. Try exporting from Word or Google Docs as .docx.', 'error');
      return;
    }
    setDropStatus(`Reading ${file.name} locally…`, 'info');
    try {
      const buf = await file.arrayBuffer();
      const segs = await window.EEDocx.parseDocx(buf);
      currentSegments = segs;
      sourceMode = 'docx';
      setDropStatus(`Parsed ${file.name}. Nothing was uploaded.`, 'ok');
      render();
    } catch (err) {
      console.error(err);
      setDropStatus(err.message || 'Could not read that file.', 'error');
    }
  }

  /* ---------- Rendering ---------- */
  const big = document.getElementById('count-big');
  const ofLine = document.getElementById('count-of');
  const bar = document.getElementById('count-bar-fill');
  const statusBadge = document.getElementById('count-status');
  const delta = document.getElementById('count-delta');
  const bd = {
    body:           document.getElementById('bd-body'),
    footnotes:      document.getElementById('bd-footnotes'),
    bibliography:   document.getElementById('bd-bibliography'),
    appendix:       document.getElementById('bd-appendix'),
    acknowledgements:document.getElementById('bd-acknowledgements'),
    contents:       document.getElementById('bd-contents'),
    abstract:       document.getElementById('bd-abstract'),
    blockquote:     document.getElementById('bd-blockquote'),
    table:          document.getElementById('bd-table'),
    equation:       document.getElementById('bd-equation'),
    counted:        document.getElementById('bd-counted'),
    raw:            document.getElementById('bd-raw'),
  };
  const flagFootnotes = document.getElementById('flag-footnotes');

  function render() {
    const b = computeFromSegments(currentSegments, exclusions);
    const st = statusFor(b.counted, LIMIT_EE);

    big.textContent = b.counted.toLocaleString();
    ofLine.textContent = `of ${LIMIT_EE.toLocaleString()} word limit`;

    // Bar
    const pct = Math.min(100, (b.counted / LIMIT_EE) * 100);
    bar.style.inlineSize = pct + '%';
    bar.classList.remove('counter-readout__fill--warn', 'counter-readout__fill--over');
    if (st === 'warn') bar.classList.add('counter-readout__fill--warn');
    if (st === 'over') bar.classList.add('counter-readout__fill--over');

    // Status badge
    statusBadge.classList.remove(
      'counter-readout__status--ok',
      'counter-readout__status--warn',
      'counter-readout__status--over'
    );
    let label = '';
    if (st === 'ok')   { statusBadge.classList.add('counter-readout__status--ok');   label = 'Within limit'; }
    if (st === 'warn') { statusBadge.classList.add('counter-readout__status--warn'); label = 'Close to cap'; }
    if (st === 'over') { statusBadge.classList.add('counter-readout__status--over'); label = 'Over the cap'; }
    statusBadge.innerHTML = `<span class="dot" aria-hidden="true"></span>${label}`;

    // Delta — accessible wording
    const absDelta = Math.abs(b.delta);
    if (b.counted === 0) {
      delta.innerHTML = 'Paste or upload your essay to begin.';
    } else if (b.delta === 0) {
      delta.innerHTML = `Exactly at the <strong>${LIMIT_EE.toLocaleString()}</strong>-word limit.`;
    } else if (b.delta > 0) {
      delta.innerHTML = `<strong>${absDelta.toLocaleString()}</strong> word${absDelta === 1 ? '' : 's'} over the limit.`;
    } else {
      delta.innerHTML = `<strong>${absDelta.toLocaleString()}</strong> word${absDelta === 1 ? '' : 's'} remaining.`;
    }

    // Breakdown — show counted vs excluded styling
    setBd('body', b.body, false);
    setBd('footnotes',     b.footnotes,     exclusions.footnotes);
    setBd('bibliography',  b.bibliography,  exclusions.bibliography);
    setBd('appendix',      b.appendix,      exclusions.appendix);
    setBd('acknowledgements', b.acknowledgements, exclusions.acknowledgements);
    setBd('contents',      b.contents,      exclusions.contents);
    setBd('abstract',      b.abstract,      exclusions.abstract);
    setBd('blockquote',    b.blockquote,    exclusions.blockquote);
    setBd('table',         b.table,         exclusions.table);
    setBd('equation',      b.equation,      exclusions.equation);
    bd.counted.textContent = b.counted.toLocaleString();
    bd.raw.textContent = b.raw.toLocaleString();

    // Footnote ratio warning (PP1.7)
    const footnoteRatio = b.body > 0 ? b.footnotes / b.body : 0;
    flagFootnotes.hidden = !(footnoteRatio > 0.25 && b.footnotes > 100);
  }

  function setBd(key, value, excluded) {
    const el = bd[key];
    if (!el) return;
    el.textContent = value.toLocaleString();
    el.classList.toggle('excluded', !!excluded && value > 0);
  }

  /* ---------- Examiner view ---------- */
  const examinerBtn = document.getElementById('open-examiner');
  const examinerDialog = document.getElementById('examiner-dialog');
  const examinerBody = document.getElementById('examiner-body');
  const examinerClose = document.getElementById('close-examiner');

  examinerBtn.addEventListener('click', () => {
    const countedText = buildCountedText();
    const { before, after } = truncateToWords(countedText, LIMIT_EE);
    examinerBody.innerHTML = '';
    const span1 = document.createElement('span');
    span1.textContent = before;
    examinerBody.appendChild(span1);
    if (after) {
      const markIgnored = document.createElement('span');
      markIgnored.className = 'ignored';
      markIgnored.textContent = ' ' + after;
      examinerBody.appendChild(markIgnored);
      const notice = document.createElement('span');
      notice.className = 'cutoff';
      notice.textContent = `↑ IB examiners stop reading at ${LIMIT_EE.toLocaleString()} words. The struck-through text above is not assessed.`;
      examinerBody.appendChild(notice);
    } else {
      const notice = document.createElement('span');
      notice.className = 'cutoff';
      notice.style.color = 'var(--color-success)';
      notice.style.borderColor = 'var(--color-success)';
      notice.textContent = `✓ Your essay fits within the ${LIMIT_EE.toLocaleString()}-word limit.`;
      examinerBody.appendChild(notice);
    }
    examinerDialog.showModal();
  });
  examinerClose.addEventListener('click', () => examinerDialog.close());

  function buildCountedText() {
    // Reassemble only the counted segments in reading order
    const s = currentSegments;
    const parts = [s.body.join('\n')];
    if (!exclusions.contents)       parts.push(s.contents.join('\n'));
    if (!exclusions.acknowledgements) parts.push(s.acknowledgements.join('\n'));
    if (!exclusions.abstract)       parts.push(s.abstract.join('\n'));
    if (!exclusions.blockquote)     parts.push(s.blockquote.join('\n'));
    if (!exclusions.table)          parts.push(s.table.join('\n'));
    if (!exclusions.footnotes)      parts.push(s.footnotes.join('\n'));
    if (!exclusions.equation)       parts.push(s.equation.join('\n'));
    if (!exclusions.bibliography)   parts.push(s.bibliography.join('\n'));
    if (!exclusions.appendix)       parts.push(s.appendix.join('\n'));
    return parts.filter(Boolean).join('\n\n');
  }

  /* ---------- Cut suggestions ---------- */
  const suggestBtn = document.getElementById('open-suggestions');
  const suggestDialog = document.getElementById('suggest-dialog');
  const suggestBody = document.getElementById('suggest-body');
  const suggestClose = document.getElementById('close-suggestions');

  suggestBtn.addEventListener('click', () => {
    const countedText = buildCountedText();
    const counted = countWords(countedText);
    const cut = Math.max(0, counted - LIMIT_EE);
    const results = window.EESuggest.suggest(countedText, cut);
    suggestBody.innerHTML = '';
    if (results.length === 0) {
      suggestBody.innerHTML = `<p style="color:var(--color-text-muted); font-size: var(--text-sm);">No obvious cut candidates found. Your prose is already tight — consider trimming a secondary example or compressing methodology.</p>`;
    } else {
      const frag = document.createDocumentFragment();
      for (const r of results) {
        const el = document.createElement('article');
        el.className = 'cut-suggestion';
        const reason = document.createElement('div');
        reason.className = 'cut-suggestion__reason';
        reason.textContent = r.reasons.join(' · ') || 'candidate';
        const text = document.createElement('p');
        text.className = 'cut-suggestion__text';
        text.textContent = r.text;
        const meta = document.createElement('div');
        meta.className = 'cut-suggestion__meta';
        meta.textContent = `${r.words} words · trim score ${Math.round(r.score)}`;
        el.append(reason, text, meta);
        frag.appendChild(el);
      }
      suggestBody.appendChild(frag);
    }
    suggestDialog.showModal();
  });
  suggestClose.addEventListener('click', () => suggestDialog.close());

  /* ---------- Escape closes native <dialog> (belt + suspenders for old Safari) ---------- */
  [examinerDialog, suggestDialog].forEach((d) => {
    d.addEventListener('cancel', (e) => { /* default close */ });
  });

  /* ---------- RPPF mini-counter ---------- */
  const rppfInput = document.getElementById('rppf-input');
  const rppfCount = document.getElementById('rppf-count');
  const rppfBar = document.getElementById('rppf-bar');
  const rppfStatus = document.getElementById('rppf-status');
  let rppfDebounce;
  rppfInput?.addEventListener('input', () => {
    clearTimeout(rppfDebounce);
    rppfDebounce = setTimeout(() => {
      const n = countWords(rppfInput.value);
      rppfCount.textContent = `${n.toLocaleString()} / ${LIMIT_RPPF}`;
      const pct = Math.min(100, (n / LIMIT_RPPF) * 100);
      rppfBar.style.inlineSize = pct + '%';
      const st = statusFor(n, LIMIT_RPPF);
      rppfBar.classList.remove('counter-readout__fill--warn', 'counter-readout__fill--over');
      if (st === 'warn') rppfBar.classList.add('counter-readout__fill--warn');
      if (st === 'over') rppfBar.classList.add('counter-readout__fill--over');
      rppfStatus.textContent =
        n === 0 ? 'Draft your RPPF reflection to see your count.'
        : st === 'over' ? `${n - LIMIT_RPPF} word${n - LIMIT_RPPF === 1 ? '' : 's'} over the 500-word RPPF limit.`
        : `${LIMIT_RPPF - n} word${LIMIT_RPPF - n === 1 ? '' : 's'} remaining.`;
    }, 120);
  });

  /* ---------- Initial render ---------- */
  render();
})();
