/*
  Opening animation: a drawn fairy-tale castle, stars, and one firework per traveller with their initial.
  No photos and no Disney artwork. Plays once, then not again for ten minutes. Tap to skip.
  Add ?intro to the address to replay it, or ?intro=hold to keep it running.
*/
window.DDIntro = (function () {
  function run(D) {
    var el = document.getElementById("intro"); var key = "dd-intro";
    var force = /[?&]intro/.test(location.search), hold = /[?&]intro=hold/.test(location.search);
    var last = 0; try { last = +localStorage.getItem(key) || 0; } catch (e) { }
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || (!force && Date.now() - last < 10 * 60 * 1000)) { el.remove(); return; }
    try { localStorage.setItem(key, String(Date.now())); } catch (e) { }
    el.hidden = false;

    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var dateTxt = ""; try { var p = D.DAY.split("-").map(Number); dateTxt = new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { month: "long", day: "numeric" }); } catch (e) { }
    var group = D.GROUP || "Your";
    document.getElementById("ititle").innerHTML = esc(group) + " <em>day</em><small>Disneyland" + (dateTxt ? " · " + esc(dateTxt) : "") + "</small>";

    /* stars */
    var st = document.getElementById("stars"), sh = "";
    for (var i = 0; i < 70; i++) { sh += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;top:' + (Math.random() * 62).toFixed(1) + '%;--d:' + (Math.random() * 4).toFixed(2) + 's;--s:' + (1 + Math.random() * 1.6).toFixed(1) + 'px"></i>'; }
    st.innerHTML = sh;

    /* castle: a generic storybook castle drawn from plain shapes */
    var T = [{ x: 34, w: 30, top: 128, apex: 84 }, { x: 86, w: 38, top: 100, apex: 40 }, { x: 150, w: 60, top: 64, apex: -2, big: true }, { x: 236, w: 38, top: 100, apex: 40 }, { x: 296, w: 30, top: 128, apex: 84 }];
    var svg = '<svg viewBox="0 -20 360 220" preserveAspectRatio="xMidYMax meet"><defs>' +
      '<linearGradient id="gw" x1="0" x2="1"><stop offset="0" stop-color="#e9bfd3"/><stop offset=".55" stop-color="#c593b0"/><stop offset="1" stop-color="#6e4a6e"/></linearGradient>' +
      '<linearGradient id="gs" x1="0" x2="1"><stop offset="0" stop-color="#8fb0ff"/><stop offset=".5" stop-color="#4a6fe0"/><stop offset="1" stop-color="#22336f"/></linearGradient>' +
      '<linearGradient id="gk" x1="0" x2="1"><stop offset="0" stop-color="#e6d6c6"/><stop offset=".6" stop-color="#bda493"/><stop offset="1" stop-color="#6b5450"/></linearGradient>' +
      '<linearGradient id="gd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>' +
      '</defs>';
    var cren = "M20 150 "; for (var cx = 20; cx < 340; cx += 16) { cren += "h8 v-9 h8 v9 "; } cren += "V200 H20 Z";
    svg += '<path d="' + cren + '" fill="url(#gk)"/><rect x="20" y="150" width="320" height="50" fill="url(#gd)"/>';
    T.forEach(function (t) {
      var cx2 = t.x + t.w / 2, top = t.top;
      if (t.big) { svg += '<rect x="' + (t.x - 14) + '" y="' + (top + 36) + '" width="' + (t.w + 28) + '" height="' + (200 - top - 36) + '" fill="url(#gw)"/><rect x="' + (t.x - 18) + '" y="' + (top + 30) + '" width="' + (t.w + 36) + '" height="10" rx="1.5" fill="url(#gk)"/>'; }
      svg += '<rect x="' + t.x + '" y="' + top + '" width="' + t.w + '" height="' + (200 - top) + '" fill="url(#gw)"/><rect x="' + t.x + '" y="' + top + '" width="' + t.w + '" height="' + (200 - top) + '" fill="url(#gd)" opacity=".5"/>';
      svg += '<rect x="' + (t.x - 4) + '" y="' + (top - 6) + '" width="' + (t.w + 8) + '" height="10" rx="1.5" fill="url(#gk)"/>';
      svg += '<polygon points="' + (t.x - 4) + "," + (top - 6) + " " + (t.x + t.w + 4) + "," + (top - 6) + " " + cx2 + "," + t.apex + '" fill="url(#gs)"/>';
      svg += '<polygon points="' + (t.x - 4) + "," + (top - 6) + " " + cx2 + "," + (top - 6) + " " + cx2 + "," + t.apex + '" fill="#fff" opacity=".10"/>';
      svg += '<circle cx="' + cx2 + '" cy="' + t.apex + '" r="2.2" fill="#f3d58a"/><path d="M' + cx2 + " " + t.apex + ' v-14" stroke="#f3d58a" stroke-width="1.2"/><polygon class="flag" points="' + cx2 + "," + (t.apex - 14) + " " + (cx2 + 10) + "," + (t.apex - 10.5) + " " + cx2 + "," + (t.apex - 7) + '" fill="#f3d58a"/>';
      for (var k = 0; k < 3; k++) { var wy = top + 16 + k * 22; if (wy < 186) svg += '<rect class="win" x="' + (cx2 - 3) + '" y="' + wy + '" width="6" height="10" rx="3" style="--d:' + (Math.random() * 2).toFixed(2) + 's"/>'; }
    });
    svg += '<path d="M166 200 v-26 a14 14 0 0 1 28 0 v26 z" fill="#f3d58a" opacity=".9"/><path d="M169 200 v-24 a11 11 0 0 1 22 0 v24 z" fill="#fff6d6" opacity=".9"/>';
    svg += '<rect class="win" x="138" y="166" width="5" height="9" rx="2.5"/><rect class="win" x="217" y="166" width="5" height="9" rx="2.5"/></svg>';
    document.getElementById("castle").innerHTML = svg; document.getElementById("mirror").innerHTML = svg;

    /* travellers: one firework each (up to five). The finale goes to the birthday person, else the youngest child, else the last one. */
    var ids = D.ALL.slice(0, 5);
    var starId = ids[ids.length - 1];
    var oc = D.PROFILE && D.PROFILE.occasion;
    if (oc && oc.type === "birthday" && oc.forId && ids.indexOf(oc.forId) >= 0) starId = oc.forId;
    else if (D.KIDS.length) { var ky = D.KIDS.filter(function (k) { return ids.indexOf(k) >= 0; }).sort(function (a, b) { return (D.PEOPLE[a].age || 0) - (D.PEOPLE[b].age || 0); }); if (ky.length) starId = ky[0]; }
    ids = ids.filter(function (x) { return x !== starId; }).concat([starId]);
    var slots = [[.24, .15, 1500], [.76, .15, 2300], [.16, .33, 3100], [.84, .33, 3900]];
    var fam = ids.map(function (id, i) {
      var star = id === starId, s = star ? [.5, .22, 5300] : slots[i] || slots[0];
      return { n: D.PEOPLE[id].name, ini: D.PEOPLE[id].name.trim()[0].toUpperCase(), c: D.PEOPLE[id].color, x: s[0], y: s[1], at: s[2], star: star };
    });
    var occTag = oc && oc.type === "birthday" ? "birthday" : oc && oc.type === "anniversary" ? "anniversary" : "";
    document.getElementById("ifam").innerHTML = fam.map(function (f, i) {
      return '<figure id="if' + i + '" class="' + (f.star ? "star" : "") + '" style="left:' + (f.x * 100) + "%;top:" + (f.y * 100) + "%;--c:" + f.c + '"><span class="ph"><span class="ini" style="--bgc:' + f.c + '33">' + esc(f.ini) + "</span>" + (f.star && occTag ? "<b>★</b>" : "") + "</span><figcaption>" + esc(f.n) + (f.star && occTag ? "<small>" + occTag + "</small>" : "") + "</figcaption></figure>";
    }).join("");
    function reveal(i) { var f = document.getElementById("if" + i); if (f) f.classList.add("on"); if (fam[i].star) el.classList.add("finale"); }

    /* fireworks */
    var cv = document.getElementById("fw"), ctx = cv.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1), W, H;
    function size() { W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr; cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px"; } size();
    var P = [], R = [], COL = ["#f3d58a", "#ff9fd0", "#8fc3ff", "#ffffff", "#cdb4ff", "#ffd27a"], G = .11, t0 = performance.now(), running = true, flash = document.getElementById("flash");
    var launchIdx = 0, finaleUntil = 0, nextExtra = 0;
    function add(x, y, vx, vy, col, big) { P.push({ x: x, y: y, px: x, py: y, vx: vx, vy: vy, life: 1, decay: (big ? .005 : .006) + Math.random() * .009, c: Math.random() < .85 ? col : "#ffffff", r: (1.7 + Math.random() * 1.9) * dpr }); }
    function launch(tx, ty, col, kind, who) { var y0 = H * .6, v = Math.sqrt(2 * G * dpr * (y0 - ty)) + .4 * dpr; R.push({ x: tx, y: y0, ty: ty, vy: -v, c: col, kind: kind, who: who }); }
    function burst(x, y, col, kind) {
      var n = 110 + Math.random() * 60 | 0, base = Math.random() * Math.PI * 2, i, a;
      flash.style.background = "radial-gradient(55% 45% at " + (x / W * 100).toFixed(1) + "% " + (y / H * 100).toFixed(1) + "%, " + col + "55, transparent 70%)"; flash.style.transition = "none"; flash.style.opacity = 1;
      requestAnimationFrame(function () { requestAnimationFrame(function () { flash.style.transition = "opacity 1.1s ease-out"; flash.style.opacity = 0; }); });
      if (kind === "heart") { var m = 120, k = .0045 * dpr * 60; for (i = 0; i < m; i++) { a = i / m * Math.PI * 2; var hx = 16 * Math.pow(Math.sin(a), 3), hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)); add(x, y, hx * k, hy * k, col, true); } return; }
      var ring = kind === "ring";
      for (i = 0; i < n; i++) { a = ring ? base + i / n * Math.PI * 2 : Math.random() * Math.PI * 2; var sp = (ring ? 3.2 + Math.random() * .4 : 1.2 + Math.random() * 3.2) * dpr; add(x, y, Math.cos(a) * sp, Math.sin(a) * sp, col, false); }
    }
    function frame(now) {
      ctx.clearRect(0, 0, W, H);
      var t = now - t0;
      if (running && launchIdx < fam.length && t > fam[launchIdx].at) { var f = fam[launchIdx]; launch(W * f.x, H * f.y, f.c, f.star ? "heart" : (launchIdx % 2 ? "ring" : ""), launchIdx); if (f.star) finaleUntil = now + 1900; launchIdx++; }
      if (running && now < finaleUntil && now > nextExtra) { nextExtra = now + 140 + Math.random() * 160; launch(W * (.12 + Math.random() * .76), H * (.06 + Math.random() * .3), COL[Math.random() * COL.length | 0], Math.random() < .35 ? "ring" : "", -1); }
      if (hold && running && launchIdx >= fam.length && now > finaleUntil && now > nextExtra) { nextExtra = now + 900 + Math.random() * 900; launch(W * (.15 + Math.random() * .7), H * (.06 + Math.random() * .3), COL[Math.random() * COL.length | 0], "", -1); }
      ctx.globalCompositeOperation = "lighter";
      for (var i = R.length - 1; i >= 0; i--) {
        var r = R[i]; var py = r.y; r.y += r.vy; r.vy += G * dpr;
        ctx.strokeStyle = "rgba(243,213,138,.7)"; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x, r.y); ctx.stroke();
        if (r.y <= r.ty || r.vy >= 0) { burst(r.x, r.ty, r.c, r.kind); if (r.who >= 0) reveal(r.who); R.splice(i, 1); }
      }
      for (var j = P.length - 1; j >= 0; j--) {
        var p = P[j]; p.px = p.x; p.py = p.y; p.x += p.vx; p.y += p.vy; p.vx *= .975; p.vy = p.vy * .975 + .045 * dpr; p.life -= p.decay;
        if (p.life <= 0) { P.splice(j, 1); continue; }
        var a = Math.min(1, p.life * 1.5) * (p.life < .35 && Math.random() < .3 ? .4 : 1);
        ctx.lineCap = "round"; ctx.strokeStyle = p.c;
        ctx.globalAlpha = a * .28; ctx.lineWidth = p.r * 3.2; ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.globalAlpha = a; ctx.lineWidth = p.r; ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      if (running || P.length || R.length) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    window.addEventListener("resize", size);
    function done() { if (el.classList.contains("out")) return; running = false; el.classList.add("out"); setTimeout(function () { el.remove(); }, 1000); }
    if (!hold) { setTimeout(function () { running = false; }, 8300); setTimeout(done, 8900); }
    el.addEventListener("click", done);
  }
  return { run: run };
})();
