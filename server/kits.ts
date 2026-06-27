// Opt-in style/behavior bundles for html parts. An html part may list kit ids
// in its `kits` field; renderHtmlPage concatenates each requested kit's CSS
// (and JS) into the sandboxed document AFTER the base KIT_CSS. A default html
// part (no `kits`) is untouched — the richer vocabulary only ships when asked
// for, so kits never homogenize freeform html. Kits are a library you import
// per part, not a frame every surface is locked into.
//
// Runtime-agnostic (no node imports): imported by surfacePage (server render),
// surfaceParts (id allowlist), and surfaced over HTTP/MCP for discovery. Every
// class resolves against the theme `--color-*` / `--font-*` / radius tokens, so
// kit output re-themes with the board like any other html part.

export interface Kit {
  id: string;
  label: string;
  // One-line summary for discovery (showcase kits / GET /api/kits).
  summary: string;
  // Compact vocabulary blurb, e.g. "tree · badge · chip · dot · bar".
  classes: string;
  // CSS injected into the sandbox doc when this kit is requested.
  css: string;
  // Optional inline JS (runs at end of body, after the host bridge). Sandboxed.
  js?: string;
}

// Layout + text helpers shared by every kit — injected ONCE whenever any kit is
// requested, so kit-specific css below only declares its distinctive classes.
const CORE_CSS = `
.stack{display:flex;flex-direction:column;gap:8px}.stack.sm{gap:4px}.stack.lg{gap:16px}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.row.sm{gap:4px}
.between{display:flex;align-items:center;justify-content:space-between;gap:12px}
.grow{flex:1;min-width:0}
.title{font:500 15px/1.35 var(--font-sans);color:var(--color-text-primary)}
.dim{color:var(--color-text-secondary)}.faint{color:var(--color-text-tertiary)}
.mono{font-family:var(--font-mono)}.num{font-variant-numeric:tabular-nums}
.hr{height:1px;border:0;margin:2px 0;background:var(--color-border-secondary)}
.kbd{font:400 12px/1 var(--font-mono);padding:2px 6px;border:1px solid var(--color-border-secondary);border-bottom-width:2px;border-radius:6px;background:var(--color-background-secondary);color:var(--color-text-secondary)}
`;

// issues: cards, status badges/dots, mono ref chips, rollup bars, and a nesting
// rail (.tree → nest another .tree to indent). Composes an issue/PR/CI tree,
// a status board, or a PR summary from generic primitives.
const ISSUES_CSS = `
.card{background:var(--color-background-primary);border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-lg);padding:14px 16px}
.card.soft{background:var(--color-background-secondary)}
.badge{display:inline-flex;align-items:center;gap:5px;font:500 12px/1.4 var(--font-sans);padding:2px 9px;border-radius:999px;background:var(--color-background-secondary);color:var(--color-text-secondary)}
.badge.ok{background:var(--color-background-success);color:var(--color-text-success)}
.badge.info{background:var(--color-background-info);color:var(--color-text-info)}
.badge.warn{background:var(--color-background-warning);color:var(--color-text-warning)}
.badge.danger{background:var(--color-background-danger);color:var(--color-text-danger)}
.chip{display:inline-flex;align-items:center;gap:4px;font:400 12px/1.4 var(--font-mono);padding:1px 7px;border-radius:var(--border-radius-md);border:1px solid var(--color-border-secondary);color:var(--color-text-secondary)}
.dot{width:8px;height:8px;border-radius:999px;background:var(--color-text-tertiary);flex:none}
.dot.ok{background:var(--color-text-success)}.dot.info{background:var(--color-text-info)}.dot.warn{background:var(--color-text-warning)}.dot.danger{background:var(--color-text-danger)}
.bar{height:6px;border-radius:999px;background:var(--color-background-secondary);overflow:hidden}
.bar>i{display:block;height:100%;border-radius:inherit;background:var(--color-text-success)}
.tree{display:flex;flex-direction:column;gap:7px;margin:0;padding:0;list-style:none}
.tree .tree{margin-top:7px;margin-left:9px;padding-left:14px;border-left:1px solid var(--color-border-secondary)}
`;

