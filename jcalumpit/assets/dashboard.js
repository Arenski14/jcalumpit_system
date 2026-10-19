/* My Appointments page (patient dashboard) */
(async function () {
  const $ = (s) => document.querySelector(s);
  const toast = (t, err) => {
    const el = $("#toast");
    el.textContent = t;
    el.className = "toast show" + (err ? " error" : "");
    setTimeout(() => (el.className = "toast"), 3200);
  };

  let user = null;
  try {
    user = (await api("auth.php?action=session")).user;
  } catch (_) {}
  if (!user) return location.replace("login.html?next=dashboard.html");
  if (user.role !== "patient") return location.replace("admin/index.html");
  $("#hello").textContent = `Signed in as ${user.fullName} (${user.username}).`;

  const today = isoDate(new Date());
  let appts = [];
  let payMode = { enabled: false, mode: "off" };

  function card(a) {
    const d = new Date(a.date + "T00:00");
    const month = d.toLocaleDateString("en-PH", { month: "short" });
    const cancellable =
      ["pending", "approved", "rescheduled"].includes(a.status) &&
      a.date >= today;
    let when = "";
    if (a.status === "rescheduled" && a.prevDate) {
      when = `<p>Rescheduled from ${esc(fmtDate(a.prevDate))} at ${esc(a.prevTimeLabel)}.</p>`;
    }
    const msg = a.adminNote
      ? `<p class="note"><strong>Message from the clinic:</strong> ${esc(a.adminNote)}</p>`
      : "";
    const hint =
      a.status === "pending" ? "<p>Waiting for the clinic to confirm.</p>" : "";
    const bill =
      a.billable && a.fee > 0
        ? `<p class="bill">Fee ${esc(peso(a.fee))} · Paid ${esc(peso(a.paid))} · ` +
          (a.balance > 0
            ? `Balance <strong>${esc(peso(a.balance))}</strong>`
            : '<strong class="paid">Paid in full ✓</strong>') +
          "</p>"
        : "";
    const payBtn =
      a.payDue > 0
        ? `<button class="btn btn-primary btn-sm" data-pay="${a.id}">Pay balance ${esc(peso(a.payDue))}</button>`
        : "";
    return `<article class="appt">
            <div class="date-box"><div class="m">${esc(month)}</div><div class="d">${d.getDate()}</div><div class="y">${d.getFullYear()}</div></div>
            <div>
              <h3>${esc(a.service)}</h3>
              <p>${esc(fmtDate(a.date, true))} · ${esc(a.timeLabel)} · ${esc(a.dentist)}</p>
              <p>For ${esc(a.patientName)}</p>
              ${when}${hint}${bill}${msg}
            </div>
            <div class="side">
              ${statusBadge(a.status)}
              ${payBtn}
              ${cancellable ? `<button class="btn btn-danger btn-sm" data-cancel="${a.id}">Cancel</button>` : ""}
            </div>
          </article>`;
  }

  function render() {
    const upcoming = appts.filter(
      (a) =>
        a.date >= today &&
        ["pending", "approved", "rescheduled"].includes(a.status),
    );
    const history = appts.filter((a) => !upcoming.includes(a));
    if (!appts.length) {
      $("#list").innerHTML =
        '<div class="card empty">You have no appointments yet.<br><br><a class="btn btn-primary" href="appointment.html">Book your first visit</a></div>';
      return;
    }
    $("#list").innerHTML =
      (upcoming.length
        ? '<div class="section-title" style="margin-top:0">Upcoming</div>' +
          upcoming
            .slice()
            .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
            .map(card)
            .join("")
        : "") +
      (history.length
        ? '<div class="section-title">Past &amp; closed</div>' +
          history.map(card).join("")
        : "");
  }

  function renderBalance(s) {
    const el = $("#balance");
    const clear = s.billed > 0 && s.due <= 0;
    const msg =
      s.billed <= 0
        ? "No charges yet. Fees appear here once the clinic approves a visit and sets the price."
        : clear
          ? "You're all paid up. Thank you!"
          : "This is what you still need to pay for your approved and completed visits. It updates when the clinic records a payment.";
    el.innerHTML = `
            <div>
              <div class="lbl">Remaining balance</div>
              <div class="amt ${clear ? "clear" : ""}">${esc(peso(s.due))}</div>
              <p class="msg">${esc(msg)}</p>
            </div>
            <div class="chips">
              <div class="chip"><span>Total billed</span><strong>${esc(peso(s.billed))}</strong></div>
              <div class="chip"><span>Total paid</span><strong>${esc(peso(s.paid))}</strong></div>
            </div>`;
  }

  function renderPayments(list) {
    const el = $("#payments");
    if (!list.length) return (el.innerHTML = "");
    el.innerHTML =
      '<div class="section-title">Payment history</div><div class="pay-table"><table><thead><tr><th>Date</th><th>For</th><th>Method</th><th>Amount</th></tr></thead><tbody>' +
      list
        .map(
          (p) => `<tr>
                  <td>${esc(fmtDateTime(p.paidAt))}</td>
                  <td>${esc(p.service)}<small>${esc(fmtDate(p.apptDate))}${["cancelled", "declined"].includes(p.apptStatus) ? " · appointment " + esc(p.apptStatus) : ""}</small></td>
                  <td>${esc(METHOD_LABEL[p.method] || p.method)}${p.reference ? `<small>Ref: ${esc(p.reference)}</small>` : ""}</td>
                  <td><strong>${esc(peso(p.amount))}</strong></td></tr>`,
        )
        .join("") +
      "</tbody></table></div>";
  }

  async function load() {
    const [a, b] = await Promise.allSettled([
      api("appointments.php"),
      api("payments.php?action=billing"),
    ]);
    if (a.status === "fulfilled") {
      appts = a.value.appointments;
      payMode = a.value.payment || payMode;
      render();
    } else {
      $("#list").innerHTML =
        `<div class="card empty">${esc(a.reason.message)}</div>`;
    }
    if (b.status === "fulfilled") {
      renderBalance(b.value.summary);
      renderPayments(b.value.payments);
    } else {
      $("#balance").innerHTML =
        `<p class="msg">Couldn't load your balance: ${esc(b.reason.message)}</p>`;
    }
  }

  // Pay now (invoice balance) -> secure checkout
  $("#list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-pay]");
    if (!b) return;
    b.disabled = true;
    b.textContent = "Opening checkout…";
    try {
      const p = await api("payments.php?action=start", {
        method: "POST",
        body: { appointmentId: +b.dataset.pay },
      });
      location.href = p.checkoutUrl;
    } catch (err) {
      toast(err.message, true);
      await load();
    }
  });

  // Cancel flow
  let cancelId = null;
  const dlg = $("#confirm");
  $("#list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cancel]");
    if (!b) return;
    cancelId = +b.dataset.cancel;
    const a = appts.find((x) => x.id === cancelId);
    $("#confirmText").textContent =
      `${a.service} on ${fmtDate(a.date, true)} at ${a.timeLabel}.`;
    $("#confirmErr").textContent = "";
    dlg.showModal();
  });
  $("#confirmNo").addEventListener("click", () => dlg.close());
  $("#confirmYes").addEventListener("click", async () => {
    const btn = $("#confirmYes");
    btn.disabled = true;
    try {
      await api("appointments.php?action=cancel", {
        method: "POST",
        body: { id: cancelId },
      });
      dlg.close();
      toast("Appointment cancelled.");
      await load();
    } catch (err) {
      $("#confirmErr").textContent = err.message;
    }
    btn.disabled = false;
  });

  // Back from the payment page: confirm the payment with the provider and say what happened.
  const payToken = new URLSearchParams(location.search).get("pay");
  const cancelledFlag =
    new URLSearchParams(location.search).get("cancelled") === "1";
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
          "Payment not completed. No money was charged — you can try again with “Pay balance”.";
      } else {
        box.innerHTML = `We haven't received your payment yet. ${esc(r.problem || "If you already paid, wait a moment and check again.")} <button class="btn btn-ghost btn-sm" id="payRecheck" type="button">Check again</button>`;
        $("#payRecheck").addEventListener("click", async () => {
          await checkPayment();
          await load();
        });
      }
    } catch (e) {
      box.textContent = "We couldn't check your payment: " + e.message;
    }
    history.replaceState(null, "", "dashboard.html");
  }

  // Pick up payments finished in another tab (or while the page was closed), then load.
  (payToken
    ? checkPayment()
    : api("payments.php?action=verify", { method: "POST", body: {} }).catch(
        () => {},
      )
  )
    .catch(() => {})
    .then(load);
})();
