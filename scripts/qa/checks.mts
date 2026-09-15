/** Layout / a11y / style checks run inside the page. Returns human-readable findings. */
export const CHECKS = `(() => {
  const out = [];
  const vw = innerWidth, vh = innerHeight;
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const name = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).slice(0,2).join('.') : '') + (e.id ? '#' + e.id : '');
  const txt = (e) => (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);

  // 1. Horizontal overflow: anything poking past the right edge of the viewport (unless inside a horizontal scroller).
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.right > vw + 1 && r.left < vw) {
      let p = e.parentElement, inScroller = false;
      while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { inScroller = true; break; } p = p.parentElement; }
      if (!inScroller) out.push({ kind: 'visual', msg: 'overflows right by ' + Math.round(r.right - vw) + 'px: ' + name(e) + ' "' + txt(e) + '"' });
    }
  }
  // 2. Double focus indicator: focused element has an outline AND an ancestor styles :focus-within with a border/box-shadow change.
  const f = document.activeElement;
  if (f && f !== document.body) {
    const s = getComputedStyle(f);
    const hasOutline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    let p = f.parentElement, ancestorRing = null;
    while (p && p !== document.body) { const ps = getComputedStyle(p); if ((ps.borderStyle !== 'none' && parseFloat(ps.borderWidth) > 0 && ps.borderColor !== 'rgba(0, 0, 0, 0)') || ps.boxShadow !== 'none') { ancestorRing = p; break; } p = p.parentElement; }
    if (hasOutline && ancestorRing) out.push({ kind: 'visual', msg: 'double focus ring: ' + name(f) + ' has outline inside bordered ' + name(ancestorRing) });
  }
  // 3. Tap targets under 40px (WCAG 2.5.8 says 24 min; Apple says 44; we hold the line at 40).
  for (const e of document.querySelectorAll('button, a[href], [role=button], input, select, textarea')) {
    if (!vis(e)) continue; let r = e.getBoundingClientRect();
    // A ::before/::after with content and absolute inset is a hit-area extender; credit it.
    const ps = getComputedStyle(e, '::before'); if (ps.content !== 'none' && ps.position === 'absolute') { const ins = parseFloat(ps.top) || 0; r = { width: r.width - 2 * ins, height: r.height - 2 * ins }; }   // inset:-6px → top = -6 → grows by 12
    // Chips/pills are 31 px tall by design and sit in their own rows with air around them; 40 is for icon buttons and inline links.
    const chip = e.matches('.chip, .me-tag, .tag, .browse-nav a, .b-filters a, .filters a') || e.closest('.s-chips, .me-tags, .why, .tags, .filters');
    const widePill = r.width >= 100 && r.height >= 32;   // a 130×35 pill is easy to hit; the 40 floor is for square icon buttons
    if (!chip && !widePill && (r.width < 40 || r.height < 40)) { if (!e.closest('[hidden]')) out.push({ kind: 'a11y', msg: 'tap target ' + Math.round(r.width) + 'x' + Math.round(r.height) + ': ' + name(e) + ' "' + txt(e) + '"' }); }
  }
  // 4. Buttons / links with no accessible name.
  for (const e of document.querySelectorAll('button, a[href]')) {
    if (!vis(e)) continue;
    const n = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '').trim();
    if (!n) out.push({ kind: 'a11y', msg: 'no accessible name: ' + name(e) });
  }
  // 5. Text clipped by a fixed-height container without ellipsis (overflow hidden + scrollHeight > clientHeight + 2).
  for (const e of document.querySelectorAll('p, span, div, li, h1, h2, h3')) {
    if (!vis(e) || e.children.length || e.classList.contains('sr-only')) continue; const s = getComputedStyle(e);
    if (s.overflow === 'hidden' && e.scrollHeight > e.clientHeight + 2 && s.webkitLineClamp === 'none' && s.textOverflow !== 'ellipsis') out.push({ kind: 'visual', msg: 'text clipped: ' + name(e) + ' "' + txt(e) + '" (' + e.scrollHeight + '>' + e.clientHeight + ')' });
  }
  // 6. Content under the viewport bottom that isn't in a scroller (below the fold on a fixed-height screen).
  for (const e of document.querySelectorAll('.fcard.splash > *, .sp-bottom > *, .hdr > *')) {
    if (!vis(e)) continue; const r = e.getBoundingClientRect();
    if (r.bottom > vh + 1) out.push({ kind: 'visual', msg: 'below viewport by ' + Math.round(r.bottom - vh) + 'px: ' + name(e) + ' "' + txt(e) + '"' });
  }
  // 7. Images without alt.
  for (const e of document.querySelectorAll('img')) if (vis(e) && !e.hasAttribute('alt')) out.push({ kind: 'a11y', msg: 'img without alt: ' + (e.getAttribute('src') || '').slice(-40) });
  // 8. Overlapping siblings among the splash bottom stack / header (a proxy for "crowded").
  const stacks = [document.querySelectorAll('.sp-bottom > *'), document.querySelectorAll('.sp-mid > *'), document.querySelectorAll('.hdr > *')];
  for (const st of stacks) { const rs = [...st].filter(vis).map((e) => [name(e), e.getBoundingClientRect()]); for (let i = 1; i < rs.length; i++) { const a = rs[i-1][1], b = rs[i][1]; if (b.top < a.bottom - 1 && b.left < a.right && b.right > a.left) out.push({ kind: 'visual', msg: 'overlap: ' + rs[i-1][0] + ' / ' + rs[i][0] + ' by ' + Math.round(a.bottom - b.top) + 'px' }); } }
  return out;
})()`;