// slides: a stepped deck. Author `.deck` with `.slide` children; the JS shows
// one at a time and injects prev/dots/counter/next controls. Arrow keys and
// PageUp/Down navigate (plain keys only — the host owns the meta/alt combos).
const SLIDES_CSS = `
.deck{display:block}
.deck>.slide{display:none}
.deck>.slide.on{display:block;min-height:140px}
.deck>.slide h2{font:500 22px/1.3 var(--font-sans);margin:0 0 14px}
.deck-ctl{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:18px;padding-top:14px;border-top:1px solid var(--color-border-secondary)}
.deck-dots{display:inline-flex;gap:7px}
.deck-dots i{width:7px;height:7px;border-radius:999px;background:var(--color-border-primary);cursor:pointer}
.deck-dots i.on{background:var(--color-text-info)}
.deck-num{font:400 13px/1 var(--font-mono);color:var(--color-text-tertiary);min-width:46px;text-align:center}
/* Print / PDF: slides default to hidden (JS shows one at a time), so reveal all
   of them stacked and drop the controls — the deck prints as a full handout. */
@media print{.deck>.slide{display:block!important;min-height:0}.deck-ctl{display:none!important}}
`;

const SLIDES_JS = `
(function(){
  var deck=document.querySelector('.deck');if(!deck)return;
  var slides=[].slice.call(deck.querySelectorAll(':scope > .slide'));if(!slides.length)return;
  var i=0;
  var ctl=document.createElement('div');ctl.className='deck-ctl';
  var prev=document.createElement('button');prev.type='button';prev.setAttribute('aria-label','Previous slide');prev.textContent='‹';
  var next=document.createElement('button');next.type='button';next.setAttribute('aria-label','Next slide');next.textContent='›';
  var dots=document.createElement('span');dots.className='deck-dots';
  var num=document.createElement('span');num.className='deck-num';
  slides.forEach(function(_,k){var d=document.createElement('i');d.setAttribute('role','button');d.addEventListener('click',function(){go(k);});dots.appendChild(d);});
  ctl.appendChild(prev);ctl.appendChild(dots);ctl.appendChild(num);ctl.appendChild(next);
  deck.appendChild(ctl);
  function go(n){i=(n+slides.length)%slides.length;
    slides.forEach(function(s,k){s.classList.toggle('on',k===i);});
    [].forEach.call(dots.children,function(d,k){d.classList.toggle('on',k===i);});
    num.textContent=(i+1)+' / '+slides.length;}
  prev.addEventListener('click',function(){go(i-1);});
  next.addEventListener('click',function(){go(i+1);});
  document.addEventListener('keydown',function(e){
    if(e.metaKey||e.altKey||e.ctrlKey)return;
    if(e.key==='ArrowRight'||e.key==='PageDown'){e.preventDefault();go(i+1);}
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();go(i-1);}});
  go(0);
})();
`;

// animate: a stepped, building-up explainer. Author `.anim` with `.step`
// children; the JS reveals them cumulatively (each step adds to the last) and
// injects a play/pause button, a scrub range, and a counter. Space toggles play,
// arrows step, the slider scrubs. The just-revealed step animates in; `.cue`
// highlights a phrase. Built for "walk me through this" explainers (pairs with
// an image part of the thing being explained).
const ANIMATE_CSS = `
.anim{display:block}
.anim>.step{display:none}
.anim>.step.on{display:block}
.anim>.step.now{animation:anim-in .4s ease both}
@keyframes anim-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.anim>.step.now{animation:none}}
.cue{background:var(--color-background-info);color:var(--color-text-info);border-radius:var(--border-radius-md);padding:0 4px}
.anim-ctl{display:flex;align-items:center;gap:12px;margin-top:16px;padding-top:14px;border-top:1px solid var(--color-border-secondary)}
.anim-play{flex:none;width:30px;height:30px;border-radius:999px;border:1px solid var(--color-border-secondary);background:var(--color-background-secondary);color:var(--color-text-primary);cursor:pointer;font:12px/1 var(--font-sans);display:inline-flex;align-items:center;justify-content:center}
.anim-play:hover{border-color:var(--color-border-primary)}
.anim-range{flex:1;min-width:0;accent-color:var(--color-text-info);cursor:pointer}
.anim-num{flex:none;font:400 13px/1 var(--font-mono);color:var(--color-text-tertiary);min-width:48px;text-align:right}
/* Section eyebrow — shows the current step's data-label / data-section (a
   blueprint's structure skeleton). Empty when a step carries neither, so a plain
   .anim is untouched. */
.anim-label{flex:none;font:600 11px/1 var(--font-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-info);white-space:nowrap}
/* Print / PDF: a stepper can't be played on paper, and steps default to hidden
   (JS reveals them) — so a print would be blank. Reveal every step stacked and
   drop the controls, turning the explainer into the full static explanation. */
@media print{.anim>.step{display:block!important;animation:none!important}.anim-ctl{display:none!important}}
`;

