/* Shared by every page: API helper + small utilities, navbar sign-in/out, contact form, photo gallery. */
/* Folder that contains assets/ and api/, worked out from where this script was loaded (so it also works from /admin/). */
const SITE_ROOT = (function () {
  const s = document.currentScript;
  return s && s.src
    ? new URL("../", s.src).href
    : new URL(".", location.href).href;
})();

/* Shared helpers for every page: talk to the PHP API, escape text, format dates. */
class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(path, { method = "GET", body } = {}) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (method !== "GET") {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body === undefined ? {} : body);
  }
  let res;
  try {
    res = await fetch(SITE_ROOT + "api/" + path, opts);
  } catch (_) {
    throw new ApiError(
      "Can't reach the server. Make sure Apache is running in XAMPP and you opened the site at http://localhost/…",
      0,
    );
  }
  let data;
  try {
    data = await res.json();
  } catch (_) {
    throw new ApiError(
      "The server sent an unexpected reply. Open the site through http://localhost/ (not by double-clicking the file) and check that PHP is running.",
      res.status,
    );
  }
  if (!res.ok || data.ok === false) {
    throw new ApiError(data.error || "Request failed.", res.status, data.code);
  }
  return data;
}

/* Only allow redirects to a plain page in this folder (no open redirects). */
function safeNext(value) {
  return value && /^(admin\/index|[a-z0-9_-]+)\.html$/i.test(value)
    ? value
    : null;
}

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

