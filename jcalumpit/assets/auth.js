/* Login & Register pages: password Show/Hide, sign in, forgot password, create account. */
(function () {
  /* Adds a Show/Hide button to every password box on the page. */
  document.querySelectorAll('input[type="password"]').forEach((inp) => {
    const wrap = document.createElement("div");
    wrap.className = "pw-wrap";
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pw-toggle";
    b.textContent = "Show";
    b.setAttribute("aria-label", "Show password");
    b.addEventListener("click", () => {
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      b.textContent = show ? "Hide" : "Show";
      b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
    wrap.appendChild(b);
  });
})();

(function () {
  if (!document.getElementById("loginForm")) return;
  const loginForm = document.getElementById("loginForm");
  const loginMessage = document.getElementById("loginMessage");
  const params = new URLSearchParams(location.search);
  const nextPage = safeNext(params.get("next"));
  const idEl = document.getElementById("loginEmail");
  const pwEl = document.getElementById("loginPassword");

  function setMessage(text, kind) {
    loginMessage.textContent = text;
    loginMessage.className = "form-message " + (kind || "");
  }

  function goAfterLogin(user) {
    location.href = isStaffRole(user.role)
      ? "admin/index.html"
      : nextPage || "index.html";
  }

  // Keep ?next when switching to the register page.
  if (nextPage) {
    document.querySelectorAll('a[href="register.html"]').forEach((a) => {
      a.href = "register.html?next=" + encodeURIComponent(nextPage);
    });
  }
  if (params.get("notice") === "book") {
    setMessage(
      "Please sign in or create an account to book an appointment.",
      "info",
    );
  }

  // Already signed in? Skip the form.
  api("auth.php?action=session")
    .then((r) => r.user && goAfterLogin(r.user))
    .catch(() => {});

  [idEl, pwEl].forEach((el) =>
    el.addEventListener("input", () => el.classList.remove("invalid")),
  );

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const identifier = idEl.value.trim();
    const password = pwEl.value;
    const remember = document.getElementById("rememberMe").checked;
    idEl.classList.toggle("invalid", !identifier);
    pwEl.classList.toggle("invalid", !password);
    if (!identifier || !password) {
      setMessage(
        !identifier
          ? "Please enter your username or email."
          : "Please enter your password.",
        "error",
      );
      (!identifier ? idEl : pwEl).focus();
      return;
    }

    const btn = loginForm.querySelector(".submit");
    setMessage("", "");
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      const r = await api("auth.php?action=login", {
        method: "POST",
        body: { identifier, password, remember },
      });
      goAfterLogin(r.user);
    } catch (err) {
      setMessage(err.message, "error");
      if (err.status === 401) {
        pwEl.classList.add("invalid");
        pwEl.value = "";
        pwEl.focus();
      }
      btn.disabled = false;
      btn.textContent = "Sign In";
    }
  });

  /* ---------- Forgot password ---------- */
  const forgotForm = document.getElementById("forgotForm");
  const forgotMsg = document.getElementById("forgotMessage");
  const forgotEmail = document.getElementById("forgotEmail");
  const overlay = document.getElementById("forgotOverlay");

  forgotForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = forgotEmail.value.trim();
    forgotMsg.className = "form-message";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      forgotEmail.classList.add("invalid");
      forgotMsg.textContent = "Please enter a valid email address.";
      forgotMsg.className = "form-message error";
      return;
    }
    forgotEmail.classList.remove("invalid");
    const btn = document.getElementById("forgotBtn");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      const r = await api("auth.php?action=forgot", {
        method: "POST",
        body: { email },
      });
      forgotMsg.textContent = r.message;
      forgotMsg.className = "form-message ok";
      forgotEmail.value = "";
    } catch (err) {
      forgotMsg.textContent = err.message;
      forgotMsg.className = "form-message error";
    }
    btn.disabled = false;
    btn.textContent = "Send request";
  });

  // Close the pop-up with Esc or by clicking the dark background
  document.addEventListener(
    "keydown",
    (e) =>
      e.key === "Escape" &&
      location.hash === "#forgotOverlay" &&
      (location.hash = ""),
  );
  overlay.addEventListener(
    "click",
    (e) => e.target === overlay && (location.hash = ""),
  );
  window.addEventListener("hashchange", () => {
    if (location.hash === "#forgotOverlay")
      setTimeout(() => forgotEmail.focus(), 50);
  });
})();

