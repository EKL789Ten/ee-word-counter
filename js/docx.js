/* =========================================================
   docx.js — parse .docx entirely client-side via JSZip
   Extracts: body text, footnote text, endnote text,
             header/footer text (not counted by default),
             table-cell text, bibliography-style paragraphs
             (Word built-in style "Bibliography"), and
             equations (oMath nodes — we strip text).

   No uploads. Runs on the user's machine.
   JSZip loaded via CDN in index.html.
   ========================================================= */
(function (global) {
  'use strict';

  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

  function getText(node) {
    // Concatenate <w:t> text within this subtree, inserting a space between
    // paragraphs/breaks so words don't merge.
    if (!node) return '';
    let out = '';
    const walker = document.createTreeWalker(
      node,
      NodeFilter.SHOW_ELEMENT,
      null,
      false
    );
    let n = walker.currentNode;
    while (n) {
      const local = n.localName;
      if (local === 't') {
        out += n.textContent || '';
      } else if (local === 'tab' || local === 'br') {
        out += ' ';
      } else if (local === 'p') {
        out += '\n';
      }
      n = walker.nextNode();
    }
    return out;
  }

  function parseXml(str) {
    return new DOMParser().parseFromString(str, 'application/xml');
  }

  function isBibliographyParagraph(pNode) {
    // Look for <w:pStyle w:val="Bibliography"> or similar
    const pStyle = pNode.getElementsByTagNameNS(W_NS, 'pStyle')[0];
    if (!pStyle) return false;
    const val = pStyle.getAttributeNS(W_NS, 'val') || pStyle.getAttribute('w:val') || '';
    return /bibliography|works.?cited|references/i.test(val);
  }

  function paragraphStyleName(pNode) {
    const pStyle = pNode.getElementsByTagNameNS(W_NS, 'pStyle')[0];
    if (!pStyle) return '';
    return pStyle.getAttributeNS(W_NS, 'val') || pStyle.getAttribute('w:val') || '';
  }

  async function parseDocx(arrayBuffer) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip failed to load. Check your network and try again.');
    }
    const zip = await JSZip.loadAsync(arrayBuffer);

    async function readXml(path) {
      const entry = zip.file(path);
      if (!entry) return null;
      return parseXml(await entry.async('string'));
    }

    const docXml = await readXml('word/document.xml');
    if (!docXml) throw new Error('That file does not look like a Word document.');

    const footnotesXml = await readXml('word/footnotes.xml');
    const endnotesXml  = await readXml('word/endnotes.xml');

    const segments = {
      body:            [],
      bibliography:    [],
      appendix:        [],
      acknowledgements:[],
      contents:        [],
      abstract:        [],
      footnotes:       [],
      blockquote:      [],
      table:           [],
      equation:        [],
    };

    // ---- body traversal ----
    const bodyEl = docXml.getElementsByTagNameNS(W_NS, 'body')[0];
    if (!bodyEl) throw new Error('Document body could not be parsed.');

    // Strip equations first — remove oMath and oMathPara subtrees from the DOM
    // and bucket their text into `equation`.
    const mathNodes = Array.from(
      bodyEl.getElementsByTagNameNS(M_NS, 'oMath')
    ).concat(Array.from(bodyEl.getElementsByTagNameNS(M_NS, 'oMathPara')));
    for (const m of mathNodes) {
      segments.equation.push(getText(m));
      m.parentNode && m.parentNode.removeChild(m);
    }

    // Track heading-based section switching
    const SECTION_KEYWORDS = [
      { bucket: 'bibliography',    rx: /^(works?\s*cited|bibliography|references|reference\s*list)\s*$/i },
      { bucket: 'appendix',        rx: /^(appendix(?:\s*[a-z0-9]+)?|appendices)\b/i },
      { bucket: 'acknowledgements',rx: /^acknowledg(e)?ments?\s*$/i },
      { bucket: 'contents',        rx: /^(contents|table\s*of\s*contents)\s*$/i },
      { bucket: 'abstract',        rx: /^abstract\s*$/i },
    ];

    // Helper to classify a heading paragraph's textual content
    function classifyHeadingText(text) {
      const t = (text || '').trim();
      for (const s of SECTION_KEYWORDS) {
        if (s.rx.test(t)) return s.bucket;
      }
      return null;
    }

    let currentBucket = 'body';

    // Iterate direct children of body in document order. We handle:
    //   <w:p>  – paragraph
    //   <w:tbl> – table
    //   <w:sectPr> – ignored
    const bodyChildren = Array.from(bodyEl.children);
    for (const child of bodyChildren) {
      const local = child.localName;
      if (local === 'p') {
        // Block quote? pStyle or pPr/ind/left >= ~720 twips (0.5")
        const style = paragraphStyleName(child).toLowerCase();
        const isQuote = /quote|blockquote/.test(style);

        // Bibliography style -> bibliography bucket regardless of heading
        if (isBibliographyParagraph(child)) {
          segments.bibliography.push(getText(child));
          continue;
        }

        // Heading styles -> switch bucket based on heading text
        if (/^heading\d*|title/.test(style)) {
          const headingText = getText(child).replace(/\n/g, ' ').trim();
          const switched = classifyHeadingText(headingText);
          if (switched) {
            currentBucket = switched;
            // Do NOT add the heading text itself to the section — skip the line
            continue;
          } else {
            // A non-matching heading inside acknowledgements/contents/abstract
            // returns us to body. Bibliography/appendix persist until EOF.
            if (['acknowledgements', 'contents', 'abstract'].includes(currentBucket)) {
              currentBucket = 'body';
            }
            segments[currentBucket].push(getText(child));
            continue;
          }
        }

        // Regular paragraph
        if (isQuote) {
          segments.blockquote.push(getText(child));
        } else {
          segments[currentBucket].push(getText(child));
        }
      } else if (local === 'tbl') {
        // Entire table routed to the 'table' bucket
        segments.table.push(getText(child));
      }
    }

    // ---- footnotes ----
    if (footnotesXml) {
      const fnNodes = footnotesXml.getElementsByTagNameNS(W_NS, 'footnote');
      for (const fn of Array.from(fnNodes)) {
        const id = fn.getAttributeNS(W_NS, 'id') || fn.getAttribute('w:id');
        const type = fn.getAttributeNS(W_NS, 'type') || fn.getAttribute('w:type') || '';
        // Skip separators
        if (type === 'separator' || type === 'continuationSeparator') continue;
        // Skip Word's automatic id=-1 / 0 placeholders that still carry type
        if (id === '-1' || id === '0') continue;
        segments.footnotes.push(getText(fn));
      }
    }
    if (endnotesXml) {
      const enNodes = endnotesXml.getElementsByTagNameNS(W_NS, 'endnote');
      for (const en of Array.from(enNodes)) {
        const type = en.getAttributeNS(W_NS, 'type') || en.getAttribute('w:type') || '';
        if (type === 'separator' || type === 'continuationSeparator') continue;
        segments.footnotes.push(getText(en));
      }
    }

    return segments;
  }

  global.EEDocx = { parseDocx };
})(window);
