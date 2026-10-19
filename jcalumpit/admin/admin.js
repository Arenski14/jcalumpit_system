/* Admin panel: every section in one file. Needs ../assets/site.js (API helpers). */

/* ===== Charts (tiny SVG charts) ===== */
/* Tiny dependency-free SVG charts (work offline, scale with their container). */
const Charts = (() => {
  const COLORS = [
    "#8c2b1d",
    "#162b4d",
    "#2c7a9b",
    "#d9822b",
    "#7c5cbf",
    "#94a3b8",
  ];
  const esc2 = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );

  /* Axis maximum that splits into 4 clean steps (1, 2, 5 x 10^n). */
  function niceMax(v, min) {
    const raw = Math.max(v, min) / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p * 4;
  }
  const short = (n) =>
    n >= 1000
      ? +(n / 1000).toFixed(1) + "K"
      : String(Math.round(n * 100) / 100);

  function frame(W, H, m, max, fmt) {
    let g = "";
    for (let i = 0; i <= 4; i++) {
      const y = m.t + ((H - m.t - m.b) * i) / 4;
      g += `<line x1="${m.l}" y1="${y}" x2="${W - m.r}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="3 4"/>`;
      g += `<text x="${m.l - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="#64748b">${fmt(max - (max * i) / 4)}</text>`;
    }
    return g;
  }

  const W_HINT = { w: 560 };
  function xLabels(labels, xs, H, m) {
    const step = Math.max(
      1,
      Math.ceil(labels.length / (W_HINT.w < 400 ? 4 : 6)),
    );
    return labels
      .map((l, i) =>
        i % step === 0 || i === labels.length - 1
          ? `<text x="${xs[i]}" y="${H - m.b + 18}" text-anchor="middle" font-size="12" fill="#64748b">${esc2(l)}</text>`
          : "",
      )
      .join("");
  }

  /* points: [{label, value}] */
  function line(points, o = {}) {
    const W = o.w || 560,
      H = 240,
      m = { l: 34, r: 26, t: 12, b: 30 };
    W_HINT.w = W;
    const color = o.color || COLORS[0];
    const max = niceMax(Math.max(0, ...points.map((p) => p.value)), 4);
    const n = points.length;
    const xs = points.map((_, i) =>
      n === 1 ? (W + m.l - m.r) / 2 : m.l + ((W - m.l - m.r) * i) / (n - 1),
    );
    const ys = points.map((p) => m.t + (H - m.t - m.b) * (1 - p.value / max));
    let d = "";
    xs.forEach((x, i) => {
      if (i === 0) return (d = `M${x},${ys[i]}`);
      const cx = (xs[i - 1] + x) / 2;
      d += ` C${cx},${ys[i - 1]} ${cx},${ys[i]} ${x},${ys[i]}`;
    });
    const base = H - m.b;
    const area = n > 1 ? `${d} L${xs[n - 1]},${base} L${xs[0]},${base} Z` : "";
    const dots =
      n <= 16
        ? points
            .map(
              (p, i) =>
                `<circle cx="${xs[i]}" cy="${ys[i]}" r="4" fill="#fff" stroke="${color}" stroke-width="2"><title>${esc2(p.label)}: ${p.value}</title></circle>`,
            )
            .join("")
        : "";
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      ${frame(W, H, m, max, (v) => Math.round(v))}
      ${area ? `<path d="${area}" fill="url(#lg)"/>` : ""}
      ${n > 1 ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5"/>` : ""}
      ${dots}${xLabels(
        points.map((p) => p.label),
        xs,
        H,
        m,
      )}</svg>`;
  }

  function bars(points, o = {}) {
    const W = o.w || 560,
      H = 240,
      m = { l: 40, r: 12, t: 12, b: 30 };
    W_HINT.w = W;
    const color = o.color || "#162b4d";
    const max = niceMax(Math.max(0, ...points.map((p) => p.value)), 4);
    const n = points.length;
    const slot = (W - m.l - m.r) / n;
    const bw = Math.min(46, slot * 0.6);
    const xs = points.map((_, i) => m.l + slot * i + slot / 2);
    const rects = points
      .map((p, i) => {
        const h = (H - m.t - m.b) * (p.value / max);
        return `<rect x="${xs[i] - bw / 2}" y="${H - m.b - h}" width="${bw}" height="${h}" rx="4" fill="${color}"><title>${esc2(p.label)}: ${o.money ? "₱" : ""}${p.value.toLocaleString("en-PH")}</title></rect>`;
      })
      .join("");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">
      ${frame(W, H, m, max, short)}${rects}${xLabels(
        points.map((p) => p.label),
        xs,
        H,
        m,
      )}</svg>`;
  }

  /* items: [{label, value}] -> {svg, legend} */
  function donut(items, o = {}) {
    const R = 56,
      C = 2 * Math.PI * R,
      total = items.reduce((a, b) => a + b.value, 0);
    let off = 0;
    const segs = total
      ? items
          .map((it, i) => {
            const len = (it.value / total) * C;
            const s = `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"><title>${esc2(it.label)}: ${it.value}</title></circle>`;
            off += len;
            return s;
          })
          .join("")
      : `<circle cx="80" cy="80" r="${R}" fill="none" stroke="#e5e7eb" stroke-width="26"/>`;
    const center =
      o.center != null
        ? `<text x="80" y="86" text-anchor="middle" font-size="20" font-weight="700" fill="#162b4d">${esc2(o.center)}</text>`
        : "";
    const legend = items
      .map(
        (it, i) =>
          `<div><i style="background:${COLORS[i % COLORS.length]}"></i>${esc2(it.label)}<b>${total ? Math.round((it.value / total) * 100) : 0}%</b></div>`,
      )
      .join("");
    return {
      svg: `<svg viewBox="0 0 160 160" role="img" aria-label="Donut chart">${segs}${center}</svg>`,
      legend: `<div class="legend">${legend}</div>`,
    };
  }

  return { line, bars, donut, COLORS };
})();

/* ===== Core: icons, navigation, dialogs, helpers ===== */
/* Admin panel core: icons, navigation, dialogs, small UI builders. Each section lives in its own admin-*.js file. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ICON_PATHS = {
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  calendar:
    '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users:
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  tooth:
    '<path d="M7 3C4.5 3 3 5 3 8c0 4 2 5 2.6 8 .4 2.5 1.2 5 2.4 5s1.4-3 1.9-5c.3-1.4.6-2 1.1-2s.8.6 1.1 2c.5 2 .7 5 1.9 5s2-2.5 2.4-5C16 13 18 12 18 8c0-3-1.5-5-4-5-1.6 0-2.4 1-3.5 1S8.6 3 7 3z"/>',
  dollar:
    '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  chart:
    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  sliders:
    '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  logout:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  search:
    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  clock:
    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  chevleft: '<polyline points="15 18 9 12 15 6"/>',
  chevright: '<polyline points="9 18 15 12 9 6"/>',
  male: '<circle cx="10" cy="14" r="5"/><line x1="19" y1="5" x2="13.6" y2="10.4"/><polyline points="15 5 19 5 19 9"/>',
  female:
    '<circle cx="12" cy="8" r="5"/><line x1="12" y1="13" x2="12" y2="21"/><line x1="9" y1="18" x2="15" y2="18"/>',
  wallet:
    '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  alert:
    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
};
function icon(name, size = 18) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}

const ROLE_LABEL = {
  admin: "Administrator",
  dentist: "Dentist",
  staff: "Staff",
  patient: "Patient",
};
const SERVICES = [
  "Check-up & consultation",
  "Oral prophylaxis (cleaning)",
  "Tooth extraction",
  "Filling (pasta)",
  "Braces / orthodontics",
  "Whitening",
  "Dentures",
];

const App = {
  me: null,
  views: {},
  current: null,
  nextOpts: {},
  _patients: null,
  _dentists: null,
  NAV: [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: "grid",
      title: "Dashboard Overview",
    },
    {
      id: "appointments",
      label: "Appointments",
      icon: "calendar",
      title: "Appointments",
    },
    { id: "patients", label: "Patients", icon: "user", title: "Patients" },
    { id: "records", label: "Records", icon: "file", title: "Records" },
    { id: "treatment", label: "Treatment", icon: "tooth", title: "Treatment" },
    { id: "billing", label: "Billing", icon: "dollar", title: "Billing" },
    { id: "messages", label: "Messages", icon: "mail", title: "Messages" },
    { id: "reports", label: "Reports", icon: "chart", title: "Reports" },
    { id: "settings", label: "Settings", icon: "sliders", title: "Settings" },
    { id: "users", label: "Users", icon: "users", title: "Users", admin: true },
  ],
};

/* ---------- small helpers ---------- */
App.toast = (msg, err) => {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast show" + (err ? " error" : "");
  clearTimeout(App.toast.t);
  App.toast.t = setTimeout(() => (el.className = "toast"), 3400);
};
App.fail = (e) => {
  if (e && e.status === 401)
    return location.replace("../login.html?next=admin/index.html");
  App.toast((e && e.message) || "Something went wrong.", true);
};
App.code = (prefix, id) => `${prefix}-${String(id).padStart(4, "0")}`;
App.num = (n) => Number(n || 0).toLocaleString("en-PH");
App.cap = (s) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, " ") : "";
App.initials = (name) =>
  (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
App.isAdmin = () => App.me && App.me.role === "admin";
App.debounce = (fn, ms = 300) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
App.todayIso = () => isoDate(new Date());

App.statCards = (items) =>
  items
    .map(
      (c) => `<div class="sc">
        <div class="ico tone-${c.tone || "blue"}">${icon(c.icon, 22)}</div>
        <div><div class="lbl">${esc(c.label)}</div><div class="val">${esc(c.value)}</div>
        ${c.sub ? `<div class="sub ${c.subCls || ""}">${esc(c.sub)}</div>` : ""}
        ${c.go ? `<a class="more" href="#" data-go="${c.go}" ${c.tab ? `data-tab="${c.tab}"` : ""}>${esc(c.more || "View all")} →</a>` : ""}</div></div>`,
    )
    .join("");

App.table = (heads, rows, empty = "Nothing to show.") =>
  rows.length
    ? `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<div class="empty">${esc(empty)}</div>`;

App.iconBtn = (name, cls, attrs, title) =>
  `<button type="button" class="icon-btn ${cls}" ${attrs} title="${esc(title)}" aria-label="${esc(title)}">${icon(name, 17)}</button>`;

App.searchBox = (id, placeholder, value = "") =>
  `<div class="search">${icon("search", 16)}<input type="search" id="${id}" placeholder="${esc(placeholder)}" value="${esc(value)}" /></div>`;

/* Pager: returns html; call App.bindPager(container, cb) after inserting it. */
App.pagerHtml = (total, page, per, noun = "records") => {
  const pages = Math.max(1, Math.ceil(total / per));
  const from = total ? (page - 1) * per + 1 : 0;
  const to = Math.min(total, page * per);
  const nums = new Set([1, pages, page - 1, page, page + 1]);
  const list = [...nums]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b);
  let btns = "";
  list.forEach((n, i) => {
    if (i && n - list[i - 1] > 1)
      btns += `<button class="pg" disabled>…</button>`;
    btns += `<button class="pg ${n === page ? "active" : ""}" data-page="${n}">${n}</button>`;
  });
  return `<div class="pager"><span>Showing ${App.num(from)} to ${App.num(to)} of ${App.num(total)} ${noun}</span>
    <div class="pager-btns"><button class="pg" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>${btns}<button class="pg" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>›</button></div></div>`;
};
App.bindPager = (el, cb) =>
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (b && !b.disabled) cb(+b.dataset.page);
  });