(function () {
  if (!document.getElementById("registrationform")) return;
  const registrationform = document.getElementById("registrationform");
  const message = document.getElementById("message");
  const nextPage = safeNext(new URLSearchParams(location.search).get("next"));

  // Which field a server error is about (so we can highlight it)
  const SERVER_FIELDS = [
    [/username/i, "username"],
    [/email/i, "regEmail"],
    [/phone|mobile/i, "phone"],
    [/password/i, "regPassword"],
    [/address/i, "address"],
    [/birth|minor/i, "birthDate"],
  ];

  function showError(text, fieldId) {
    message.textContent = text;
    message.style.color = "#d92d20";
    registrationform
      .querySelectorAll(".invalid")
      .forEach((el) => el.classList.remove("invalid"));
    const el = fieldId && document.getElementById(fieldId);
    if (el) {
      el.classList.add("invalid");
      (el.matches("input,select,textarea")
        ? el
        : el.querySelector("input")
      ).focus();
    }
    return false;
  }
  registrationform.addEventListener("input", (e) => {
    e.target.classList.remove("invalid");
    const g = e.target.closest(".radio-group");
    if (g) g.classList.remove("invalid");
  });

  // Keep ?next when switching to the sign-in page.
  if (nextPage) {
    document.querySelectorAll('a[href="login.html"]').forEach((a) => {
      a.href = "login.html?next=" + encodeURIComponent(nextPage);
    });
  }

  // Birth date picker: nobody under 18 can register, so don't offer those dates.
  const birthEl = document.getElementById("birthDate");
  const youngest = new Date();
  youngest.setFullYear(youngest.getFullYear() - 18);
  birthEl.max = isoDate(youngest);
  birthEl.min = "1900-01-01";

  // Already signed in? Nothing to register.
  api("auth.php?action=session")
    .then((r) => {
      if (r.user)
        location.replace(
          r.user.role === "patient"
            ? nextPage || "index.html"
            : "admin/index.html",
        );
    })
    .catch(() => {});

  registrationform.addEventListener("submit", async function (event) {
    event.preventDefault();

    const value = (id) => document.getElementById(id).value.trim();
    const firstName = value("firstName");
    const middleName = value("middleName");
    const lastName = value("lastName");
    const genderEl = registrationform.querySelector(
      'input[name="gender"]:checked',
    );
    const gender = genderEl ? genderEl.value : "";
    const birthDate = birthEl.value;
    const email = value("regEmail");
    const phone = value("phone");
    const address = value("address");
    const username = value("username");
    const password = document.getElementById("regPassword").value;
    const confirmPassword = document.getElementById("regConfirm").value;

    if (firstName === "")
      return showError("Please enter your first name.", "firstName");
    if (lastName === "")
      return showError("Please enter your last name.", "lastName");
    if (gender === "")
      return showError("Please select your gender.", "genderGroup");
    if (birthDate === "")
      return showError("Please enter your birth date.", "birthDate");

    // Age check
    const b = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - b.getFullYear();
    const md = today.getMonth() - b.getMonth();
    if (md < 0 || (md === 0 && today.getDate() < b.getDate())) age--;
    if (isNaN(age) || age < 0)
      return showError("Please enter a valid birth date.", "birthDate");
    if (age < 18)
      return showError(
        "Minors under 18 years old are not allowed to register.",
        "birthDate",
      );

    if (email === "") return showError("Please enter your email.", "regEmail");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return showError("Please enter a valid email address.", "regEmail");
    if (phone === "")
      return showError("Please enter your phone number.", "phone");
    if (!/^(09|\+639)\d{9}$/.test(phone.replace(/[\s-]/g, "")))
      return showError(
        "Use a valid PH mobile number, e.g. 09171234567.",
        "phone",
      );
    if (address === "")
      return showError("Please enter your address.", "address");
    if (address.length < 5)
      return showError("Please enter your complete address.", "address");

    if (username === "")
      return showError("Please enter your username.", "username");
    if (!/^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)?$/.test(username))
      return showError(
        "Username may only contain letters, numbers, or a single hyphen — no spaces.",
        "username",
      );
    if (username.length < 3 || username.length > 30)
      return showError("Username must be 3 to 30 characters long.", "username");

    if (password.length < 8)
      return showError(
        "Password must be at least 8 characters.",
        "regPassword",
      );
    if (!/[0-9]/.test(password))
      return showError(
        "Password must contain at least one number.",
        "regPassword",
      );
    if (!/[a-z]/.test(password))
      return showError(
        "Password must contain at least one lowercase letter.",
        "regPassword",
      );
    if (password !== confirmPassword)
      return showError("Passwords do not match!", "regConfirm");

    const btn = registrationform.querySelector(".submit");
    btn.disabled = true;
    btn.textContent = "Creating account…";
    message.textContent = "";

    try {
      await api("auth.php?action=register", {
        method: "POST",
        body: {
          firstName,
          middleName,
          lastName,
          gender,
          birthDate,
          email,
          phone,
          address,
          username,
          password,
          confirmPassword,
        },
      });
      message.textContent = "Account created! Signing you in…";
      message.style.color = "#1a7f37";
      setTimeout(() => (location.href = nextPage || "index.html"), 700);
    } catch (err) {
      const hit = SERVER_FIELDS.find(([re]) => re.test(err.message));
      showError(err.message, hit && hit[1]);
      btn.disabled = false;
      btn.textContent = "Create account";
    }
  });
})();