const ANIMATE_JS = `
(function(){
  var anim=document.querySelector('.anim');if(!anim)return;
  var steps=[].slice.call(anim.querySelectorAll(':scope > .step'));if(!steps.length)return;
  var i=0,timer=null;
  var ctl=document.createElement('div');ctl.className='anim-ctl';
  var play=document.createElement('button');play.type='button';play.className='anim-play';play.setAttribute('aria-label','Play');play.textContent='\\u25B6';
  var range=document.createElement('input');range.type='range';range.className='anim-range';range.min='0';range.max=String(steps.length-1);range.value='0';range.setAttribute('aria-label','Step');
  var num=document.createElement('span');num.className='anim-num';
  var label=document.createElement('span');label.className='anim-label';
  ctl.appendChild(play);ctl.appendChild(label);ctl.appendChild(range);ctl.appendChild(num);
  anim.appendChild(ctl);
  function render(){
    steps.forEach(function(s,k){s.classList.toggle('on',k<=i);s.classList.toggle('now',k===i);});
    var cur=steps[i];
    label.textContent=cur.getAttribute('data-label')||cur.getAttribute('data-section')||'';
    range.value=String(i);num.textContent=(i+1)+' / '+steps.length;
  }
  function go(n){i=Math.max(0,Math.min(steps.length-1,n));render();}
  function stop(){if(timer){clearInterval(timer);timer=null;}play.textContent='\\u25B6';play.setAttribute('aria-label','Play');}
  function start(){
    if(i>=steps.length-1)go(0);
    play.textContent='\\u275A\\u275A';play.setAttribute('aria-label','Pause');
    timer=setInterval(function(){if(i>=steps.length-1){stop();return;}go(i+1);},1500);
  }
  play.addEventListener('click',function(){timer?stop():start();});
  range.addEventListener('input',function(){stop();go(Number(range.value));});
  document.addEventListener('keydown',function(e){
    if(e.metaKey||e.altKey||e.ctrlKey)return;
    if(e.key==='ArrowRight'){e.preventDefault();stop();go(i+1);}
    else if(e.key==='ArrowLeft'){e.preventDefault();stop();go(i-1);}
    else if(e.key===' '){e.preventDefault();timer?stop():start();}
  });
  render();
})();
`;