/* ---------- cached lookups ---------- */
App.patients = async (force) => {
  if (!App._patients || force)
    App._patients = (await api("admin.php?r=patients&brief=1")).patients;
  return App._patients;
};
App.dentists = async () => {
  if (!App._dentists)
    App._dentists = (await api("admin.php?r=dentists")).dentists;
  return App._dentists;
};

/* ---------- dialogs ---------- */
App.dialog = function ({
  title,
  sub = "",
  html = "",
  wide = false,
  buttons = [],
  onOpen,
}) {
  const dlg = $("#appDlg");
  App._afterClose = null;
  if (dlg.open) dlg.close();
  dlg.classList.toggle("wide", wide);
  $("#dlgTitle").textContent = title;
  $("#dlgSub").textContent = sub;
  $("#dlgSub").hidden = !sub;
  $("#dlgBody").innerHTML = html;
  $("#dlgErr").textContent = "";
  const act = $("#dlgActions");
  act.innerHTML = "";
  buttons.forEach((b) => {
    const el = document.createElement("button");
    el.type = b.submit ? "submit" : "button";
    el.className = "btn " + (b.cls || "btn-ghost");
    el.textContent = b.label;
    if (b.id) el.id = b.id;
    if (!b.submit)
      el.addEventListener("click", () => b.onClick && b.onClick(el));
    act.appendChild(el);
  });
  App._onSubmit = null;
  dlg.showModal();
  if (onOpen) onOpen(dlg);
  return dlg;
};
App.close = () => {
  const d = $("#appDlg");
  if (d.open) d.close();
};
/* Runs once when the dialog is really closed (ignores the close that happens while swapping content). */
$("#appDlg").addEventListener("close", () => {
  if ($("#appDlg").open) return;
  const f = App._afterClose;
  App._afterClose = null;
  if (f) f();
});
$("#dlgForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (App._onSubmit) App._onSubmit();
});

function fieldHtml(f, val) {
  const v = val ?? f.value ?? "";
  const id = "f_" + f.name;
  const cls = "f-row" + (f.full || f.type === "textarea" ? " full" : "");
  let input;
  if (f.type === "select") {
    input = `<select id="${id}">${(f.options || [])
      .map(
        ([k, l]) =>
          `<option value="${esc(k)}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`,
      )
      .join("")}</select>`;
  } else if (f.type === "textarea") {
    input = `<textarea id="${id}" rows="${f.rows || 3}" maxlength="${f.maxlength || 5000}" placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea>`;
  } else if (f.type === "file") {
    input = `<input type="file" id="${id}" accept="${esc(f.accept || "")}" />`;
  } else {
    input = `<input type="${f.type || "text"}" id="${id}" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}" ${f.min != null ? `min="${esc(f.min)}"` : ""} ${f.max != null ? `max="${esc(f.max)}"` : ""} ${f.step ? `step="${esc(f.step)}"` : ""} ${f.readonly ? "readonly" : ""} autocomplete="off" />`;
  }
  return `<div class="${cls}"><label for="${id}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ""}</label>${input}${f.hint ? `<span class="slot-hint">${esc(f.hint)}</span>` : ""}</div>`;
}

App.readFile = (input) =>
  new Promise((resolve, reject) => {
    const f = input.files && input.files[0];
    if (!f) return resolve(null);
    if (f.size > 5 * 1024 * 1024)
      return reject(new Error("The file is too large (5 MB max)."));
    const r = new FileReader();
    r.onload = () =>
      resolve({ name: f.name, data: String(r.result).split(",")[1] });
    r.onerror = () => reject(new Error("Couldn't read the file."));
    r.readAsDataURL(f);
  });

/* Form dialog. onSubmit(values) may throw (message shown) or return "keep" to leave the dialog open. */
App.form = function (o) {
  const vals = o.values || {};
  const html = `<div class="fgrid">${o.fields.map((f) => fieldHtml(f, vals[f.name])).join("")}</div>${o.extra || ""}`;
  App.dialog({
    title: o.title,
    sub: o.sub,
    html,
    wide: o.wide,
    buttons: [
      { label: "Cancel", onClick: App.close },
      {
        label: o.submit || "Save",
        cls: "btn-primary",
        submit: true,
        id: "dlgSubmit",
      },
    ],
    onOpen: (dlg) => o.onOpen && o.onOpen(dlg),
  });
  App._onSubmit = async () => {
    const btn = $("#dlgSubmit"),
      err = $("#dlgErr");
    err.textContent = "";
    const values = {};
    try {
      for (const f of o.fields) {
        const el = $("#f_" + f.name);
        if (!el) continue;
        values[f.name] =
          f.type === "file"
            ? await App.readFile(el)
            : f.type === "password"
              ? el.value
              : el.value.trim();
      }
    } catch (e) {
      err.textContent = e.message;
      return;
    }
    for (const f of o.fields) {
      if (f.required && !values[f.name]) {
        err.textContent = `${f.label} is required.`;
        return;
      }
    }
    btn.disabled = true;
    try {
      const r = await o.onSubmit(values);
      if (r !== "keep") App.close();
    } catch (e) {
      if (e.status === 401) return App.fail(e);
      err.textContent = e.message;
      btn.disabled = false;
    }
  };
};

App.confirm = ({ title, text, confirmText = "Confirm" }) =>
  new Promise((resolve) => {
    App.dialog({
      title,
      sub: text,
      buttons: [
        { label: "Cancel", onClick: () => (App.close(), resolve(false)) },
        {
          label: confirmText,
          cls: "btn-primary",
          onClick: () => (App.close(), resolve(true)),
        },
      ],
    });
  });

/* One-time credentials (temporary passwords) */
App.secret = ({ title, sub, username, password }) =>
  App.dialog({
    title,
    sub,
    html: `<div class="secret">Username: <code>${esc(username)}</code><br />Temporary password: <code>${esc(password)}</code></div>
           <p class="slot-hint" style="margin-top:10px">Write this down or send it to them now. It is not shown again. They can change it under Settings.</p>`,
    buttons: [{ label: "Done", cls: "btn-primary", onClick: App.close }],
  });

/* Fills a <select> with the open time slots of a date (staff can use today onwards). */
App.loadSlots = async (dateVal, selectEl, hintEl, excludeId) => {
  selectEl.innerHTML = '<option value="">Pick a date first</option>';
  if (hintEl) hintEl.textContent = "";
  if (!dateVal) return;
  try {
    const r = await api(
      `appointments.php?action=slots&date=${encodeURIComponent(dateVal)}${excludeId ? "&exclude=" + excludeId : ""}`,
    );
    if (!r.open) {
      selectEl.innerHTML = '<option value="">No times available</option>';
      if (hintEl) hintEl.textContent = r.message || "";
      return;
    }
    selectEl.innerHTML =
      '<option value="">Select a time</option>' +
      r.slots
        .map(
          (s) =>
            `<option value="${esc(s.time)}" ${s.taken ? "disabled" : ""}>${esc(s.label)}${s.taken ? " — taken" : ""}</option>`,
        )
        .join("");
  } catch (e) {
    if (hintEl) hintEl.textContent = e.message;
  }
};

/* ---------- navigation ---------- */
App.go = function (id, opts) {
  const nav = App.NAV.find((n) => n.id === id && (!n.admin || App.isAdmin()));
  if (!nav || !App.views[id]) id = "dashboard";
  const n = App.NAV.find((x) => x.id === id);
  App.current = id;
  App.nextOpts = opts || {};
  history.replaceState(null, "", "#" + id);
  $$(".sb-item[data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === id),
  );
  $("#pageTitle").textContent = n.title;
  $("#app").classList.remove("sb-open");
  $("#userMenu").classList.add("hidden");
  const el = $("#view");
  el.innerHTML = '<div class="loading">Loading…</div>';
  window.scrollTo(0, 0);
  Promise.resolve(App.views[id].show(el)).catch((e) => {
    el.innerHTML = `<div class="panel empty">${esc(e.message || "Couldn't load this page.")}</div>`;
    App.fail(e);
  });
};
App.refresh = () => App.go(App.current, App.nextOpts);

App.refreshBell = async () => {
  try {
    const s = (await api("admin.php?r=stats")).stats;
    const btn = $("#bellBtn");
    btn.innerHTML =
      icon("bell", 20) +
      (s.pending ? `<span class="count-dot">${s.pending}</span>` : "");
    const pill = $("#pendingPill");
    if (pill) {
      pill.textContent = s.pending;
      pill.classList.toggle("hidden", !s.pending);
    }
    const mp = $("#msgPill");
    if (mp) {
      mp.textContent = s.unreadMessages;
      mp.classList.toggle("hidden", !s.unreadMessages);
    }
  } catch (_) {}
};

document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (g) {
    e.preventDefault();
    App.go(g.dataset.go, { tab: g.dataset.tab });
  }
  if (!e.target.closest(".userbox")) $("#userMenu").classList.add("hidden");
});

/* ===== Dashboard ===== */
/* Dashboard overview: stat cards, appointment calendar, today's schedule, charts, quick actions. */
App.views.dashboard = {
  async show(el) {
    const today = App.todayIso();
    const [s, t] = await Promise.all([
      api("admin.php?r=stats"),
      api(
        `admin.php?r=appointments&date=${today}&status=pending,approved,rescheduled,completed`,
      ),
    ]);
    const st = s.stats;
    App.refreshBell();

    const sched = t.appointments.length
      ? t.appointments
          .map((a) => {
            const [time, ap] = a.timeLabel.split(" ");
            return `<div class="sched-row"><div class="tbox">${esc(time)}<br />${esc(ap || "")}</div>
              <div class="who2"><strong>${esc(a.patientName)}</strong><span>${esc(a.service)}</span></div>${statusBadge(a.status)}</div>`;
          })
          .join("")
      : '<div class="empty">No appointments today.</div>';

    const weekly = st.weekly.map((v, i) => ({
      label: "Week " + (i + 1),
      value: v,
    }));
    const ps = st.patientStats;
    const donut = Charts.donut(
      [
        { label: "New Patients", value: ps.new },
        { label: "Returning Patients", value: ps.returning },
        { label: "Inactive Patients", value: ps.inactive },
      ],
      { center: App.num(st.patients) },
    );

    el.innerHTML = `
      <div class="sub-head"><h2>Dashboard Overview</h2><span class="muted">${icon("calendar", 16)} ${esc(fmtDate(today, true))}</span></div>
      <div class="cards five">${App.statCards([
        {
          icon: "users",
          tone: "blue",
          label: "Total Patients",
          value: App.num(st.patients),
          go: "patients",
          more: "View all patients",
        },
        {
          icon: "calendar",
          tone: "green",
          label: "Today's Appointments",
          value: App.num(st.today),
          go: "appointments",
          more: "View schedule",
        },
        {
          icon: "clock",
          tone: "orange",
          label: "Pending Appointments",
          value: App.num(st.pending),
          go: "appointments",
          tab: "pending",
          more: "View pending",
        },
        {
          icon: "tooth",
          tone: "violet",
          label: "Active Treatments",
          value: App.num(st.activeTreatments),
          go: "treatment",
          more: "View all",
        },
        {
          icon: "file",
          tone: "teal",
          label: "Total Records",
          value: App.num(st.records),
          go: "records",
          more: "View records",
        },
      ])}</div>

      <div class="grid-2">
        <div class="panel"><div class="panel-h"><h3>Appointment Calendar</h3>
          <div class="seg" id="calMode"><button data-m="day">Day</button><button data-m="week">Week</button><button data-m="month" class="active">Month</button></div></div>
          <div id="calBody"></div></div>
        <div class="panel"><div class="panel-h"><h3>Today's Schedule</h3><a href="#" data-go="appointments">View all →</a></div>
          <div class="sched-scroll">${sched}</div></div>
      </div>

      <div class="grid-3">
        <div class="panel"><div class="panel-h"><h3>Appointments Summary <small>(This Month)</small></h3></div><div class="chart">${Charts.line(weekly, { w: 340 })}</div></div>
        <div class="panel"><div class="panel-h"><h3>Patient Statistics</h3></div>
          <div class="donut-wrap">${donut.svg}${donut.legend}</div>
          <p class="slot-hint" style="margin-top:10px">New = joined in the last 30 days. Returning = visited in the last 6 months. Inactive = everyone else.</p></div>
        <div class="panel"><div class="panel-h"><h3>Quick Actions</h3></div>
          <div class="quick">
            <button type="button" data-q="appt">${icon("plus", 22)}New Appointment</button>
            <button type="button" data-q="patient">${icon("user", 22)}Add New Patient</button>
            <button type="button" data-q="record">${icon("file", 22)}Add Patient Record</button>
            <button type="button" data-q="report">${icon("chart", 22)}Generate Report</button>
          </div></div>
      </div>`;

    el.querySelector(".quick").addEventListener("click", (e) => {
      const b = e.target.closest("[data-q]");
      if (!b) return;
      const q = b.dataset.q;
      if (q === "appt") App.newAppointment();
      if (q === "patient") App.newPatient();
      if (q === "record") App.newRecord();
      if (q === "report") App.go("reports");
    });
    Calendar.init($("#calBody"), $("#calMode"));
  },
};

