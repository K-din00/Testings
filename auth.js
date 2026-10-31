/*
 * Internal auth client for the Apex console.
 * Credentials and sessions live in PostgreSQL and are handled by the API.
 * The browser only receives an HttpOnly session cookie.
 */
(function () {
  "use strict";

  var SESSION_ENDPOINT = "/api/auth/session";
  var LOGIN_ENDPOINT = "/api/auth/login";
  var LOGOUT_ENDPOINT = "/api/auth/logout";
  var TOUCH_ENDPOINT = "/api/auth/touch";
  var SIGNUPS_ENDPOINT = "/api/internal/signups";
  var TOUCH_INTERVAL_MS = 30 * 1000;

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (err) {
      return new Date(value).toLocaleString();
    }
  }

  function redirectToLogin() {
    window.location.replace("login.html");
  }

  async function requestJSON(url, options) {
    var response = await fetch(url, Object.assign({ credentials: "same-origin" }, options));
    var data = null;
    try {
      data = await response.json();
    } catch (err) {
      // Some responses intentionally have no JSON body.
    }
    return { response: response, data: data };
  }

  /* ------------------------------------------------------------------
     Login page
     ------------------------------------------------------------------ */

  var loginForm = document.getElementById("loginForm");

  if (loginForm) {
    var loginCard = document.querySelector(".login-card");
    var loginError = document.getElementById("loginError");
    var loginSubmit = document.getElementById("loginSubmit");
    var usernameInput = document.getElementById("username");
    var passwordInput = document.getElementById("password");
    var pwToggle = document.getElementById("pwToggle");

    // If this browser already has a valid session, skip the form.
    requestJSON(SESSION_ENDPOINT)
      .then(function (result) {
        if (result.response.ok) window.location.replace("internal.html");
      })
      .catch(function () {});

    if (pwToggle && passwordInput) {
      pwToggle.addEventListener("click", function () {
        var show = passwordInput.type === "password";
        passwordInput.type = show ? "text" : "password";
        pwToggle.setAttribute("aria-pressed", show ? "true" : "false");
        pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
        pwToggle.setAttribute("title", show ? "Hide password" : "Show password");
        passwordInput.focus();
      });
    }

    loginForm.addEventListener("submit", async function (event) {
      event.preventDefault();

      if (loginSubmit && loginSubmit.disabled) return;

      var username = usernameInput ? usernameInput.value.trim() : "";
      var password = passwordInput ? passwordInput.value : "";

      if (loginError) loginError.textContent = "";
      if (loginCard) loginCard.classList.remove("shake");

      if (!username || !password) {
        if (loginError) loginError.textContent = "Enter your username and password.";
        (username ? passwordInput : usernameInput).focus();
        return;
      }

      if (loginSubmit) {
        loginSubmit.disabled = true;
        loginSubmit.textContent = "Verifying…";
      }

      try {
        var result = await requestJSON(LOGIN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username, password: password })
        });

        if (result.response.ok) {
          window.location.replace("internal.html");
          return;
        }

        if (result.response.status === 400 || result.response.status === 401) {
          if (loginError) loginError.textContent = "Invalid username or password.";
          if (passwordInput) {
            passwordInput.value = "";
            passwordInput.focus();
          }
          if (loginCard) loginCard.classList.add("shake");
        } else {
          if (loginError) loginError.textContent = "Something went wrong. Please try again.";
        }
      } catch (err) {
        if (loginError) loginError.textContent = "Unable to reach the server. Please try again.";
      } finally {
        if (loginSubmit) {
          loginSubmit.disabled = false;
          loginSubmit.textContent = "Sign in";
        }
      }
    });
  }

  /* ------------------------------------------------------------------
     Internal console + signups page
     ------------------------------------------------------------------ */

  var logoutBtn = document.getElementById("logoutBtn");

  if (logoutBtn) {
    var currentExpiry = null;
    var countdownTimer = null;
    var activityBound = false;
    var lastTouchAt = 0;
    var signupsTable = document.getElementById("signupsTable");
    var signupsMeta = document.getElementById("signupsMeta");
    var signupsError = document.getElementById("signupsError");
    var refreshSignupsBtn = document.getElementById("refreshSignups");

    function checkExpiry() {
      if (!currentExpiry) return false;

      var remaining = new Date(currentExpiry).getTime() - Date.now();
      if (isNaN(remaining) || remaining <= 0) {
        redirectToLogin();
        return true;
      }
      return false;
    }

    function updateCountdown() {
      if (checkExpiry()) return;

      var countdown = document.getElementById("sessionCountdown");
      if (!countdown) return;

      var remaining = new Date(currentExpiry).getTime() - Date.now();
      var minutes = Math.ceil(remaining / 60000);
      var hours = Math.floor(minutes / 60);
      var mins = minutes % 60;
      var label = hours > 0 ? hours + "h " + mins + "m" : mins + "m";
      countdown.textContent = "Session active — expires in " + label;
    }

    function renderSession(session) {
      var user = session.user || {};
      setText("sessionUser", user.username || "—");
      setText("heroUser", user.username || "—");
      setText("sessionUserDetail", user.username || "—");
      setText("sessionRole", user.role || "Administrator");
      setText("sessionStarted", formatDate(session.createdAt));
      setText("sessionExpires", formatDate(session.expiresAt));
      setText("sessionToken", session.sessionId ? session.sessionId.slice(0, 8) + "…" : "—");

      currentExpiry = session.expiresAt;
      updateCountdown();
    }

    function touchSession() {
      var now = Date.now();
      if (now - lastTouchAt < TOUCH_INTERVAL_MS) return;
      lastTouchAt = now;

      requestJSON(TOUCH_ENDPOINT, { method: "POST" })
        .then(function (result) {
          if (result.response.status === 401) {
            redirectToLogin();
            return;
          }
          if (result.response.ok && result.data) {
            currentExpiry = result.data.expiresAt;
            setText("sessionExpires", formatDate(result.data.expiresAt));
            updateCountdown();
          }
        })
        .catch(function () {});
    }

    function bindActivity() {
      if (activityBound) return;
      activityBound = true;

      ["pointerdown", "pointermove", "keydown", "touchstart", "scroll"].forEach(function (type) {
        window.addEventListener(
          type,
          touchSession,
          type === "scroll" ? { passive: true, capture: true } : false
        );
      });
    }

    function renderSignups(data) {
      if (!signupsTable) return;

      var columns = Array.isArray(data.columns) ? data.columns : [];
      var rows = Array.isArray(data.rows) ? data.rows : [];
      var total = Number(data.total) || 0;

      signupsTable.textContent = "";

      var thead = document.createElement("thead");
      var headRow = document.createElement("tr");

      columns.forEach(function (column) {
        var th = document.createElement("th");
        th.scope = "col";
        th.textContent = column.name;

        if (column.type) {
          var type = document.createElement("span");
          type.className = "signups-col-type";
          type.textContent = column.type;
          th.appendChild(type);
        }
        headRow.appendChild(th);
      });

      thead.appendChild(headRow);
      signupsTable.appendChild(thead);

      var tbody = document.createElement("tbody");

      if (!rows.length) {
        var emptyRow = document.createElement("tr");
        var emptyCell = document.createElement("td");
        emptyCell.colSpan = Math.max(columns.length, 1);
        emptyCell.className = "signups-empty";
        emptyCell.textContent = "No signups yet.";
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
      } else {
        rows.forEach(function (row) {
          var tr = document.createElement("tr");

          columns.forEach(function (column) {
            var td = document.createElement("td");
            var value = row[column.name];

            if (value === null || value === undefined) {
              td.textContent = "—";
              td.className = "cell-empty";
            } else if (typeof value === "object") {
              var pre = document.createElement("pre");
              pre.textContent = JSON.stringify(value, null, 2);
              td.appendChild(pre);
              td.className = "cell-json";
            } else if (column.name === "created_at") {
              td.textContent = formatDate(value);
              td.title = String(value);
              td.className = "cell-date";
            } else if (column.name === "id") {
              td.textContent = String(value);
              td.className = "mono cell-id";
            } else if (column.name === "email") {
              td.textContent = String(value);
              td.className = "cell-email";
            } else {
              td.textContent = String(value);
            }

            tr.appendChild(td);
          });

          tbody.appendChild(tr);
        });
      }

      signupsTable.appendChild(tbody);

      if (signupsMeta) {
        var label = total === 1 ? "1 signup" : total + " signups";
        if (rows.length < total) label += " — showing latest " + rows.length;
        signupsMeta.textContent = label;
      }
    }

    async function loadSignups() {
      if (!signupsTable) return;

      if (refreshSignupsBtn) refreshSignupsBtn.disabled = true;
      if (signupsError) signupsError.textContent = "";
      if (signupsMeta) signupsMeta.textContent = "Loading…";

      try {
        var result = await requestJSON(SIGNUPS_ENDPOINT);

        if (result.response.status === 401) {
          redirectToLogin();
          return;
        }
        if (!result.response.ok) throw new Error("signups request failed");

        renderSignups(result.data || {});
      } catch (err) {
        if (signupsError) signupsError.textContent = "Unable to load signups. Please try again.";
        if (signupsMeta) signupsMeta.textContent = "—";
      } finally {
        if (refreshSignupsBtn) refreshSignupsBtn.disabled = false;
      }
    }

    async function loadSession() {
      try {
        var result = await requestJSON(SESSION_ENDPOINT);
        if (!result.response.ok) {
          redirectToLogin();
          return;
        }

        document.documentElement.classList.remove("auth-checking");
        renderSession(result.data || {});

        if (countdownTimer) window.clearInterval(countdownTimer);
        countdownTimer = window.setInterval(updateCountdown, 30000);
        bindActivity();

        if (signupsTable) await loadSignups();
      } catch (err) {
        redirectToLogin();
      }
    }

    logoutBtn.addEventListener("click", async function () {
      logoutBtn.disabled = true;
      try {
        await requestJSON(LOGOUT_ENDPOINT, { method: "POST" });
      } catch (err) {
        // Redirect anyway; the session will expire server-side.
      }
      window.location.replace("login.html");
    });

    if (refreshSignupsBtn) {
      refreshSignupsBtn.addEventListener("click", loadSignups);
    }

    loadSession();
  }
})();