/* Local-time YYYY-MM-DD (toISOString would shift the day in Manila time). */
function isoDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtDate(iso, long) {
  if (!iso) return "";
  return new Date(iso + "T00:00").toLocaleDateString("en-PH", {
    weekday: long ? "long" : "short",
    month: long ? "long" : "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_LABEL = {
  pending: "Pending",
  approved: "Approved",
  rescheduled: "Rescheduled",
  declined: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
};

function statusBadge(status) {
  return `<span class="badge badge-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function peso(n) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(n) || 0);
}

/* "2026-10-15 14:30:00" (server time) -> "Oct 15, 2026, 2:30 PM" */
function fmtDateTime(s) {
  if (!s) return "";
  return new Date(s.replace(" ", "T")).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const METHOD_LABEL = {
  cash: "Cash",
  gcash: "GCash",
  maya: "Maya",
  card: "Card",
  bank_transfer: "Bank transfer",
  other: "Other",
};

/* Staff-side roles (everything except a normal patient account). */
function isStaffRole(role) {
  return role === "admin" || role === "staff" || role === "dentist";
}

/* ===== Navbar: Sign In / Log Out ===== */
/* Landing page: swap "Sign In" for "Log Out" when a session exists,
   and send signed-out visitors to the login page when they try to book. */
(async function () {
  const authLink = document.getElementById("authLink");
  const authLabel = document.getElementById("authLabel");
  const bookLinks = document.querySelectorAll('a[href="appointment.html"]');
  if (!authLink) return;

  authLink.style.visibility = "hidden"; // avoid a "Sign In" flash for signed-in users
  let user = null;
  try {
    user = (await api("auth.php?action=session")).user;
  } catch (_) {
    /* server unreachable: behave as signed out */
  }
  authLink.style.visibility = "";

  if (!user) {
    bookLinks.forEach((a) => {
      a.href = "login.html?next=appointment.html&notice=book";
    });
    return;
  }

  const staff = isStaffRole(user.role);

  authLabel.textContent = "Log Out";
  authLink.href = "#";
  authLink.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await api("auth.php?action=logout", { method: "POST" });
    } catch (_) {}
    if (/(^\/$|index\.html$)/.test(location.pathname)) location.reload();
    else location.href = "index.html";
  });

  const portal = document.createElement("a");
  portal.href = staff ? "admin/index.html" : "dashboard.html";
  portal.textContent = staff ? "Admin Panel" : "My Appointments";
  authLink.parentNode.insertBefore(portal, authLink);

  if (staff) bookLinks.forEach((a) => (a.href = "admin/index.html"));
})();

/* ===== Landing page contact form ===== */
/* Landing page contact form -> saved in the database; the admin reads it under Messages. */
(function () {
  const form = document.getElementById("contactForm");
  if (!form) return;
  const status = document.getElementById("contactStatus");
  const btn = document.getElementById("contactBtn");
  const f = {
    name: document.getElementById("full-name"),
    phone: document.getElementById("phone-number"),
    email: document.getElementById("email-address"),
    subject: document.getElementById("subject"),
    message: document.getElementById("message"),
  };

  const say = (text, kind) => {
    status.textContent = text;
    status.className = "form-status " + (kind || "");
  };
  const bad = (el, text) => {
    Object.values(f).forEach((x) => x.classList.remove("invalid"));
    el.classList.add("invalid");
    el.focus();
    say(text, "error");
    return false;
  };
  Object.values(f).forEach((el) =>
    el.addEventListener("input", () => el.classList.remove("invalid")),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = {
      name: f.name.value.trim(),
      phone: f.phone.value.trim(),
      email: f.email.value.trim(),
      subject: f.subject.value,
      message: f.message.value.trim(),
      website: document.getElementById("website").value,
    };
    if (v.name.length < 2) return bad(f.name, "Please enter your full name.");
    if (!/^\+?[0-9]{7,15}$/.test(v.phone.replace(/[\s\-().]/g, "")))
      return bad(f.phone, "Please enter a valid phone number.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))
      return bad(f.email, "Please enter a valid email address.");
    if (!v.subject)
      return bad(f.subject, "Please choose what your message is about.");
    if (v.message.length < 5) return bad(f.message, "Please write a message.");
    if (v.message.length > 2000)
      return bad(f.message, "Your message is too long (2000 characters max).");

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Sending…";
    say("", "");
    try {
      await api("contact.php", { method: "POST", body: v });
      form.reset();
      say(
        "Thank you! Your message has been sent. The clinic will get back to you soon.",
        "ok",
      );
    } catch (err) {
      say(err.message, "error");
    }
    btn.disabled = false;
    btn.textContent = label;
  });
})();

/* ===== Photo gallery (grid + lightbox) ===== */
/* Gallery grid + lightbox. Handles any number of photos (built for ~50). */
const Gallery = (() => {
  let images = [];
  let shown = 0;
  let lb,
    lbImg,
    lbCap,
    lbCount,
    current = 0,
    lastFocus = null;

  function itemHtml(img, i) {
    const cap = img.caption
      ? `<span class="cap">${esc(img.caption)}</span>`
      : "";
    return `<button type="button" class="gal-item" data-i="${i}" aria-label="${esc(img.caption || "Open photo " + (i + 1))}">
      <img src="${esc(img.thumb)}" alt="${esc(img.caption || "Clinic photo " + (i + 1))}" loading="lazy" decoding="async" />${cap}</button>`;
  }

  function buildLightbox() {
    if (lb) return;
    lb = document.createElement("div");
    lb.className = "gal-lb";
    lb.hidden = true;
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.setAttribute("aria-label", "Photo viewer");
    lb.innerHTML = `<span class="lb-count"></span><button class="lb-close" aria-label="Close">×</button>
      <button class="lb-prev" aria-label="Previous photo">‹</button><img alt="" /><button class="lb-next" aria-label="Next photo">›</button><div class="lb-cap"></div>`;
    document.body.appendChild(lb);
    lbImg = lb.querySelector("img");
    lbCap = lb.querySelector(".lb-cap");
    lbCount = lb.querySelector(".lb-count");
    lb.querySelector(".lb-close").addEventListener("click", close);
    lb.querySelector(".lb-prev").addEventListener("click", () => go(-1));
    lb.querySelector(".lb-next").addEventListener("click", () => go(1));
    lb.addEventListener("click", (e) => e.target === lb && close());
    document.addEventListener("keydown", (e) => {
      if (lb.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    });
    let x0 = null;
    lb.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), {
      passive: true,
    });
    lb.addEventListener("touchend", (e) => {
      if (x0 !== null && Math.abs(e.changedTouches[0].clientX - x0) > 50)
        go(e.changedTouches[0].clientX < x0 ? 1 : -1);
      x0 = null;
    });
  }

  function show(i) {
    current = (i + images.length) % images.length;
    const img = images[current];
    lbImg.src = img.src;
    lbImg.alt = img.caption || "Clinic photo " + (current + 1);
    lbCap.textContent = img.caption || "";
    lbCount.textContent = `${current + 1} / ${images.length}`;
    // warm the cache for the neighbours
    [1, -1].forEach(
      (d) =>
        (new Image().src =
          images[(current + d + images.length) % images.length].src),
    );
  }
  function open(i) {
    buildLightbox();
    lastFocus = document.activeElement;
    lb.hidden = false;
    document.body.style.overflow = "hidden";
    show(i);
    lb.querySelector(".lb-close").focus();
  }
  function close() {
    lb.hidden = true;
    lbImg.removeAttribute("src");
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  }
  function go(d) {
    show(current + d);
  }

  /* opts: { grid, section?, moreBtn?, first, step } */
  async function init(opts) {
    const grid = document.querySelector(opts.grid);
    const section = opts.section && document.querySelector(opts.section);
    const moreBtn = opts.moreBtn && document.querySelector(opts.moreBtn);
    if (!grid) return;
    let r;
    try {
      r = await api("gallery.php?limit=200");
    } catch (_) {
      if (!section)
        grid.innerHTML =
          '<div class="gal-empty">The gallery could not be loaded right now.</div>';
      return;
    }
    images = r.images;
    if (!images.length) {
      if (section) section.hidden = true;
      else
        grid.innerHTML =
          '<div class="gal-empty">Photos are coming soon. Please check back later.</div>';
      return;
    }
    if (section) section.hidden = false;

    const first = opts.first || images.length;
    const step = opts.step || first;
    const draw = (n) => {
      const upto = Math.min(images.length, n);
      grid.insertAdjacentHTML(
        "beforeend",
        images
          .slice(shown, upto)
          .map((im, k) => itemHtml(im, shown + k))
          .join(""),
      );
      shown = upto;
      if (moreBtn) moreBtn.hidden = shown >= images.length;
      if (moreBtn)
        moreBtn.textContent = `Show more (${images.length - shown} left)`;
    };
    grid.innerHTML = "";
    shown = 0;
    draw(first);
    if (moreBtn) moreBtn.addEventListener("click", () => draw(shown + step));
    grid.addEventListener("click", (e) => {
      const b = e.target.closest(".gal-item");
      if (b) open(+b.dataset.i);
    });
  }

  return { init };
})();

// Landing page: build the gallery if the section is on the page.
if (document.getElementById("galGrid"))
  Gallery.init({
    grid: "#galGrid",
    section: "#gallery-link",
    moreBtn: "#galMore",
    first: 8,
    step: 8,
  });