/* ---------- calendar (month / week / day) ---------- */
const Calendar = {
  mode: "month",
  cursor: new Date(),
  sel: App.todayIso(),
  async data(from, to) {
    const r = await api(
      `admin.php?r=appointments&from=${from}&to=${to}&status=pending,approved,rescheduled,completed`,
    );
    const map = {};
    r.appointments.forEach((a) => (map[a.date] = map[a.date] || []).push(a));
    return map;
  },
  init(body, modeEl) {
    this.body = body;
    this.cursor = new Date();
    this.sel = App.todayIso();
    this.mode = "month";
    modeEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-m]");
      if (!b) return;
      this.mode = b.dataset.m;
      $$("button", modeEl).forEach((x) =>
        x.classList.toggle("active", x === b),
      );
      this.render();
    });
    body.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-nav]");
      if (nav) {
        const d = nav.dataset.nav;
        if (d === "today") this.cursor = new Date();
        else {
          const step = d === "prev" ? -1 : 1;
          if (this.mode === "month")
            this.cursor.setMonth(this.cursor.getMonth() + step, 1);
          else
            this.cursor.setDate(
              this.cursor.getDate() + step * (this.mode === "week" ? 7 : 1),
            );
        }
        return this.render();
      }
      const cell = e.target.closest("[data-day]");
      if (cell) {
        this.sel = cell.dataset.day;
        this.cursor = new Date(this.sel + "T00:00");
        this.mode = "day";
        $$("#calMode button").forEach((x) =>
          x.classList.toggle("active", x.dataset.m === "day"),
        );
        this.render();
      }
    });
    this.render();
  },
  item(a) {
    return `<div class="sched-row"><div class="tbox">${esc(a.timeLabel)}</div>
      <div class="who2"><strong>${esc(a.patientName)}</strong><span>${esc(a.service)}</span></div>${statusBadge(a.status)}</div>`;
  },
  async render() {
    const c = new Date(
      this.cursor.getFullYear(),
      this.cursor.getMonth(),
      this.cursor.getDate(),
    );
    const nav = (
      title,
    ) => `<div class="cal-nav"><button data-nav="prev" aria-label="Previous">${icon("chevleft", 16)}</button>
      <span class="ttl">${esc(title)}</span><button data-nav="next" aria-label="Next">${icon("chevright", 16)}</button><button data-nav="today">Today</button></div>`;
    try {
      if (this.mode === "month") {
        const first = new Date(c.getFullYear(), c.getMonth(), 1);
        const start = new Date(first);
        start.setDate(1 - first.getDay());
        const rows = Math.ceil(
          (first.getDay() +
            new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate()) /
            7,
        );
        const end = new Date(start);
        end.setDate(start.getDate() + rows * 7 - 1);
        const map = await this.data(isoDate(start), isoDate(end));
        let cells = "";
        for (let i = 0; i < rows * 7; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const iso = isoDate(d);
          const n = (map[iso] || []).length;
          cells += `<div class="cal-cell ${d.getMonth() !== c.getMonth() ? "other" : ""} ${iso === App.todayIso() ? "today" : ""}" data-day="${iso}">${d.getDate()}${n ? `<br /><span class="n">${n}</span>` : ""}</div>`;
        }
        const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
          .map((x) => `<div class="cal-dow">${x}</div>`)
          .join("");
        this.body.innerHTML =
          nav(
            c.toLocaleDateString("en-PH", { month: "long", year: "numeric" }),
          ) + `<div class="cal-grid">${dows}${cells}</div>`;
      } else if (this.mode === "week") {
        const start = new Date(c);
        start.setDate(c.getDate() - c.getDay());
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const map = await this.data(isoDate(start), isoDate(end));
        let html = "";
        for (let i = 0; i < 7; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const iso = isoDate(d);
          html +=
            `<div class="agenda-day">${esc(fmtDate(iso, true))}</div>` +
            ((map[iso] || []).map((a) => this.item(a)).join("") ||
              '<div class="muted mini">No appointments</div>');
        }
        const t = `${start.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}`;
        this.body.innerHTML =
          nav(t) + `<div class="agenda sched-scroll">${html}</div>`;
      } else {
        const iso = isoDate(c);
        const map = await this.data(iso, iso);
        this.body.innerHTML =
          nav(fmtDate(iso, true)) +
          `<div class="agenda sched-scroll">${(map[iso] || []).map((a) => this.item(a)).join("") || '<div class="empty">No appointments on this day.</div>'}</div>`;
      }
    } catch (e) {
      this.body.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  },
};