// review: the standardized PR-review overview. A `.risk` band over four
// `.signal` sub-bars (size / area / sensitivity / tests), a one-line `.budget`,
// and a priority-ranked `.manifest` whose rows carry a priority `.pri` dot, a
// two-tone churn `.spark`, a "why it matters" note, and a reviewed checkbox.
// `.finding-head` styles the severity + confidence + verified chip row. Every
// color resolves against the theme tokens, so the overview re-themes with the
// board. The JS wires the reviewed-checkbox burn-down (a live "n/m reviewed"
// counter) and collapses the low-attention (mechanical) bucket behind a toggle.
const REVIEW_CSS = `
.risk{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-lg);background:var(--color-background-secondary)}
.risk-band{display:inline-flex;align-items:center;gap:7px;font:600 14px/1.3 var(--font-sans);color:var(--color-text-primary)}
.risk-band .lvl{width:9px;height:9px;border-radius:999px;background:var(--color-text-tertiary);flex:none}
.risk-band.low .lvl{background:var(--color-text-success)}
.risk-band.elevated .lvl{background:var(--color-text-warning)}
.risk-band.high .lvl{background:var(--color-text-danger)}
.signals{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center}
.signals .sig-label{font:500 12px/1.3 var(--font-sans);color:var(--color-text-secondary);white-space:nowrap}
.signals .sig-label .num{margin-left:4px;color:var(--color-text-tertiary)}
.signal{height:6px;border-radius:999px;background:var(--color-background-primary);overflow:hidden}
.signal>i{display:block;height:100%;border-radius:inherit;background:var(--color-text-secondary)}
.signal.hot>i{background:var(--color-text-danger)}
.signal.warm>i{background:var(--color-text-warning)}
.signal.cool>i{background:var(--color-text-success)}
.budget{font:500 13px/1.4 var(--font-sans);color:var(--color-text-secondary)}
.budget b{color:var(--color-text-primary);font-weight:600}
.manifest{display:flex;flex-direction:column;gap:1px;margin:0;padding:0;list-style:none}
.manifest-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:var(--border-radius-md)}
.manifest-row:hover{background:var(--color-background-secondary)}
.manifest-row.reviewed .file{text-decoration:line-through;color:var(--color-text-tertiary)}
.manifest-row .pri{width:8px;height:8px;border-radius:999px;background:var(--color-text-tertiary);flex:none}
.manifest-row.sensitive .pri{background:var(--color-text-danger)}
.manifest-row.logic .pri{background:var(--color-text-warning)}
.manifest-row.mechanical .pri{background:var(--color-text-tertiary)}
.manifest-row .file{font:400 13px/1.4 var(--font-mono);color:var(--color-text-primary)}
.manifest-row .note{font:400 12px/1.4 var(--font-sans);color:var(--color-text-tertiary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spark{display:inline-flex;height:9px;width:60px;border-radius:3px;overflow:hidden;background:var(--color-background-secondary);flex:none}
.spark>span{display:block;height:100%}
.spark>.add{background:#2f9e44}.spark>.del{background:#e03131}
.manifest-row .churn{font:400 11px/1 var(--font-mono);color:var(--color-text-tertiary);min-width:60px;text-align:right}
.manifest-row .rev{flex:none;width:15px;height:15px;cursor:pointer;accent-color:var(--color-text-info)}
.cold-toggle{display:flex;align-items:center;gap:7px;width:100%;padding:6px 8px;margin-top:2px;border:0;border-radius:var(--border-radius-md);background:transparent;color:var(--color-text-tertiary);font:500 12px/1.3 var(--font-sans);cursor:pointer;text-align:left}
.cold-toggle:hover{background:var(--color-background-secondary)}
.cold-toggle .caret{transition:transform .15s}
.cold-toggle[aria-expanded="true"] .caret{transform:rotate(90deg)}
.cold-bucket[hidden]{display:none}
.review-progress{font:500 12px/1.3 var(--font-sans);color:var(--color-text-secondary)}
.review-progress.done{color:var(--color-text-success)}
.finding-head{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.finding-head .sev{display:inline-flex;align-items:center;font:600 12px/1.4 var(--font-sans);padding:2px 9px;border-radius:999px;background:var(--color-background-secondary);color:var(--color-text-secondary)}
.finding-head .sev.bug{background:var(--color-background-danger);color:var(--color-text-danger)}
.finding-head .sev.nit{background:var(--color-background-warning);color:var(--color-text-warning)}
.finding-head .sev.question{background:var(--color-background-info);color:var(--color-text-info)}
.finding-head .conf{display:inline-flex;align-items:center;gap:4px;font:500 12px/1.4 var(--font-sans);color:var(--color-text-secondary)}
.finding-head .conf .lvl{width:7px;height:7px;border-radius:999px;background:var(--color-text-tertiary)}
.finding-head .conf.high .lvl{background:var(--color-text-success)}
.finding-head .conf.medium .lvl{background:var(--color-text-warning)}
.finding-head .conf.low .lvl{background:var(--color-text-danger)}
.finding-head .verified{display:inline-flex;align-items:center;gap:4px;font:500 12px/1.4 var(--font-sans);color:var(--color-text-success)}
`;

