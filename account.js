/*
 * Public early-access account page.
 * The session is an HttpOnly cookie; this script only watches expiry and
 * keeps the 15-minute idle window sliding while the user is active.
 */
(function () {
  "use strict";

  var SESSION_ENDPOINT = "/api/account/session";
  var TOUCH_ENDPOINT = "/api/account/touch";
  var LOGOUT_ENDPOINT = "/api/account/logout";
  var TOUCH_INTERVAL_MS = 30 * 1000;
  var CHECK_INTERVAL_MS = 15 * 1000;

  var currentExpiry = null;
  var lastTouchAt = 0;
  var activityBound = false;

  function redirectToCta() {
    window.location.replace("index.html#cta");
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

  function checkExpiry() {
    if (!currentExpiry) return false;

    var remaining = new Date(currentExpiry).getTime() - Date.now();
    if (isNaN(remaining) || remaining <= 0) {
      redirectToCta();
      return true;
    }
    return false;
  }

  function touchSession() {
    var now = Date.now();
    if (now - lastTouchAt < TOUCH_INTERVAL_MS) return;
    lastTouchAt = now;

    requestJSON(TOUCH_ENDPOINT, { method: "POST" })
      .then(function (result) {
        if (result.response.status === 401) {
          redirectToCta();
          return;
        }
        if (result.response.ok && result.data) {
          currentExpiry = result.data.expiresAt;
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

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      if (checkExpiry()) return;
      touchSession();
    });
  }

  async function init() {
    try {
      var result = await requestJSON(SESSION_ENDPOINT);
      if (!result.response.ok) {
        redirectToCta();
        return;
      }

      currentExpiry = (result.data || {}).expiresAt;
      bindActivity();
      window.setInterval(checkExpiry, CHECK_INTERVAL_MS);
    } catch (err) {
      redirectToCta();
    }
  }

  var logoutBtn = document.getElementById("accountLogout");

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async function () {
      logoutBtn.disabled = true;
      try {
        await requestJSON(LOGOUT_ENDPOINT, { method: "POST" });
      } catch (err) {
        // Redirect anyway; the session will expire server-side.
      }
      redirectToCta();
    });
  }

  init();
})();