/* ===== Appointments ===== */
/* Appointments: tabs, filters, approve / reschedule / decline / complete / cancel, staff-made bookings. */
(() => {
  const st = { tab: "all", q: "", from: "", to: "" };
  const TABS = [
    ["all", "All Appointments"],
    ["pending", "Pending"],
    ["upcoming", "Upcoming"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
  ];
  const ACT = {
    approve: ["Approve appointment", "Approve"],
    decline: ["Decline appointment", "Decline"],
    reschedule: ["Reschedule appointment", "Save new time"],
    complete: ["Mark as completed", "Mark completed"],
    cancel: ["Cancel appointment", "Cancel appointment"],
  };
  const rows = new Map();

  function query() {
    const p = new URLSearchParams();
    if (st.tab === "pending") p.set("status", "pending");
    if (st.tab === "upcoming")
      (p.set("status", "approved,rescheduled"), p.set("range", "upcoming"));
    if (st.tab === "completed")
      (p.set("status", "completed"), p.set("sort", "desc"));
    if (st.tab === "cancelled")
      (p.set("status", "cancelled,declined"), p.set("sort", "desc"));
    if (st.from) p.set("from", st.from);
    if (st.to) p.set("to", st.to);
    if (st.q) p.set("q", st.q);
    return p.toString();
  }

  function btns(a) {
    const b = (act, label, cls) =>
      `<button type="button" class="btn btn-sm ${cls}" data-act="${act}" data-id="${a.id}">${label}</button>`;
    let h = "";
    if (a.status === "pending")
      h =
        b("approve", "Approve", "btn-ok") +
        b("reschedule", "Reschedule", "btn-ghost") +
        b("decline", "Decline", "btn-danger");
    else if (a.status === "approved" || a.status === "rescheduled")
      h =
        b("reschedule", "Reschedule", "btn-ghost") +
        (a.date <= App.todayIso() ? b("complete", "Complete", "btn-ok") : "") +
        b("cancel", "Cancel", "btn-danger");
    else h = '<span class="muted">—</span>';
    if (App.isAdmin())
      h += App.iconBtn(
        "trash",
        "ib-del",
        `data-del="${a.id}"`,
        "Delete appointment",
      );
    return h;
  }

  function row(a) {
    rows.set(a.id, a);
    return `<tr>
      <td>${esc(a.timeLabel)}</td>
      <td><strong>${esc(a.patientName)}</strong><small>${esc(a.phone)}</small>${a.notes ? `<small>“${esc(a.notes)}”</small>` : ""}</td>
      <td>${esc(a.service)}</td><td>${esc(a.dentist)}</td>
      <td>${esc(fmtDate(a.date))}${a.status === "rescheduled" && a.prevDate ? `<small>was ${esc(fmtDate(a.prevDate))}, ${esc(a.prevTimeLabel)}</small>` : ""}</td>
      <td>${statusBadge(a.status)}${a.paid > 0 && !(a.billable && a.fee > 0) ? `<small>Paid ${esc(peso(a.paid))}</small>` : ""}${a.adminNote ? `<small>${esc(a.adminNote)}</small>` : ""}</td>
      <td><div class="tbl-actions">${btns(a)}</div></td></tr>`;
  }

  async function load() {
    const r = await api("admin.php?r=appointments&" + query());
    const c = r.counts;
    $("#apCards").innerHTML = App.statCards([
      {
        icon: "calendar",
        tone: "blue",
        label: "Total Appointments",
        value: App.num(c.total),
      },
      {
        icon: "clock",
        tone: "orange",
        label: "Pending",
        value: App.num(c.pending),
      },
      {
        icon: "calendar",
        tone: "green",
        label: "Upcoming",
        value: App.num(c.upcoming),
      },
      {
        icon: "check",
        tone: "violet",
        label: "Completed",
        value: App.num(c.completed),
      },
      {
        icon: "x",
        tone: "red",
        label: "Cancelled / Declined",
        value: App.num(c.cancelled),
      },
    ]);
    r.appointments.forEach((a) => rows.set(a.id, a));
    $("#apTable").innerHTML = App.table(
      ["Time", "Patient", "Service", "Dentist", "Date", "Status", "Action"],
      r.appointments.map(row),
      "No appointments match these filters.",
    );
    App.refreshBell();
  }

  App.views.appointments = {
    async show(el) {
      if (App.nextOpts.tab) st.tab = App.nextOpts.tab;
      el.innerHTML = `
        <div class="tabs">${TABS.map(([k, l]) => `<button class="tab ${st.tab === k ? "active" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>
        <div class="toolbar">
          ${App.searchBox("apQ", "Search patient, phone, email or service", st.q)}
          <input type="date" id="apFrom" value="${esc(st.from)}" title="From date" />
          <input type="date" id="apTo" value="${esc(st.to)}" title="To date" />
          <button class="btn btn-ghost" id="apReset" type="button">Reset</button>
          <button class="btn btn-primary" id="apNew" type="button">${icon("plus", 16)} New Appointment</button>
        </div>
        <div class="cards five" id="apCards"></div>
        <div class="panel" id="apTable"></div>`;

      $$(".tab", el).forEach((t) =>
        t.addEventListener("click", () => {
          st.tab = t.dataset.tab;
          $$(".tab", el).forEach((x) => x.classList.toggle("active", x === t));
          load().catch(App.fail);
        }),
      );
      $("#apQ").addEventListener(
        "input",
        App.debounce(
          (e) => ((st.q = e.target.value.trim()), load().catch(App.fail)),
        ),
      );
      $("#apFrom").addEventListener(
        "change",
        (e) => ((st.from = e.target.value), load().catch(App.fail)),
      );
      $("#apTo").addEventListener(
        "change",
        (e) => ((st.to = e.target.value), load().catch(App.fail)),
      );
      $("#apReset").addEventListener("click", () => {
        Object.assign(st, { tab: "all", q: "", from: "", to: "" });
        App.go("appointments");
      });
      $("#apNew").addEventListener("click", () => App.newAppointment());
      $("#apTable").addEventListener("click", async (e) => {
        const b = e.target.closest("[data-act]");
        if (b) return App.apptAction(rows.get(+b.dataset.id), b.dataset.act);
        const d = e.target.closest("[data-del]");
        if (
          d &&
          (await App.confirm({
            title: "Delete this appointment?",
            text: "This also removes its payments. This can't be undone.",
            confirmText: "Delete",
          }))
        ) {
          try {
            await api("admin.php?r=appointments", {
              method: "POST",
              body: { action: "delete", id: +d.dataset.del },
            });
            App.toast("Appointment deleted.");
            load();
          } catch (err) {
            App.fail(err);
          }
        }
      });
      await load();
    },
  };

  App.apptAction = function (a, action) {
    if (!a) return;
    const [title, label] = ACT[action];
    const fields = [];
    if (action === "reschedule") {
      fields.push(
        {
          name: "date",
          label: "New date",
          type: "date",
          required: true,
          min: App.todayIso(),
        },
        {
          name: "time",
          label: "New time",
          type: "select",
          required: true,
          options: [["", "Pick a date first"]],
          hint: "Taken times are disabled.",
        },
      );
    }
    fields.push({
      name: "note",
      label: "Message to the patient (optional)",
      type: "textarea",
      rows: 3,
      maxlength: 500,
      placeholder: "Shown on the patient's My Appointments page.",
    });
    App.form({
      title,
      sub: `${a.patientName} · ${a.service} · ${fmtDate(a.date)} at ${a.timeLabel}`,
      fields,
      values: { note: a.adminNote || "" },
      submit: label,
      onOpen: () => {
        if (action !== "reschedule") return;
        $("#f_date").addEventListener("change", () =>
          App.loadSlots(
            $("#f_date").value,
            $("#f_time"),
            $("#f_time").parentElement.querySelector(".slot-hint"),
            a.id,
          ),
        );
      },
      async onSubmit(v) {
        const body = { id: a.id, action, note: v.note };
        if (action === "reschedule")
          Object.assign(body, { date: v.date, time: v.time });
        await api("admin.php?r=appointments", { method: "POST", body });
        App.toast("Appointment updated.");
        App.refresh();
      },
    });
  };

  App.newAppointment = async function () {
    let patients, dentists;
    try {
      [patients, dentists] = await Promise.all([
        App.patients(true),
        App.dentists(),
      ]);
    } catch (e) {
      return App.fail(e);
    }
    if (!patients.length)
      return App.toast("There are no patients yet. Add a patient first.", true);
    App.form({
      title: "New appointment",
      sub: "Booked by staff for a patient. It is approved right away.",
      fields: [
        {
          name: "patientId",
          label: "Patient",
          type: "select",
          full: true,
          required: true,
          options: [
            ["", "Select a patient"],
            ...patients.map((p) => [p.id, `${p.fullName} (@${p.username})`]),
          ],
        },
        {
          name: "service",
          label: "Service",
          type: "select",
          required: true,
          options: [["", "Select a service"], ...SERVICES.map((s) => [s, s])],
        },
        {
          name: "dentist",
          label: "Dentist",
          type: "select",
          options: dentists.map((d) => [d, d]),
        },
        {
          name: "date",
          label: "Date",
          type: "date",
          required: true,
          min: App.todayIso(),
        },
        {
          name: "time",
          label: "Time",
          type: "select",
          required: true,
          options: [["", "Pick a date first"]],
          hint: "Taken times are disabled.",
        },
        {
          name: "notes",
          label: "Notes (optional)",
          type: "textarea",
          rows: 2,
          maxlength: 1000,
        },
      ],
      submit: "Book appointment",
      onOpen: () =>
        $("#f_date").addEventListener("change", () =>
          App.loadSlots(
            $("#f_date").value,
            $("#f_time"),
            $("#f_time").parentElement.querySelector(".slot-hint"),
          ),
        ),
      async onSubmit(v) {
        await api("admin.php?r=appointments", {
          method: "POST",
          body: {
            action: "create",
            patientId: +v.patientId,
            service: v.service,
            dentist: v.dentist,
            date: v.date,
            time: v.time,
            notes: v.notes,
          },
        });
        App.toast("Appointment booked.");
        App.refresh();
      },
    });
  };
})();

/* ===== Patients ===== */
/* Patients: list, add / edit / delete, reset password, full patient profile. */
(() => {
  const st = { q: "" };
  const byId = new Map();

  function row(p) {
    byId.set(p.id, p);
    return `<tr>
      <td>${App.code("PT", p.id)}</td>
      <td><strong>${esc(p.fullName)}</strong><small>@${esc(p.username)}</small></td>
      <td>${esc(App.cap(p.gender))}</td><td>${esc(p.phone)}</td><td>${esc(p.email)}</td>
      <td>${p.lastVisit ? esc(fmtDate(p.lastVisit)) : "—"}</td>
      <td>${p.due > 0 ? `<strong class="down">${esc(peso(p.due))}</strong>` : "—"}</td>
      <td><div class="tbl-actions">${App.iconBtn("eye", "ib-view", `data-view="${p.id}"`, "View patient")}${App.iconBtn("edit", "ib-edit", `data-edit="${p.id}"`, "Edit patient")}${App.isAdmin() ? App.iconBtn("trash", "ib-del", `data-del="${p.id}"`, "Delete patient") : ""}</div></td></tr>`;
  }

  async function load() {
    const r = await api("admin.php?r=patients&q=" + encodeURIComponent(st.q));
    const s = r.stats;
    $("#ptCards").innerHTML = App.statCards([
      {
        icon: "users",
        tone: "blue",
        label: "Total Patients",
        value: App.num(s.total),
      },
      { icon: "male", tone: "blue", label: "Male", value: App.num(s.male) },
      {
        icon: "female",
        tone: "pink",
        label: "Female",
        value: App.num(s.female),
      },
      {
        icon: "plus",
        tone: "green",
        label: "New This Month",
        value: App.num(s.newMonth),
      },
    ]);
    byId.clear();
    $("#ptTable").innerHTML = App.table(
      [
        "Patient ID",
        "Patient Name",
        "Gender",
        "Phone",
        "Email",
        "Last Visit",
        "Balance",
        "Action",
      ],
      r.patients.map(row),
      "No patients found.",
    );
  }

  App.views.patients = {
    async show(el) {
      el.innerHTML = `
        <div class="toolbar">${App.searchBox("ptQ", "Search patient name, email, phone or address", st.q)}
          <button class="btn btn-primary" id="ptNew" type="button">${icon("plus", 16)} Add New Patient</button></div>
        <div class="cards" id="ptCards"></div><div class="panel" id="ptTable"></div>`;
      $("#ptQ").addEventListener(
        "input",
        App.debounce(
          (e) => ((st.q = e.target.value.trim()), load().catch(App.fail)),
        ),
      );
      $("#ptNew").addEventListener("click", () => App.newPatient());
      $("#ptTable").addEventListener("click", async (e) => {
        const v = e.target.closest("[data-view]"),
          ed = e.target.closest("[data-edit]"),
          d = e.target.closest("[data-del]");
        if (v) return viewPatient(+v.dataset.view);
        if (ed) return editPatient(byId.get(+ed.dataset.edit));
        if (d) {
          const p = byId.get(+d.dataset.del);
          if (
            await App.confirm({
              title: `Delete ${p.fullName}?`,
              text: "This also deletes their appointments, payments, records and treatments. This can't be undone.",
              confirmText: "Delete patient",
            })
          ) {
            try {
              await api("admin.php?r=patients", {
                method: "POST",
                body: { action: "delete", id: p.id },
              });
              App._patients = null;
              App.toast("Patient deleted.");
              load();
            } catch (err) {
              App.fail(err);
            }
          }
        }
      });
      await load();
    },
  };

  const profileFields = (creating) => [
    { name: "firstName", label: "First name", required: true },
    { name: "middleName", label: "Middle name" },
    { name: "lastName", label: "Last name", required: true },
    {
      name: "gender",
      label: "Gender",
      type: "select",
      required: true,
      options: [
        ["", "Select gender"],
        ["male", "Male"],
        ["female", "Female"],
        ["non-binary", "Non-binary"],
        ["prefer-not-to-say", "Prefer not to say"],
      ],
    },
    {
      name: "birthDate",
      label: "Birth date",
      type: "date",
      required: true,
      max: App.todayIso(),
    },
    {
      name: "phone",
      label: "Phone number",
      type: "tel",
      required: true,
      placeholder: "09XX XXX XXXX",
    },
    {
      name: "email",
      label: "Email",
      type: "email",
      required: true,
      full: true,
    },
    {
      name: "address",
      label: "Address",
      required: true,
      full: true,
      placeholder: "House no., street, barangay, city",
    },
    ...(creating
      ? [
          {
            name: "username",
            label: "Username (optional)",
            full: true,
            hint: "Leave blank to create one automatically.",
          },
        ]
      : []),
  ];

  App.newPatient = function () {
    App.form({
      title: "Add new patient",
      sub: "For walk-ins and phone bookings. A temporary password is generated for them.",
      fields: profileFields(true),
      submit: "Add patient",
      async onSubmit(v) {
        const r = await api("admin.php?r=patients", {
          method: "POST",
          body: { action: "create", ...v },
        });
        App._patients = null;
        App.refresh();
        App.secret({
          title: "Patient added",
          sub: `${v.firstName} ${v.lastName} can now sign in.`,
          username: r.username,
          password: r.tempPassword,
        });
        return "keep";
      },
    });
  };

  function editPatient(p) {
    if (!p) return;
    App.form({
      title: "Edit patient",
      sub: `${App.code("PT", p.id)} · @${p.username}`,
      fields: profileFields(false),
      values: p,
      async onSubmit(v) {
        await api("admin.php?r=patients", {
          method: "POST",
          body: { action: "update", id: p.id, ...v },
        });
        App._patients = null;
        App.toast("Patient updated.");
        App.refresh();
      },
    });
  }

  async function viewPatient(id) {
    let r;
    try {
      r = await api("admin.php?r=patients&id=" + id);
    } catch (e) {
      return App.fail(e);
    }
    const p = r.patient,
      b = r.billing;
    const visits = r.appointments.map(
      (
        a,
      ) => `<tr><td>${esc(fmtDate(a.date))}<small>${esc(a.timeLabel)}</small></td><td>${esc(a.service)}</td><td>${statusBadge(a.status)}</td>
        <td>${a.billable && a.fee > 0 ? `${esc(peso(a.fee))}<small>${a.balance > 0 ? "Balance " + esc(peso(a.balance)) : "Paid"}</small>` : "—"}</td></tr>`,
    );
    const treatments = r.treatments.map(
      (t) =>
        `<tr><td>${esc(t.name)}</td><td>${esc(t.dentist)}</td><td>${esc(fmtDate(t.start_date))}</td><td>${App.trBadge(t.status)}</td></tr>`,
    );
    const records = r.records.map(
      (x) =>
        `<tr><td>${esc(x.title)}</td><td>${esc(App.recLabel(x.record_type))}</td><td>${esc(fmtDate(x.record_date))}</td></tr>`,
    );
    App.dialog({
      title: p.fullName,
      sub: `${App.code("PT", p.id)} · patient since ${fmtDate(p.joined, true)}`,
      wide: true,
      html: `<dl class="kv">
          <dt>Username</dt><dd>@${esc(p.username)}</dd><dt>Phone</dt><dd>${esc(p.phone)}</dd><dt>Email</dt><dd>${esc(p.email)}</dd>
          <dt>Address</dt><dd>${esc(p.address || "—")}</dd><dt>Birth date</dt><dd>${esc(fmtDate(p.birthDate, true))} (${p.age} yrs)</dd><dt>Gender</dt><dd>${esc(App.cap(p.gender))}</dd></dl>
        <div class="chips"><div class="chip"><span>Total billed</span><strong>${esc(peso(b.billed))}</strong></div><div class="chip"><span>Total paid</span><strong>${esc(peso(b.paid))}</strong></div>
          <div class="chip"><span>Remaining balance</span><strong class="${b.due > 0 ? "down" : "up"}">${esc(peso(b.due))}</strong></div></div>
        <h4 class="dlg-h4">Visit history</h4>${App.table(["Date", "Service", "Status", "Fee"], visits, "No appointments yet.")}
        <h4 class="dlg-h4">Treatments</h4>${App.table(["Treatment", "Dentist", "Start", "Status"], treatments, "No treatments yet.")}
        <h4 class="dlg-h4">Records</h4>${App.table(["Title", "Type", "Date"], records, "No records yet.")}`,
      buttons: [
        { label: "Edit", onClick: () => editPatient({ ...p, id: p.id }) },
        {
          label: "Reset password",
          onClick: async () => {
            if (
              !(await App.confirm({
                title: "Reset this patient's password?",
                text: "A new temporary password will replace the old one.",
                confirmText: "Reset password",
              }))
            )
              return;
            try {
              const x = await api("admin.php?r=patients", {
                method: "POST",
                body: { action: "reset_password", id: p.id },
              });
              App.secret({
                title: "Password reset",
                sub: p.fullName,
                username: x.username,
                password: x.tempPassword,
              });
            } catch (e) {
              App.fail(e);
            }
          },
        },
        { label: "Close", cls: "btn-primary", onClick: App.close },
      ],
    });
  }
})();

/* ===== Records ===== */
/* Records: medical history, prescriptions, x-rays & images, lab results, documents. */
(() => {
  const CATS = [
    ["all", "All Records"],
    ["medical_history", "Medical History"],
    ["prescription", "Prescriptions"],
    ["xray", "X-Ray & Images"],
    ["lab_result", "Lab Results"],
    ["document", "Documents"],
  ];
  const ONE = {
    medical_history: "Medical History",
    prescription: "Prescription",
    xray: "X-Ray / Image",
    lab_result: "Lab Result",
    document: "Document",
  };
  const PER = 10;
  const st = { type: "all", q: "", page: 1 };
  let list = [];
  App.recLabel = (t) => ONE[t] || t;

  function drawTable() {
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / PER));
    if (st.page > pages) st.page = pages;
    const slice = list.slice((st.page - 1) * PER, st.page * PER);
    const rows = slice.map(
      (
        r,
      ) => `<tr><td>${App.code("RC", r.id)}</td><td><strong>${esc(r.patientName)}</strong></td>
        <td>${esc(ONE[r.type])}<small>${esc(r.title)}${r.hasFile ? " · 📎" : ""}</small></td><td>${esc(fmtDate(r.date))}</td><td>${esc(r.addedBy || "—")}</td>
        <td><div class="tbl-actions">${App.iconBtn("eye", "ib-view", `data-view="${r.id}"`, "View record")}${App.iconBtn("edit", "ib-edit", `data-edit="${r.id}"`, "Edit record")}${App.isAdmin() ? App.iconBtn("trash", "ib-del", `data-del="${r.id}"`, "Delete record") : ""}</div></td></tr>`,
    );
    $("#rcTable").innerHTML =
      App.table(
        ["Record ID", "Patient", "Record Type", "Date", "Added By", "Action"],
        rows,
        "No records found.",
      ) + (total ? App.pagerHtml(total, st.page, PER) : "");
  }

  async function load() {
    const r = await api(
      `admin.php?r=records&type=${st.type}&q=${encodeURIComponent(st.q)}`,
    );
    list = r.records;
    $("#rcCats").innerHTML = CATS.map(
      ([k, l]) =>
        `<button class="cat ${st.type === k ? "active" : ""}" data-cat="${k}"><span>${l}</span><span>${App.num(r.counts[k])}</span></button>`,
    ).join("");
    drawTable();
  }

  App.views.records = {
    async show(el) {
      el.innerHTML = `<div class="rec-layout"><div class="cat-list" id="rcCats"></div>
        <div class="panel"><div class="toolbar">${App.searchBox("rcQ", "Search title or patient", st.q)}
          <button class="btn btn-primary" id="rcNew" type="button">${icon("plus", 16)} Add Record</button></div><div id="rcTable"></div></div></div>`;
      $("#rcCats").addEventListener("click", (e) => {
        const c = e.target.closest("[data-cat]");
        if (c) {
          st.type = c.dataset.cat;
          st.page = 1;
          load().catch(App.fail);
        }
      });
      $("#rcQ").addEventListener(
        "input",
        App.debounce(
          (e) => (
            (st.q = e.target.value.trim()),
            (st.page = 1),
            load().catch(App.fail)
          ),
        ),
      );
      $("#rcNew").addEventListener("click", () => App.newRecord());
      App.bindPager($("#rcTable"), (p) => ((st.page = p), drawTable()));
      $("#rcTable").addEventListener("click", async (e) => {
        const v = e.target.closest("[data-view]"),
          ed = e.target.closest("[data-edit]"),
          d = e.target.closest("[data-del]");
        if (v) return view(list.find((r) => r.id === +v.dataset.view));
        if (ed) return edit(list.find((r) => r.id === +ed.dataset.edit));
        if (
          d &&
          (await App.confirm({
            title: "Delete this record?",
            text: "The attached file is deleted too. This can't be undone.",
            confirmText: "Delete",
          }))
        ) {
          try {
            await api("admin.php?r=records", {
              method: "POST",
              body: { action: "delete", id: +d.dataset.del },
            });
            App.toast("Record deleted.");
            load();
          } catch (err) {
            App.fail(err);
          }
        }
      });
      await load();
    },
  };

  const typeOptions = Object.entries(ONE).map(([k, l]) => [k, l]);

  App.newRecord = async function () {
    let patients;
    try {
      patients = await App.patients(true);
    } catch (e) {
      return App.fail(e);
    }
    if (!patients.length)
      return App.toast("There are no patients yet. Add a patient first.", true);
    App.form({
      title: "Add patient record",
      sub: "Files can be JPG, PNG, WebP or PDF, up to 5 MB.",
      fields: [
        {
          name: "patientId",
          label: "Patient",
          type: "select",
          full: true,
          required: true,
          options: [
            ["", "Select a patient"],
            ...patients.map((p) => [p.id, `${p.fullName} (@${p.username})`]),
          ],
        },
        {
          name: "type",
          label: "Record type",
          type: "select",
          required: true,
          options: typeOptions,
        },
        {
          name: "date",
          label: "Record date",
          type: "date",
          required: true,
          value: App.todayIso(),
        },
        {
          name: "title",
          label: "Title",
          required: true,
          full: true,
          placeholder: "e.g. Panoramic X-ray, Amoxicillin 500 mg",
        },
        {
          name: "details",
          label: "Details / notes",
          type: "textarea",
          rows: 4,
        },
        {
          name: "file",
          label: "Attach a file (optional)",
          type: "file",
          full: true,
          accept: ".jpg,.jpeg,.png,.webp,.pdf",
        },
      ],
      submit: "Save record",
      async onSubmit(v) {
        await api("admin.php?r=records", {
          method: "POST",
          body: {
            action: "create",
            patientId: +v.patientId,
            type: v.type,
            date: v.date,
            title: v.title,
            details: v.details,
            file: v.file,
          },
        });
        App.toast("Record saved.");
        App.refresh();
      },
    });
  };

  function edit(r) {
    if (!r) return;
    App.form({
      title: "Edit record",
      sub: `${App.code("RC", r.id)} · ${r.patientName}`,
      fields: [
        {
          name: "type",
          label: "Record type",
          type: "select",
          required: true,
          options: typeOptions,
        },
        { name: "date", label: "Record date", type: "date", required: true },
        { name: "title", label: "Title", required: true, full: true },
        {
          name: "details",
          label: "Details / notes",
          type: "textarea",
          rows: 4,
        },
      ],
      values: r,
      async onSubmit(v) {
        await api("admin.php?r=records", {
          method: "POST",
          body: { action: "update", id: r.id, ...v },
        });
        App.toast("Record updated.");
        App.refresh();
      },
    });
  }

  function view(r) {
    if (!r) return;
    const url = `${SITE_ROOT}api/admin.php?r=record_file&id=${r.id}`;
    let file = "";
    if (r.hasFile) {
      file =
        r.fileMime && r.fileMime.startsWith("image/")
          ? `<img class="preview" src="${url}" alt="${esc(r.title)}" />`
          : "";
      file += `<p><a href="${url}" target="_blank" rel="noopener">Open ${esc(r.fileName || "file")} in a new tab</a></p>`;
    }
    App.dialog({
      title: r.title,
      sub: `${App.code("RC", r.id)} · ${ONE[r.type]} · ${r.patientName}`,
      wide: true,
      html: `<dl class="kv"><dt>Record date</dt><dd>${esc(fmtDate(r.date, true))}</dd><dt>Added by</dt><dd>${esc(r.addedBy || "—")}</dd></dl>
        ${r.details ? `<div class="note-box">${esc(r.details)}</div>` : '<p class="muted">No notes.</p>'}${file}`,
      buttons: [
        { label: "Edit", onClick: () => edit(r) },
        { label: "Close", cls: "btn-primary", onClick: App.close },
      ],
    });
  }
})();

/* ===== Treatment ===== */
/* Treatment: ongoing treatments, completed ones and treatment plans. */
(() => {
  const LABEL = {
    plan: "Treatment Plan",
    ongoing: "Ongoing",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  const st = { status: "all", q: "" };
  const byId = new Map();
  App.trBadge = (s) =>
    `<span class="badge badge-${s === "completed" ? "completed" : s === "cancelled" ? "cancelled" : s}">${esc(LABEL[s] || s)}</span>`;

  function row(t) {
    byId.set(t.id, t);
    const done = t.status === "plan" || t.status === "ongoing";
    return `<tr><td>${App.code("TR", t.id)}</td><td><strong>${esc(t.patientName)}</strong></td><td>${esc(t.name)}${t.notes ? `<small>${esc(t.notes.slice(0, 80))}${t.notes.length > 80 ? "…" : ""}</small>` : ""}</td>
      <td>${esc(t.dentist)}</td><td>${esc(fmtDate(t.startDate))}</td><td>${App.trBadge(t.status)}</td>
      <td><div class="tbl-actions">${done ? App.iconBtn("check", "ib-ok", `data-done="${t.id}"`, "Mark completed") : ""}${App.iconBtn("edit", "ib-edit", `data-edit="${t.id}"`, "Edit treatment")}${App.isAdmin() ? App.iconBtn("trash", "ib-del", `data-del="${t.id}"`, "Delete treatment") : ""}</div></td></tr>`;
  }

  async function load() {
    const r = await api(
      `admin.php?r=treatments&status=${st.status}&q=${encodeURIComponent(st.q)}`,
    );
    const c = r.counts;
    $("#trCards").innerHTML = App.statCards([
      {
        icon: "tooth",
        tone: "green",
        label: "Ongoing Treatments",
        value: App.num(c.ongoing),
      },
      {
        icon: "check",
        tone: "blue",
        label: "Completed",
        value: App.num(c.completed),
      },
      {
        icon: "file",
        tone: "violet",
        label: "Treatment Plans",
        value: App.num(c.plan),
      },
      {
        icon: "x",
        tone: "red",
        label: "Cancelled",
        value: App.num(c.cancelled),
      },
    ]);
    byId.clear();
    $("#trTable").innerHTML = App.table(
      [
        "Treatment ID",
        "Patient",
        "Treatment",
        "Dentist",
        "Start Date",
        "Status",
        "Action",
      ],
      r.treatments.map(row),
      "No treatments found.",
    );
  }

  const fields = (creating, patients, dentists) => [
    ...(creating
      ? [
          {
            name: "patientId",
            label: "Patient",
            type: "select",
            full: true,
            required: true,
            options: [
              ["", "Select a patient"],
              ...patients.map((p) => [p.id, `${p.fullName} (@${p.username})`]),
            ],
          },
        ]
      : []),
    {
      name: "name",
      label: "Treatment",
      required: true,
      full: true,
      placeholder: "e.g. Root canal therapy, Braces (orthodontics)",
    },
    {
      name: "dentist",
      label: "Dentist",
      type: "select",
      options: dentists.map((d) => [d, d]),
    },
    {
      name: "startDate",
      label: "Start date",
      type: "date",
      required: true,
      value: App.todayIso(),
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      options: Object.entries(LABEL),
    },
    { name: "notes", label: "Notes", type: "textarea", rows: 3 },
  ];

  async function open(t) {
    let patients = [],
      dentists;
    try {
      [dentists, patients] = await Promise.all([
        App.dentists(),
        t ? [] : App.patients(true),
      ]);
    } catch (e) {
      return App.fail(e);
    }
    if (!t && !patients.length)
      return App.toast("There are no patients yet. Add a patient first.", true);
    const dOpts =
      t && !dentists.includes(t.dentist) ? [...dentists, t.dentist] : dentists;
    App.form({
      title: t ? "Edit treatment" : "New treatment",
      sub: t ? `${App.code("TR", t.id)} · ${t.patientName}` : "",
      fields: fields(!t, patients, dOpts),
      values: t || { status: "ongoing" },
      async onSubmit(v) {
        const body = t
          ? { action: "update", id: t.id, ...v }
          : { action: "create", ...v, patientId: +v.patientId };
        await api("admin.php?r=treatments", { method: "POST", body });
        App.toast(t ? "Treatment updated." : "Treatment added.");
        App.refresh();
      },
    });
  }

  App.views.treatment = {
    async show(el) {
      el.innerHTML = `<div class="toolbar">${App.searchBox("trQ", "Search treatment, patient or dentist", st.q)}
        <select id="trStatus"><option value="all">All statuses</option>${Object.entries(
          LABEL,
        )
          .map(
            ([k, l]) =>
              `<option value="${k}" ${st.status === k ? "selected" : ""}>${l}</option>`,
          )
          .join("")}</select>
        <button class="btn btn-primary" id="trNew" type="button">${icon("plus", 16)} New Treatment</button></div>
        <div class="cards" id="trCards"></div><div class="panel" id="trTable"></div>`;
      $("#trQ").addEventListener(
        "input",
        App.debounce(
          (e) => ((st.q = e.target.value.trim()), load().catch(App.fail)),
        ),
      );
      $("#trStatus").addEventListener(
        "change",
        (e) => ((st.status = e.target.value), load().catch(App.fail)),
      );
      $("#trNew").addEventListener("click", () => open(null));
      $("#trTable").addEventListener("click", async (e) => {
        const ed = e.target.closest("[data-edit]"),
          dn = e.target.closest("[data-done]"),
          d = e.target.closest("[data-del]");
        if (ed) return open(byId.get(+ed.dataset.edit));
        try {
          if (dn) {
            const t = byId.get(+dn.dataset.done);
            await api("admin.php?r=treatments", {
              method: "POST",
              body: {
                action: "update",
                id: t.id,
                name: t.name,
                dentist: t.dentist,
                startDate: t.startDate,
                status: "completed",
                notes: t.notes || "",
              },
            });
            App.toast("Treatment marked completed.");
            load();
          }
          if (
            d &&
            (await App.confirm({
              title: "Delete this treatment?",
              text: "This can't be undone.",
              confirmText: "Delete",
            }))
          ) {
            await api("admin.php?r=treatments", {
              method: "POST",
              body: { action: "delete", id: +d.dataset.del },
            });
            App.toast("Treatment deleted.");
            load();
          }
        } catch (err) {
          App.fail(err);
        }
      });
      await load();
    },
  };
})();

/* ===== Billing ===== */
/* Billing: invoices per visit (fee set by staff), payments recorded by staff, balances patients see. */
(() => {
  const STATUS = {
    notbilled: "Not billed",
    unpaid: "Unpaid",
    partial: "Partial",
    paid: "Paid",
    refund: "Refund due",
  };
  const st = { status: "all", q: "" };
  let all = [];
  let changed = false;

  function drawTable() {
    const q = st.q.toLowerCase();
    const rows = all
      .filter(
        (i) =>
          (st.status === "all" || i.status === st.status) &&
          (!q ||
            `${App.code("INV", i.id)} ${i.patientName} ${i.service}`
              .toLowerCase()
              .includes(q)),
      )
      .map(
        (
          i,
        ) => `<tr><td>${App.code("INV", i.id)}</td><td><strong>${esc(i.patientName)}</strong><small>${esc(i.service)}</small></td>
          <td>${i.invoiceDate ? esc(fmtDate(i.invoiceDate)) : "—"}</td><td>${i.dueDate ? esc(fmtDate(i.dueDate)) : "—"}</td>
          <td>${i.fee > 0 ? esc(peso(i.fee)) : "—"}</td>
          <td>${i.status === "refund" ? "—" : i.fee > 0 ? esc(peso(i.balance)) : i.paid > 0 ? `<small>Paid ${esc(peso(i.paid))}</small>` : "—"}</td>
          <td><span class="badge badge-${i.status}">${STATUS[i.status]}</span>${i.overdue ? '<span class="badge badge-overdue">Overdue</span>' : ""}</td>
          <td><div class="tbl-actions">${App.iconBtn("edit", "ib-edit", `data-bill="${i.id}"`, i.fee > 0 ? "Manage invoice" : "Set fee")}</div></td></tr>`,
      );
    $("#blTable").innerHTML = App.table(
      [
        "Invoice ID",
        "Patient",
        "Date",
        "Due Date",
        "Amount",
        "Balance",
        "Status",
        "Action",
      ],
      rows,
      "No invoices match these filters.",
    );
  }

  App.views.billing = {
    async show(el) {
      const r = await api("admin.php?r=billing&list=1");
      all = r.invoices;
      const s = r.stats;
      el.innerHTML = `<div class="toolbar">${App.searchBox("blQ", "Search invoice, patient or service", st.q)}
        <select id="blStatus"><option value="all">All statuses</option>${Object.entries(
          STATUS,
        )
          .map(
            ([k, l]) =>
              `<option value="${k}" ${st.status === k ? "selected" : ""}>${l}</option>`,
          )
          .join("")}</select></div>
        <div class="cards">${App.statCards([
          {
            icon: "wallet",
            tone: "blue",
            label: "Total Billed",
            value: peso(s.billed),
          },
          {
            icon: "alert",
            tone: "orange",
            label: "Outstanding Balance",
            value: peso(s.outstanding),
          },
          {
            icon: "check",
            tone: "green",
            label: "Paid Amount",
            value: peso(s.paid),
          },
          {
            icon: "file",
            tone: "violet",
            label: "Total Invoices",
            value: App.num(s.invoices),
          },
        ])}</div>
        <div class="panel"><div id="blTable"></div>
          <p class="slot-hint" style="margin-top:12px">An invoice appears once a visit is approved. Open it to set the fee and record payments. Patients see their remaining balance on their dashboard. Due date = invoice date + 7 days.</p></div>`;
      $("#blQ").addEventListener(
        "input",
        App.debounce((e) => ((st.q = e.target.value.trim()), drawTable()), 150),
      );
      $("#blStatus").addEventListener(
        "change",
        (e) => ((st.status = e.target.value), drawTable()),
      );
      $("#blTable").addEventListener("click", (e) => {
        const b = e.target.closest("[data-bill]");
        if (b) App.billing(+b.dataset.bill);
      });
      drawTable();
    },
  };

  const methodOpts = Object.entries(METHOD_LABEL)
    .map(([k, l]) => `<option value="${k}">${l}</option>`)
    .join("");

  function render(state) {
    const a = state.appointment;
    const pays = state.payments.map(
      (
        p,
      ) => `<tr><td>${esc(fmtDateTime(p.paidAt))}</td><td>${esc(METHOD_LABEL[p.method] || p.method)}${p.provider ? '<span class="badge badge-online">Online</span>' : ""}${p.reference ? `<small>Ref: ${esc(p.reference)}</small>` : ""}${p.note ? `<small>${esc(p.note)}</small>` : ""}</td>
        <td><strong>${esc(peso(p.amount))}</strong></td><td>${esc(p.recordedBy || (p.provider ? "Paid online" : "—"))}</td>${App.isAdmin() ? `<td>${App.iconBtn("trash", "ib-del", `data-delpay="${p.id}"`, "Remove payment")}</td>` : ""}</tr>`,
    );
    const feeBlock = a.billable
      ? `<div class="f-row"><label for="bFee">Fee for this visit (₱)</label>
          <div style="display:flex;gap:8px"><input type="number" id="bFee" min="0" step="0.01" value="${a.fee > 0 ? a.fee : ""}" placeholder="0.00" /><button type="button" class="btn btn-ghost" id="bSaveFee">Save fee</button></div></div>`
      : `<div class="pay-note-admin">This visit is <b>${esc(a.status)}</b>. If the patient already paid something, refund it first (in cash, or from your PayMongo dashboard for online payments), then remove the payment below.</div>`;
    const payForm = a.billable
      ? `<h4 class="dlg-h4">Record a payment</h4>
        <div class="fgrid">
          <div class="f-row"><label for="bAmt">Amount (₱)</label><input type="number" id="bAmt" min="0" step="0.01" value="${a.balance > 0 ? a.balance : ""}" ${a.fee > 0 ? "" : "disabled"} /></div>
          <div class="f-row"><label for="bMethod">Method</label><select id="bMethod" ${a.fee > 0 ? "" : "disabled"}>${methodOpts}</select></div>
          <div class="f-row"><label for="bRef">Reference no. (optional)</label><input type="text" id="bRef" maxlength="100" ${a.fee > 0 ? "" : "disabled"} /></div>
          <div class="f-row"><label for="bNote">Note (optional)</label><input type="text" id="bNote" maxlength="255" ${a.fee > 0 ? "" : "disabled"} /></div>
        </div>
        <button type="button" class="btn btn-ok" id="bAddPay" ${a.fee > 0 && a.balance > 0 ? "" : "disabled"}>Add payment</button>
        ${a.fee > 0 ? "" : '<p class="slot-hint" style="margin-top:8px">Set the fee first, then record payments.</p>'}`
      : "";
    App.dialog({
      title: `Invoice ${App.code("INV", a.id)}`,
      sub: `${a.patientName} · ${a.service} · ${fmtDate(a.date)}`,
      wide: true,
      html: `<div class="chips"><div class="chip"><span>Fee</span><strong>${esc(peso(a.fee))}</strong></div><div class="chip"><span>Paid</span><strong>${esc(peso(a.paid))}</strong></div>
          <div class="chip"><span>Balance</span><strong class="${a.balance > 0 ? "down" : "up"}">${esc(peso(a.balance))}</strong></div></div>
        ${feeBlock}
        <h4 class="dlg-h4">Payments</h4>${App.table(["Date", "Method", "Amount", "Recorded by", ...(App.isAdmin() ? [""] : [])], pays, "No payments recorded yet.")}
        ${payForm}`,
      buttons: [{ label: "Close", cls: "btn-primary", onClick: App.close }],
      onOpen: () => bind(a),
    });
    App._afterClose = () => changed && App.refresh();
  }

  async function post(body) {
    try {
      const state = await api("admin.php?r=billing", { method: "POST", body });
      changed = true;
      App.toast("Saved.");
      render(state);
    } catch (e) {
      if (e.status === 401) return App.fail(e);
      $("#dlgErr").textContent = e.message;
    }
  }

  function bind(a) {
    $("#dlgErr").textContent = "";
    if (a.billable) {
      $("#bSaveFee").addEventListener("click", () =>
        post({ action: "set_fee", appointmentId: a.id, fee: $("#bFee").value }),
      );
      $("#bFee").addEventListener(
        "keydown",
        (e) =>
          e.key === "Enter" && (e.preventDefault(), $("#bSaveFee").click()),
      );
      $("#bAddPay").addEventListener("click", () =>
        post({
          action: "add_payment",
          appointmentId: a.id,
          amount: $("#bAmt").value,
          method: $("#bMethod").value,
          reference: $("#bRef").value,
          note: $("#bNote").value,
        }),
      );
    }
    $$("[data-delpay]").forEach((b) =>
      b.addEventListener("click", async () => {
        const yes = await App.confirm({
          title: "Remove this payment?",
          text: "Use this only to correct a mistake. The patient's balance goes back up.",
          confirmText: "Remove",
        });
        if (yes)
          post({ action: "delete_payment", paymentId: +b.dataset.delpay });
        else open(a.id);
      }),
    );
  }

  async function open(id) {
    try {
      render(await api("admin.php?r=billing&appointment_id=" + id));
    } catch (e) {
      App.fail(e);
    }
  }
  App.billing = (id) => {
    changed = false;
    return open(id);
  };
})();

/* ===== Messages ===== */
/* Messages: contact-form messages and password-reset requests. */
(() => {
  const st = { filter: "all", q: "" };
  const byId = new Map();
  const TABS = [
    ["all", "All"],
    ["unread", "Unread"],
    ["contact", "Contact form"],
    ["password_reset", "Password resets"],
  ];

  function row(m) {
    byId.set(m.id, m);
    const preview =
      m.message.length > 90 ? m.message.slice(0, 90) + "…" : m.message;
    return `<tr class="clickable ${m.isRead ? "" : "unread"}" data-open="${m.id}">
      <td><span class="dot ${m.isRead ? "" : "on"}" title="${m.isRead ? "Read" : "Unread"}"></span></td>
      <td><strong>${esc(m.name)}</strong><small>${esc(m.email)}${m.phone ? " · " + esc(m.phone) : ""}</small></td>
      <td>${m.kind === "password_reset" ? '<span class="badge badge-pending">Password reset</span>' : esc(m.subject || "—")}</td>
      <td class="muted">${esc(preview)}</td>
      <td>${esc(fmtDateTime(m.createdAt))}</td>
      <td><div class="tbl-actions">${App.iconBtn("eye", "ib-view", `data-open="${m.id}"`, "Read message")}${App.iconBtn("check", "ib-ok", `data-toggle="${m.id}"`, m.isRead ? "Mark as unread" : "Mark as read")}${App.isAdmin() ? App.iconBtn("trash", "ib-del", `data-del="${m.id}"`, "Delete message") : ""}</div></td></tr>`;
  }

  async function load() {
    const r = await api(
      `admin.php?r=messages&filter=${st.filter}&q=${encodeURIComponent(st.q)}`,
    );
    byId.clear();
    $("#msTable").innerHTML = App.table(
      ["", "From", "Subject", "Message", "Received", "Action"],
      r.messages.map(row),
      "No messages here.",
    );
    $$("#msTabs .tab").forEach((t) => {
      const n = {
        all: r.counts.total,
        unread: r.counts.unread,
        contact: r.counts.contact,
        password_reset: r.counts.resets,
      }[t.dataset.f];
      t.querySelector("small").textContent = n;
    });
    App.refreshBell();
  }

  async function setRead(id, read) {
    await api("admin.php?r=messages", {
      method: "POST",
      body: { action: "mark_read", id, read },
    });
  }

  function open(m) {
    if (!m) return;
    const mailto = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent("Re: " + (m.subject || "Your message to J. Calumpit Dental Clinic"))}`;
    const buttons = [
      { label: "Close", cls: "btn-primary", onClick: App.close },
    ];
    if (m.kind === "password_reset" && m.accountRole === "patient") {
      buttons.unshift({
        label: "Reset password…",
        onClick: async () => {
          if (
            !(await App.confirm({
              title: `Reset ${m.name}'s password?`,
              text: "Make sure you've verified who is asking (for example by phone). A new temporary password will replace the old one.",
              confirmText: "Reset password",
            }))
          )
            return;
          try {
            const x = await api("admin.php?r=patients", {
              method: "POST",
              body: { action: "reset_password", id: m.accountId },
            });
            App.secret({
              title: "Password reset",
              sub: m.name,
              username: x.username,
              password: x.tempPassword,
            });
          } catch (e) {
            App.fail(e);
          }
        },
      });
    }
    App.dialog({
      title:
        m.kind === "password_reset"
          ? "Password reset request"
          : m.subject || "Message",
      sub: `${m.name} · ${fmtDateTime(m.createdAt)}`,
      wide: true,
      html: `<dl class="kv"><dt>Name</dt><dd>${esc(m.name)}</dd><dt>Email</dt><dd><a href="${mailto}">${esc(m.email)}</a></dd>
          ${m.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(m.phone)}">${esc(m.phone)}</a></dd>` : ""}
          ${m.kind === "password_reset" ? `<dt>Account</dt><dd>${m.accountId ? esc(ROLE_LABEL[m.accountRole] || m.accountRole) + " account found" : "No account with this email"}</dd>` : ""}</dl>
        <div class="note-box">${esc(m.message)}</div>
        <p style="margin-top:14px"><a class="btn btn-ghost" href="${mailto}">Reply by email</a> ${m.phone ? `<a class="btn btn-ghost" href="tel:${esc(m.phone)}">Call</a>` : ""}</p>`,
      buttons,
    });
    if (!m.isRead) {
      m.isRead = true;
      setRead(m.id, true).then(
        () => App.refreshBell(),
        () => {},
      );
      App._afterClose = () =>
        App.current === "messages" && load().catch(() => {});
    }
  }

  App.views.messages = {
    async show(el) {
      if (App.nextOpts.tab) st.filter = App.nextOpts.tab;
      el.innerHTML = `<div class="tabs" id="msTabs">${TABS.map(([k, l]) => `<button class="tab ${st.filter === k ? "active" : ""}" data-f="${k}">${l}<small>0</small></button>`).join("")}</div>
        <div class="toolbar">${App.searchBox("msQ", "Search name, email, subject or message", st.q)}
          <button class="btn btn-ghost" id="msAll" type="button">${icon("check", 16)} Mark all as read</button></div>
        <div class="panel" id="msTable"></div>`;
      $("#msTabs").addEventListener("click", (e) => {
        const t = e.target.closest(".tab");
        if (!t) return;
        st.filter = t.dataset.f;
        $$("#msTabs .tab").forEach((x) =>
          x.classList.toggle("active", x === t),
        );
        load().catch(App.fail);
      });
      $("#msQ").addEventListener(
        "input",
        App.debounce(
          (e) => ((st.q = e.target.value.trim()), load().catch(App.fail)),
        ),
      );
      $("#msAll").addEventListener("click", async () => {
        try {
          await api("admin.php?r=messages", {
            method: "POST",
            body: { action: "mark_all_read" },
          });
          App.toast("All messages marked as read.");
          load();
        } catch (e) {
          App.fail(e);
        }
      });
      $("#msTable").addEventListener("click", async (e) => {
        const t = e.target.closest("[data-toggle]"),
          d = e.target.closest("[data-del]"),
          o = e.target.closest("[data-open]");
        try {
          if (t) {
            const m = byId.get(+t.dataset.toggle);
            await setRead(m.id, !m.isRead);
            return load();
          }
          if (d) {
            if (
              await App.confirm({
                title: "Delete this message?",
                text: "This can't be undone.",
                confirmText: "Delete",
              })
            ) {
              await api("admin.php?r=messages", {
                method: "POST",
                body: { action: "delete", id: +d.dataset.del },
              });
              App.toast("Message deleted.");
              load();
            }
            return;
          }
          if (o) open(byId.get(+o.dataset.open));
        } catch (err) {
          App.fail(err);
        }
      });
      await load();
    },
  };
})();

/* ===== Reports ===== */
/* Reports: key numbers vs the previous period, appointment / revenue charts, top services, CSV export. */
(() => {
  const PERIODS = [
    ["this_month", "This Month", "last month"],
    ["last_month", "Last Month", "the month before"],
    ["last_30", "Last 30 Days", "the previous 30 days"],
    ["this_year", "This Year", "last year"],
  ];
  let period = "this_month";
  let data = null;

  const delta = (c, vs) =>
    c == null
      ? `<span class="muted">No data for ${esc(vs)}</span>`
      : `<span class="${c >= 0 ? "up" : "down"}">${c >= 0 ? "↑" : "↓"} ${Math.abs(c)}%</span> <span class="muted">from ${esc(vs)}</span>`;

  function draw() {
    const [, label, vs] = PERIODS.find((p) => p[0] === period);
    const m = data.metrics,
      c = data.change;
    const card = (title, value, key) =>
      `<div class="sc" style="display:block"><div class="lbl">${title}</div><div class="val">${value}</div><div class="sub">${delta(c[key], vs)}</div></div>`;
    const donut = Charts.donut(data.services, {
      center: App.num(data.services.reduce((a, b) => a + b.value, 0)),
    });
    $("#rpBody").innerHTML = `
      <div class="cards">${card("Total Appointments", App.num(m.appointments), "appointments")}${card("New Patients", App.num(m.newPatients), "newPatients")}
        ${card("Total Revenue (payments received)", peso(m.revenue), "revenue")}${card("Treatments Completed", App.num(m.treatments), "treatments")}</div>
      <div class="grid-3">
        <div class="panel"><div class="panel-h"><h3>Appointments Overview</h3></div><div class="chart">${Charts.line(data.appointmentsSeries, { w: 340 })}</div></div>
        <div class="panel"><div class="panel-h"><h3>Revenue Overview</h3></div><div class="chart">${Charts.bars(data.revenueSeries, { money: true, w: 340 })}</div></div>
        <div class="panel"><div class="panel-h"><h3>Top Services</h3></div>${data.services.length ? `<div class="donut-wrap">${donut.svg}${donut.legend}</div>` : '<div class="empty">No appointments in this period.</div>'}</div>
      </div>
      <p class="slot-hint" style="margin-top:12px">Showing ${esc(label)} (${esc(fmtDate(data.from))} – ${esc(fmtDate(data.to))}). Revenue counts payments recorded in Billing.</p>`;
  }

  async function load() {
    $("#rpBody").innerHTML = '<div class="loading">Loading…</div>';
    data = await api("admin.php?r=reports&period=" + period);
    draw();
  }

  function exportCsv() {
    if (!data) return;
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const m = data.metrics;
    const lines = [
      ["J. Calumpit Dental Clinic report"],
      ["Period", data.period, data.from, data.to],
      [],
      ["Metric", "Value"],
      ["Total appointments", m.appointments],
      ["New patients", m.newPatients],
      ["Revenue (PHP)", m.revenue],
      ["Treatments completed", m.treatments],
      [],
      ["Top services", "Appointments"],
      ...data.services.map((s) => [s.label, s.value]),
      [],
      ["Appointments by day/month", "Count"],
      ...data.appointmentsSeries.map((p) => [p.label, p.value]),
      [],
      ["Revenue by week/month", "PHP"],
      ...data.revenueSeries.map((p) => [p.label, p.value]),
    ];
    const csv = "\ufeff" + lines.map((l) => l.map(q).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    a.download = `report-${data.period}-${data.from}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  App.views.reports = {
    async show(el) {
      el.innerHTML = `<div class="toolbar"><span class="grow"></span>
        <select id="rpPeriod">${PERIODS.map(([k, l]) => `<option value="${k}" ${k === period ? "selected" : ""}>${l}</option>`).join("")}</select>
        <button class="btn btn-ghost" id="rpExport" type="button">${icon("download", 16)} Export Report</button></div><div id="rpBody"></div>`;
      $("#rpPeriod").addEventListener(
        "change",
        (e) => ((period = e.target.value), load().catch(App.fail)),
      );
      $("#rpExport").addEventListener("click", exportCsv);
      await load();
    },
  };
})();

/* ===== Users + Settings ===== */
/* Users (administrators only) and Settings (everyone). */
(() => {
  const byId = new Map();
  let meId = 0;

  function row(u) {
    byId.set(u.id, u);
    const self = u.id === meId;
    return `<tr><td>${App.code("USR", u.id)}</td><td><strong>${esc(u.fullName)}</strong><small>@${esc(u.username)}</small></td><td>${esc(ROLE_LABEL[u.role] || u.role)}</td><td>${esc(u.email)}</td>
      <td><button type="button" class="switch ${u.isActive ? "on" : ""}" data-toggle="${u.id}" ${self ? "disabled" : ""} role="switch" aria-checked="${u.isActive}" aria-label="Account active" title="${self ? "You can't deactivate yourself" : u.isActive ? "Active — click to deactivate" : "Inactive — click to activate"}"></button></td>
      <td>${u.lastLogin ? esc(fmtDateTime(u.lastLogin)) : '<span class="muted">Never</span>'}</td>
      <td><div class="tbl-actions">${App.iconBtn("edit", "ib-edit", `data-edit="${u.id}"`, "Edit user")}${App.iconBtn("key", "ib-view", `data-key="${u.id}"`, "Reset password")}${self ? "" : App.iconBtn("trash", "ib-del", `data-del="${u.id}"`, "Delete user")}</div></td></tr>`;
  }

  const roleOpts = [
    ["staff", "Staff"],
    ["dentist", "Dentist"],
    ["admin", "Administrator"],
  ];
  const userFields = (creating) => [
    { name: "firstName", label: "First name", required: true },
    { name: "lastName", label: "Last name", required: true },
    {
      name: "email",
      label: "Email",
      type: "email",
      required: true,
      full: true,
    },
    {
      name: "phone",
      label: "Phone number",
      type: "tel",
      required: true,
      placeholder: "09XX XXX XXXX",
    },
    {
      name: "role",
      label: "Role",
      type: "select",
      required: true,
      options: roleOpts,
    },
    ...(creating
      ? [
          { name: "username", label: "Username", required: true },
          {
            name: "password",
            label: "Password (optional)",
            type: "password",
            hint: "Leave blank to generate a temporary password.",
          },
        ]
      : []),
  ];

  async function load() {
    const r = await api("admin.php?r=users");
    meId = r.meId;
    const c = r.counts;
    $("#usCards").innerHTML = App.statCards([
      {
        icon: "users",
        tone: "blue",
        label: "Total Users",
        value: App.num(c.total),
      },
      {
        icon: "shield",
        tone: "green",
        label: "Administrators",
        value: App.num(c.admin),
      },
      {
        icon: "tooth",
        tone: "violet",
        label: "Dentists",
        value: App.num(c.dentist),
      },
      { icon: "user", tone: "blue", label: "Staff", value: App.num(c.staff) },
    ]);
    byId.clear();
    $("#usTable").innerHTML = App.table(
      ["User ID", "Name", "Role", "Email", "Status", "Last Login", "Action"],
      r.users.map(row),
      "No users.",
    );
  }

  App.views.users = {
    async show(el) {
      el.innerHTML = `<div class="toolbar"><span class="grow"></span><button class="btn btn-primary" id="usNew" type="button">${icon("plus", 16)} Add New User</button></div>
        <div class="cards" id="usCards"></div><div class="panel" id="usTable"></div>
        <p class="slot-hint" style="margin-top:10px">Patients are managed under Patients. Deactivated users can't sign in.</p>`;
      $("#usNew").addEventListener("click", () =>
        App.form({
          title: "Add new user",
          sub: "Staff, dentist or administrator account for the admin panel.",
          fields: userFields(true),
          values: { role: "staff" },
          submit: "Create user",
          async onSubmit(v) {
            const r = await api("admin.php?r=users", {
              method: "POST",
              body: { action: "create", ...v },
            });
            App.refresh();
            if (r.tempPassword)
              App.secret({
                title: "User created",
                sub: `${v.firstName} ${v.lastName}`,
                username: r.username,
                password: r.tempPassword,
              });
            else App.toast("User created.");
            return r.tempPassword ? "keep" : undefined;
          },
        }),
      );
      $("#usTable").addEventListener("click", async (e) => {
        const t = e.target.closest("[data-toggle]"),
          ed = e.target.closest("[data-edit]"),
          k = e.target.closest("[data-key]"),
          d = e.target.closest("[data-del]");
        try {
          if (t) {
            const u = byId.get(+t.dataset.toggle);
            await api("admin.php?r=users", {
              method: "POST",
              body: { action: "set_active", id: u.id, active: !u.isActive },
            });
            App.toast(u.isActive ? "User deactivated." : "User activated.");
            await load();
          } else if (ed) {
            const u = byId.get(+ed.dataset.edit);
            App.form({
              title: "Edit user",
              sub: `${App.code("USR", u.id)} · @${u.username}`,
              fields: userFields(false),
              values: u,
              async onSubmit(v) {
                await api("admin.php?r=users", {
                  method: "POST",
                  body: { action: "update", id: u.id, ...v },
                });
                App.toast("User updated.");
                App.refresh();
              },
            });
          } else if (k) {
            const u = byId.get(+k.dataset.key);
            if (
              await App.confirm({
                title: `Reset ${u.fullName}'s password?`,
                text: "A new temporary password will replace the old one.",
                confirmText: "Reset password",
              })
            ) {
              const r = await api("admin.php?r=users", {
                method: "POST",
                body: { action: "reset_password", id: u.id },
              });
              App.secret({
                title: "Password reset",
                sub: u.fullName,
                username: r.username,
                password: r.tempPassword,
              });
            }
          } else if (d) {
            const u = byId.get(+d.dataset.del);
            if (
              await App.confirm({
                title: `Delete ${u.fullName}?`,
                text: "Their account is removed. Appointments they handled are kept.",
                confirmText: "Delete user",
              })
            ) {
              await api("admin.php?r=users", {
                method: "POST",
                body: { action: "delete", id: u.id },
              });
              App.toast("User deleted.");
              await load();
            }
          }
        } catch (err) {
          App.fail(err);
        }
      });
      await load();
    },
  };

  /* ---------- Settings ---------- */
  App.views.settings = {
    async show(el) {
      const u = App.me;
      el.innerHTML = `<div class="grid-2b">
        <div class="panel"><div class="panel-h"><h3>My account</h3></div>
          <dl class="kv"><dt>Name</dt><dd>${esc(u.fullName)}</dd><dt>Username</dt><dd>@${esc(u.username)}</dd><dt>Role</dt><dd>${esc(ROLE_LABEL[u.role] || u.role)}</dd>
            <dt>Email</dt><dd>${esc(u.email)}</dd><dt>Phone</dt><dd>${esc(u.phone)}</dd></dl></div>
        <div class="panel"><div class="panel-h"><h3>Change password</h3></div>
          <form id="pwForm" novalidate>
            <div class="f-row"><label for="pwCur">Current password</label><input type="password" id="pwCur" autocomplete="current-password" /></div>
            <div class="f-row"><label for="pwNew">New password</label><input type="password" id="pwNew" autocomplete="new-password" /><span class="slot-hint">At least 8 characters, with a number and a lowercase letter.</span></div>
            <div class="f-row"><label for="pwNew2">Confirm new password</label><input type="password" id="pwNew2" autocomplete="new-password" /></div>
            <p class="modal-err" id="pwErr"></p>
            <button class="btn btn-primary" id="pwBtn" type="submit">Update password</button>
          </form></div></div>`;
      $("#pwForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = $("#pwErr"),
          btn = $("#pwBtn");
        err.textContent = "";
        btn.disabled = true;
        try {
          await api("auth.php?action=password", {
            method: "POST",
            body: {
              current: $("#pwCur").value,
              password: $("#pwNew").value,
              confirmPassword: $("#pwNew2").value,
            },
          });
          ["#pwCur", "#pwNew", "#pwNew2"].forEach((s) => ($(s).value = ""));
          App.toast("Password updated.");
        } catch (ex) {
          err.textContent = ex.message;
        }
        btn.disabled = false;
      });
    },
  };
})();

/* ===== Start-up ===== */
/* Boot: check the session, build the sidebar/top bar, open the first page. */
(async function boot() {
  try {
    App.me = (await api("auth.php?action=session")).user;
  } catch (_) {}
  if (!App.me) return location.replace("../login.html?next=admin/index.html");
  if (!isStaffRole(App.me.role)) return location.replace("../dashboard.html");

  $("#menuBtn").innerHTML = icon("menu", 22);
  $("#bellBtn").innerHTML = icon("bell", 20);
  $("#logoutBtn").innerHTML = icon("logout", 20) + "<span>Logout</span>";
  $("#avatar").textContent = App.initials(App.me.fullName);
  $("#whoName").textContent = App.me.fullName;
  $("#whoRole").textContent = ROLE_LABEL[App.me.role] || App.me.role;

  $("#sbNav").innerHTML = App.NAV.filter((n) => !n.admin || App.isAdmin())
    .map(
      (n) =>
        `<button class="sb-item" type="button" data-view="${n.id}">${icon(n.icon, 20)}<span>${n.label}</span>${n.id === "appointments" ? '<span class="pill hidden" id="pendingPill">0</span>' : ""}${n.id === "messages" ? '<span class="pill hidden" id="msgPill">0</span>' : ""}</button>`,
    )
    .join("");
  $("#sbNav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) App.go(b.dataset.view);
  });

  const logout = async () => {
    try {
      await api("auth.php?action=logout", { method: "POST" });
    } catch (_) {}
    location.href = "../login.html";
  };
  $("#logoutBtn").addEventListener("click", logout);
  $("#logout2").addEventListener("click", logout);

  $("#menuBtn").addEventListener("click", () => {
    const app = $("#app");
    if (window.matchMedia("(max-width: 900px)").matches)
      app.classList.toggle("sb-open");
    else app.classList.toggle("collapsed");
  });
  $("#sbBackdrop").addEventListener("click", () =>
    $("#app").classList.remove("sb-open"),
  );
  $("#userBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#userMenu").classList.toggle("hidden");
  });
  $("#bellBtn").addEventListener("click", () =>
    App.go("appointments", { tab: "pending" }),
  );

  App.refreshBell();
  App.go((location.hash || "#dashboard").slice(1));
  // Back/forward buttons and typed #links
  window.addEventListener("hashchange", () => {
    const v = location.hash.slice(1);
    if (v && v !== App.current) App.go(v);
  });
})();