// Live reviewed-checkbox burn-down + collapsible mechanical bucket. Self-
// contained inside the sandbox iframe: it updates a local "n/m reviewed"
// counter and toggles the cold bucket — no host round-trip needed. (The
// session-level burn-down the keyboard layer drives lives in the trusted viewer.)
const REVIEW_JS = `
(function(){
  var rows=[].slice.call(document.querySelectorAll('.manifest-row'));
  var prog=document.querySelector('.review-progress');
  function paint(){
    if(!prog)return;
    var boxes=rows.map(function(r){return r.querySelector('.rev');}).filter(Boolean);
    var done=boxes.filter(function(b){return b.checked;}).length;
    prog.textContent=done+' / '+boxes.length+' reviewed';
    prog.classList.toggle('done',boxes.length>0&&done===boxes.length);
  }
  rows.forEach(function(r){
    var box=r.querySelector('.rev');
    if(!box)return;
    r.classList.toggle('reviewed',box.checked);
    box.addEventListener('change',function(){r.classList.toggle('reviewed',box.checked);paint();});
  });
  var toggle=document.querySelector('.cold-toggle');
  var bucket=document.querySelector('.cold-bucket');
  if(toggle&&bucket){
    toggle.addEventListener('click',function(){
      var open=toggle.getAttribute('aria-expanded')==='true';
      toggle.setAttribute('aria-expanded',String(!open));
      bucket.hidden=open;
    });
  }
  // The keyboard layer's 'x' (mark next file reviewed) lives in the trusted
  // viewer, but the manifest checkboxes live here in the sandbox — so the host
  // posts a 'review-cmd' in and we check the next unreviewed box, paint the
  // counter, and post the new progress back for a host toast. Hot (visible) rows
  // come first in DOM order; if the next one is in the collapsed mechanical
  // bucket we reveal it so the tick is visible.
  window.addEventListener('message',function(e){
    var d=e.data;if(!d||!d.__showcase||d.type!=='review-cmd'||d.cmd!=='mark-next')return;
    var next=null;
    for(var i=0;i<rows.length;i++){var b=rows[i].querySelector('.rev');if(b&&!b.checked){next=rows[i];break;}}
    if(!next)return;
    if(bucket&&toggle&&bucket.contains(next)&&bucket.hidden){toggle.setAttribute('aria-expanded','true');bucket.hidden=false;}
    var nb=next.querySelector('.rev');nb.checked=true;next.classList.add('reviewed');paint();
    if(next.scrollIntoView)next.scrollIntoView({block:'nearest'});
    var f=next.querySelector('.file');
    var done=rows.map(function(r){return r.querySelector('.rev');}).filter(function(x){return x&&x.checked;}).length;
    parent.postMessage({__showcase:true,type:'review-reviewed',file:f?f.textContent:'',done:done,total:rows.length},'*');
  });
  paint();
})();
`;

// mockup: building blocks for UI / design mockups — framed panels, eyebrow
// labels, tone callouts, labeled boxes, and stand-in form controls. Everything
// resolves against the theme tokens, so the same markup re-skins when the
// surface's theme changes (brand vs neutral vs warm) — the consistency win:
// author structure once, theme it many ways, instead of hand-rolling a palette
// into every mockup's <style>.
const MOCKUP_CSS = `
.panel{background:var(--color-background-primary);border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-lg);padding:18px 20px}
.panel.soft{background:var(--color-background-secondary)}
.label{font:600 11px/1.3 var(--font-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-tertiary)}
.eyebrow{font:600 11px/1.3 var(--font-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-info)}
.callout{border:1px solid var(--color-border-secondary);border-left:3px solid var(--color-border-info);border-radius:var(--border-radius-md);padding:12px 14px;background:var(--color-background-info)}
.callout>.label,.callout>.eyebrow{color:var(--color-text-info)}
.callout.ok{border-left-color:var(--color-border-success);background:var(--color-background-success)}
.callout.ok>.label,.callout.ok>.eyebrow{color:var(--color-text-success)}
.callout.warn{border-left-color:var(--color-border-warning);background:var(--color-background-warning)}
.callout.warn>.label,.callout.warn>.eyebrow{color:var(--color-text-warning)}
.callout.danger{border-left-color:var(--color-border-danger);background:var(--color-background-danger)}
.callout.danger>.label,.callout.danger>.eyebrow{color:var(--color-text-danger)}
.callout.muted{border-left-color:var(--color-border-primary);background:var(--color-background-secondary)}
.box{border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:10px 12px;background:var(--color-background-primary)}
.box>.label{margin-bottom:4px}
.btn{display:inline-flex;align-items:center;gap:6px;font:500 13px/1 var(--font-sans);padding:8px 14px;border-radius:var(--border-radius-md);border:1px solid var(--color-border-primary);background:var(--color-background-primary);color:var(--color-text-primary);cursor:default}
.btn.primary{background:var(--color-text-info);border-color:var(--color-text-info);color:var(--color-background-primary)}
.btn.ghost{border-color:transparent;background:transparent;color:var(--color-text-secondary)}
.input{display:block;width:100%;box-sizing:border-box;font:400 13px/1.4 var(--font-sans);padding:8px 11px;border-radius:var(--border-radius-md);border:1px solid var(--color-border-secondary);background:var(--color-background-primary);color:var(--color-text-primary)}
.input.placeholder{color:var(--color-text-tertiary)}
.pill{display:inline-flex;align-items:center;gap:5px;font:500 12px/1.4 var(--font-sans);padding:2px 10px;border-radius:999px;border:1px solid var(--color-border-secondary);color:var(--color-text-secondary)}
.metric{font:600 26px/1.1 var(--font-sans);color:var(--color-text-primary);font-variant-numeric:tabular-nums}
.swatch{width:16px;height:16px;border-radius:5px;border:1px solid var(--color-border-secondary);flex:none}
`;

