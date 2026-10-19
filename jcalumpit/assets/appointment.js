/* Book Appointment page */
(async function () {
  const $ = (s) => document.querySelector(s);
  const form = $("#form"),
    dateEl = $("#date"),
    slotsEl = $("#slots"),
    formErr = $("#formErr"),
    btn = $("#submit");
  const HINT = (t) =>
    `<span class="hint" style="grid-column:1/-1">${esc(t)}</span>`;

  // Booking needs an account: send signed-out visitors to the login page.
  let user = null;
  try {
    user = (await api("auth.php?action=session")).user;
  } catch (_) {}
  if (!user) {
    location.replace("login.html?next=appointment.html&notice=book");
    return;
  }
  if (user.role !== "patient") {
    location.replace("admin/index.html");
    return;
  }

  // Pre-fill from the account (still editable, e.g. booking for a family member)
  $("#patient").value = user.fullName;
  $("#phone").value = user.phone;
  $("#email").value = user.email;

  // Earliest date = tomorrow, latest = 90 days ahead
  const minD = new Date(),
    maxD = new Date();
  minD.setDate(minD.getDate() + 1);
  maxD.setDate(maxD.getDate() + 90);
  dateEl.min = isoDate(minD);
  dateEl.max = isoDate(maxD);

  /* ---------- payment balance (what the patient still owes, with a Pay button when online payment is on) ---------- */
  const qs = new URLSearchParams(location.search);
  const payToken = qs.get("pay");
  const cancelledFlag = qs.get("cancelled") === "1";

  async function loadBalance() {
    const [ap, bi] = await Promise.allSettled([
      api("appointments.php"),
      api("payments.php?action=billing"),
    ]);
    const card = $("#balCard");
    if (bi.status !== "fulfilled") {
      card.hidden = true;
      return;
    }
    const s = bi.value.summary;
    const enabled =
      ap.status === "fulfilled" && ap.value.payment && ap.value.payment.enabled;
    const owing =
      ap.status === "fulfilled"
        ? ap.value.appointments.filter(
            (x) => x.billable && x.fee > 0 && x.balance > 0,
          )
        : [];
    card.hidden = false;
    card.innerHTML = `
            <div class="bal-top"><h3>Your payment balance</h3><div class="bal-amt ${s.due > 0 ? "" : "clear"}">${esc(peso(s.due))}</div></div>
            <p class="bal-sub">${s.billed > 0 ? `Billed ${esc(peso(s.billed))} · Paid ${esc(peso(s.paid))}` : "No charges yet. Fees appear here once the clinic approves a visit and sets the price."}</p>
            ${owing.length ? `<div class="bal-rows">${owing.map((x) => `<div class="bal-row"><div>${esc(x.service)}<small>${esc(fmtDate(x.date))} · ${esc(x.timeLabel)} · balance ${esc(peso(x.balance))}</small></div>${x.payDue > 0 ? `<button type="button" class="bal-pay" data-pay="${x.id}">Pay ${esc(peso(x.payDue))}</button>` : ""}</div>`).join("")}</div>` : ""}
            ${s.due > 0 ? (enabled ? '<p class="bal-note">Pay securely online with GCash, Maya or card.</p>' : '<p class="bal-note">Please pay this at the clinic. Your balance updates here once the clinic records your payment.</p>') : ""}`;
  }
  $("#balCard").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-pay]");
    if (!b) return;
    b.disabled = true;
    b.textContent = "Opening checkout…";
    try {
      const p = await api("payments.php?action=start", {
        method: "POST",
        body: { appointmentId: +b.dataset.pay, returnTo: "appointment" },
      });
      location.href = p.checkoutUrl;
    } catch (err) {
      const box = $("#payBanner");
      box.hidden = false;
      box.className = "pay-banner warn";
      box.textContent = err.message;
      loadBalance();
    }
  });

  // Back from the payment page: confirm with the provider and say what happened.
  async function checkPayment() {
    const box = $("#payBanner");
    box.hidden = false;
    box.className = "pay-banner warn";
    box.textContent = "Checking your payment…";
    try {
      const r = await api("payments.php?action=verify", {
        method: "POST",
        body: { token: payToken },
      });
      const p = r.payment;
      if (p.status === "paid") {
        box.className = "pay-banner";
        box.textContent = `Payment received — thank you! We received ${peso(p.amount)}.`;
      } else if (p.status === "cancelled" || cancelledFlag) {
        box.textContent =
          "Payment not completed. No money was charged — you can try again with the Pay button.";
      } else {
        box.innerHTML = `We haven't received your payment yet. ${esc(r.problem || "If you already paid, wait a moment and check again.")} <button id="payRecheck" type="button">Check again</button>`;
        $("#payRecheck").addEventListener("click", async () => {
          await checkPayment();
          await loadBalance();
        });
      }
    } catch (e) {
      box.textContent = "We couldn't check your payment: " + e.message;
    }
    history.replaceState(null, "", "appointment.html");
  }
  (payToken ? checkPayment() : Promise.resolve()).then(loadBalance);

  let renderId = 0;
  async function renderSlots() {
    const v = dateEl.value,
      myId = ++renderId;
    $("#slotErr").classList.remove("show");
    if (!v) {
      slotsEl.innerHTML = HINT("Pick a date to see open times.");
      return;
    }
    slotsEl.innerHTML = HINT("Checking availability…");
    let data;
    try {
      data = await api(
        "appointments.php?action=slots&date=" + encodeURIComponent(v),
      );
    } catch (e) {
      if (myId === renderId) slotsEl.innerHTML = HINT(e.message);
      return;
    }
    if (myId !== renderId) return; // a newer date was picked meanwhile
    if (!data.open) {
      slotsEl.innerHTML = HINT(data.message || "No times available.");
      return;
    }
    slotsEl.innerHTML = data.slots
      .map(
        (s) =>
          `<label class="slot"><input type="radio" name="slot" value="${esc(s.time)}" ${s.taken ? "disabled" : ""}><span>${esc(s.label)}</span></label>`,
      )
      .join("");
    if (data.slots.every((s) => s.taken))
      slotsEl.insertAdjacentHTML(
        "beforeend",
        HINT("Fully booked — please try another date."),
      );
  }
  dateEl.addEventListener("change", () => {
    check(dateEl);
    renderSlots();
  });

  function check(el) {
    let bad = !el.checkValidity();
    if (el.id === "phone")
      bad = !/^(09|\+639)\d{9}$/.test(el.value.replace(/[\s-]/g, ""));
    el.classList.toggle("invalid", bad);
    const err = el.parentElement.querySelector(".err");
    if (err) err.classList.toggle("show", bad);
    return !bad;
  }
  form.querySelectorAll("input[required],select[required]").forEach((el) => {
    el.addEventListener("blur", () => check(el));
    el.addEventListener(
      "input",
      () => el.classList.contains("invalid") && check(el),
    );
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formErr.classList.remove("show");
    let ok = true;
    form.querySelectorAll("input[required],select[required]").forEach((el) => {
      if (!check(el)) ok = false;
    });
    const slot = form.querySelector('input[name="slot"]:checked');
    $("#slotErr").classList.toggle("show", !slot);
    if (!slot) ok = false;
    if (!ok) {
      form
        .querySelector(".invalid,.err.show")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const data = {
      patient: $("#patient").value.trim(),
      phone: $("#phone").value.trim(),
      email: $("#email").value.trim(),
      service: $("#service").value,
      dentist: $("#dentist").value,
      date: dateEl.value,
      slot: slot.value,
      notes: $("#notes").value.trim(),
    };

    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await api("appointments.php", { method: "POST", body: data });
    } catch (err) {
      if (err.status === 401) {
        location.replace("login.html?next=appointment.html&notice=book");
        return;
      }
      formErr.textContent = err.message;
      formErr.classList.add("show");
      formErr.scrollIntoView({ behavior: "smooth", block: "center" });
      if (err.code === "slot_taken") renderSlots();
      btn.disabled = false;
      btn.textContent = "Request appointment";
      return;
    }

    $("#summary").textContent =
      `${data.service} with ${data.dentist} on ${fmtDate(data.date, true)} at ${slot.nextElementSibling.textContent}. ` +
      `The clinic will review your request and approve it or suggest a new time. You can follow its status under "My appointments".`;
    form.style.display = "none";
    $("#done").classList.add("show");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