export const KITS: Kit[] = [
  {
    id: "issues",
    label: "Issues",
    summary: "issue / PR / CI status — trees, badges, chips, rollup bars",
    classes: "card · tree · badge · chip · dot · bar",
    css: ISSUES_CSS,
  },
  {
    id: "slides",
    label: "Slides",
    summary: "a stepped deck with prev/next controls and a counter",
    classes: "deck · slide (+ injected controls)",
    css: SLIDES_CSS,
    js: SLIDES_JS,
  },
  {
    id: "animate",
    label: "Animate",
    summary: "a building-up explainer — steps reveal with play/pause + a scrubber",
    classes: "anim · step · cue (+ injected play/scrub controls)",
    css: ANIMATE_CSS,
    js: ANIMATE_JS,
  },
  {
    id: "review",
    label: "Review",
    summary: "PR-review overview — risk band, signal bars, review budget, priority manifest",
    classes: "risk · signal · budget · manifest · spark · finding-head",
    css: REVIEW_CSS,
    js: REVIEW_JS,
  },
  {
    id: "mockup",
    label: "Mockup",
    summary:
      "UI / design mockups — framed panels, eyebrow labels, tone callouts, stand-in controls",
    classes: "panel · label · eyebrow · callout · box · btn · input · pill · metric · swatch",
    css: MOCKUP_CSS,
  },
];

// Built-in kit ids, frozen at import (the MCP `kits` enum hint lists these).
export const KIT_IDS = KITS.map((k) => k.id);

// --- user-extensible layer ---------------------------------------------------
// Like themes, a board can load extra kits (a product's own visual vocabulary —
// card chrome, brand font, a screenshot bezel) from local config
// (server/userConfig.ts → registerKits at boot). The lookup map is rebuilt to
// include them, user winning on id collision. The viewer never registers extras.
let kitById = new Map(KITS.map((k) => [k.id, k]));

// Replace the user kit set (idempotent — see registerThemes). Rebuilds the
// lookup so built-ins come first, then extras OVERWRITE on duplicate id.
export function registerKits(kits: Kit[]): void {
  kitById = new Map(KITS.map((k) => [k.id, k]));
  for (const k of kits) kitById.set(k.id, k);
}

export const isKnownKit = (id: unknown): id is string => typeof id === "string" && kitById.has(id);

// Compact descriptor for discovery (no CSS/JS payload). Built-in + user kits.
export const kitSummaries = () =>
  [...kitById.values()].map((k) => ({
    id: k.id,
    label: k.label,
    summary: k.summary,
    classes: k.classes,
  }));

// Resolve a list of kit ids to the CSS/JS to inject. Unknown ids are ignored;
// duplicates collapse; CORE ships once when any known kit is present.
export function kitAssets(ids: readonly string[] | undefined): { css: string; js: string } {
  if (!ids || ids.length === 0) return { css: "", js: "" };
  const seen = new Set<string>();
  const chosen: Kit[] = [];
  for (const id of ids) {
    const kit = kitById.get(id);
    if (kit && !seen.has(id)) {
      seen.add(id);
      chosen.push(kit);
    }
  }
  if (chosen.length === 0) return { css: "", js: "" };
  let css = CORE_CSS;
  let js = "";
  for (const kit of chosen) {
    css += kit.css;
    if (kit.js) js += kit.js;
  }
  return { css, js };
}
