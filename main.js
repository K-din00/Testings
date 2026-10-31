(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------
     Cinematic page intro (once per session, skippable)
     ------------------------------------------------------------------ */
  var apexIntro = document.getElementById("apexIntro");

  if (apexIntro) {
    var introSeen = false;
    try {
      introSeen = sessionStorage.getItem("apexIntroSeen") === "1";
    } catch (err) {
      // Private mode may block storage; still show the intro.
    }

    if (reducedMotion || introSeen) {
      apexIntro.remove();
    } else {
      try {
        sessionStorage.setItem("apexIntroSeen", "1");
      } catch (err) {
        // Ignore storage failures.
      }

      document.body.classList.add("intro-active");

      var introFinished = false;
      var introTimer = window.setTimeout(finishIntro, 1900);

      function finishIntro() {
        if (introFinished) return;
        introFinished = true;
        window.clearTimeout(introTimer);
        apexIntro.classList.add("done");
        document.body.classList.remove("intro-active");
        window.setTimeout(function () {
          if (apexIntro.parentNode) apexIntro.remove();
        }, 1200);
      }

      apexIntro.addEventListener("click", finishIntro);
      window.addEventListener(
        "keydown",
        function (event) {
          if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
            finishIntro();
          }
        },
        { once: true }
      );
    }
  }

  /* ------------------------------------------------------------------
     Nav: scrolled state + mobile toggle
     ------------------------------------------------------------------ */
  var nav = document.getElementById("nav");
  var navToggle = document.getElementById("navToggle");
  var navLinks = document.getElementById("navLinks");

  function onScrollNav() {
    if (window.scrollY > 12) {
      nav.classList.add("scrolled");
    } else {
      nav.classList.remove("scrolled");
    }
  }
  window.addEventListener("scroll", onScrollNav, { passive: true });
  onScrollNav();

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      var isOpen = navLinks.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      navToggle.classList.toggle("active", isOpen);
    });

    navLinks.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navLinks.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ------------------------------------------------------------------
     Reveal-on-scroll
     ------------------------------------------------------------------ */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry, i) {
          if (entry.isIntersecting) {
            var el = entry.target;
            var delay = Array.prototype.indexOf.call(revealEls, el) % 4 * 70;
            setTimeout(function () { el.classList.add("in"); }, reducedMotion ? 0 : delay);
            revealObserver.unobserve(el);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ------------------------------------------------------------------
     Hero track: draw-in path + moving dot
     ------------------------------------------------------------------ */
  var trackPath = document.getElementById("trackPath");
  var trackDot = document.getElementById("trackDot");
  var trackDotGlow = document.getElementById("trackDotGlow");

  if (trackPath && trackDot) {
    var pathLength = trackPath.getTotalLength();
    trackPath.style.strokeDasharray = pathLength;
    trackPath.style.strokeDashoffset = pathLength;

    if (!reducedMotion) {
      trackPath.style.transition = "stroke-dashoffset 2.6s cubic-bezier(.3,.7,.2,1)";
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          trackPath.style.strokeDashoffset = "0";
        });
      });

      var dotStart = null;
      var lapDuration = 9000; // ms per lap
      function animateDot(ts) {
        if (dotStart === null) dotStart = ts;
        var elapsed = (ts - dotStart) % lapDuration;
        var progress = elapsed / lapDuration;
        var pt = trackPath.getPointAtLength(progress * pathLength);
        trackDot.setAttribute("cx", pt.x);
        trackDot.setAttribute("cy", pt.y);
        trackDotGlow.setAttribute("cx", pt.x);
        trackDotGlow.setAttribute("cy", pt.y);
        requestAnimationFrame(animateDot);
      }
      requestAnimationFrame(animateDot);
    } else {
      trackPath.style.strokeDashoffset = "0";
      var pt0 = trackPath.getPointAtLength(0);
      trackDot.setAttribute("cx", pt0.x);
      trackDot.setAttribute("cy", pt0.y);
      trackDotGlow.setAttribute("cx", pt0.x);
      trackDotGlow.setAttribute("cy", pt0.y);
    }
  }

  /* ------------------------------------------------------------------
     Hero HUD readout (speed / gear / delta) — synthetic lap feel
     ------------------------------------------------------------------ */
  var hudSpeed = document.getElementById("hudSpeed");
  var hudGear = document.getElementById("hudGear");
  var hudDelta = document.getElementById("hudDelta");

  if (hudSpeed && !reducedMotion) {
    var hudStart = null;
    var hudLap = 9000;
    var gears = [2, 2, 3, 4, 5, 5, 4, 3, 3, 4, 5, 6, 6, 5, 4, 3, 2];

    function updateHud(ts) {
      if (hudStart === null) hudStart = ts;
      var elapsed = (ts - hudStart) % hudLap;
      var t = elapsed / hudLap;

      // speed profile: rises through straights, dips at corners
      var speed = 90 + 130 * Math.abs(Math.sin(t * Math.PI * 3.1));
      speed += Math.sin(t * 60) * 2;
      hudSpeed.textContent = Math.round(speed);

      var gearIndex = Math.floor(t * gears.length) % gears.length;
      hudGear.textContent = gears[gearIndex];

      var delta = Math.sin(t * Math.PI * 2) * 0.42;
      hudDelta.textContent = (delta >= 0 ? "+" : "") + delta.toFixed(2);
      hudDelta.style.color = delta <= 0 ? "var(--green)" : "var(--text)";

      requestAnimationFrame(updateHud);
    }
    requestAnimationFrame(updateHud);
  } else if (hudSpeed) {
    hudSpeed.textContent = "212";
    hudGear.textContent = "5";
    hudDelta.textContent = "-0.18";
  }

  /* ------------------------------------------------------------------
     Telemetry oscilloscope canvas
     ------------------------------------------------------------------ */
  var canvas = document.getElementById("scope");
  var rThrottle = document.getElementById("rThrottle");
  var rBrake = document.getElementById("rBrake");

  if (canvas) {
    var ctx = canvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var scopeRunning = false;
    var throttleHist = [];
    var brakeHist = [];
    var speedHist = [];
    var scopeT = 0;

    function resizeCanvas() {
      var rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function sampleAt(t) {
      // synthetic lap-like signal for throttle/brake, speed derived from both
      var cyclePos = (t % 400) / 400;
      var throttle = Math.max(0, Math.sin(cyclePos * Math.PI * 2 - 0.4)) * 95 + 3;
      var brake = Math.max(0, -Math.sin(cyclePos * Math.PI * 2 + 1.4)) * 88;
      if (brake > 8) throttle *= 0.15;
      var speed = 40 + throttle * 0.6 - brake * 0.35 + 30 * Math.sin(cyclePos * Math.PI * 4);
      return {
        throttle: Math.max(0, Math.min(100, throttle)),
        brake: Math.max(0, Math.min(100, brake)),
        speed: Math.max(10, Math.min(100, speed))
      };
    }

    var maxPoints = 180;

    function drawScope() {
      var rect = canvas.getBoundingClientRect();
      var w = rect.width;
      var h = rect.height;

      ctx.clearRect(0, 0, w, h);

      // grid
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      var rows = 4;
      for (var i = 1; i < rows; i++) {
        var y = (h / rows) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      function drawLine(hist, color) {
        if (hist.length < 2) return;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        var stepX = w / (maxPoints - 1);
        var startIdx = maxPoints - hist.length;
        hist.forEach(function (v, idx) {
          var x = (startIdx + idx) * stepX;
          var y = h - (v / 100) * (h - 14) - 6;
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      drawLine(speedHist, "rgba(76,201,240,0.85)");
      drawLine(throttleHist, "rgba(255,184,0,0.95)");
      drawLine(brakeHist, "rgba(255,71,87,0.95)");
    }

    function tick() {
      scopeT += 2.4;
      var s = sampleAt(scopeT);
      throttleHist.push(s.throttle);
      brakeHist.push(s.brake);
      speedHist.push(s.speed);
      if (throttleHist.length > maxPoints) throttleHist.shift();
      if (brakeHist.length > maxPoints) brakeHist.shift();
      if (speedHist.length > maxPoints) speedHist.shift();

      drawScope();

      if (rThrottle) rThrottle.textContent = Math.round(s.throttle) + "%";
      if (rBrake) rBrake.textContent = Math.round(s.brake) + "%";

      if (scopeRunning) {
        if (reducedMotion) {
          setTimeout(function () { requestAnimationFrame(tick); }, 300);
        } else {
          requestAnimationFrame(tick);
        }
      }
    }

    // Only run the scope while its section is visible, to keep things light
    if ("IntersectionObserver" in window) {
      var scopeObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && !scopeRunning) {
              scopeRunning = true;
              requestAnimationFrame(tick);
            } else if (!entry.isIntersecting) {
              scopeRunning = false;
            }
          });
        },
        { threshold: 0.2 }
      );
      scopeObserver.observe(canvas);
    } else {
      scopeRunning = true;
      requestAnimationFrame(tick);
    }
  }

  /* ------------------------------------------------------------------
     Stat counters
     ------------------------------------------------------------------ */
  var statEls = document.querySelectorAll(".stat-num");
  function animateCount(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    var decimals = parseInt(el.getAttribute("data-decimals") || "0", 10);
    var suffix = el.getAttribute("data-suffix") || "";
    var duration = reducedMotion ? 0 : 1400;
    var startTime = null;

    if (duration === 0) {
      el.textContent = target.toFixed(decimals) + suffix;
      return;
    }

    function step(ts) {
      if (startTime === null) startTime = ts;
      var progress = Math.min(1, (ts - startTime) / duration);
      var eased = 1 - Math.pow(1 - progress, 3);
      var value = target * eased;
      el.textContent = value.toFixed(decimals) + suffix;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  if (statEls.length && "IntersectionObserver" in window) {
    var statObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            statObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    statEls.forEach(function (el) { statObserver.observe(el); });
  } else {
    statEls.forEach(animateCount);
  }

/* ------------------------------------------------------------------
   CTA form → early access account modal
   ------------------------------------------------------------------ */

var ctaForm = document.getElementById("ctaForm");
var ctaNote = document.getElementById("ctaNote");
var ctaEmail = document.getElementById("ctaEmail");
var accessModal = document.getElementById("accessModal");
var accessForm = document.getElementById("accessForm");
var accessEmail = document.getElementById("accessEmail");
var accessPassword = document.getElementById("accessPassword");
var accessError = document.getElementById("accessError");
var accessSubmit = document.getElementById("accessSubmit");
var accessTitle = document.getElementById("accessTitle");
var accessSub = document.getElementById("accessSub");
var accessClose = document.getElementById("accessClose");
var accessPwToggle = document.getElementById("accessPwToggle");
var accessOpener = null;

// Requires: text before @, a domain, a dot, and a TLD of 2+ letters
// (also allows punycode TLDs like xn--p1ai)
var EMAIL_RE = /^[^\s@]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,}|xn--[a-z0-9-]{2,})$/i;

function setAccessError(message) {
  if (accessError) accessError.textContent = message;
}

function openAccessModal(email, hasAccount) {
  if (!accessModal) return;

  accessOpener = document.activeElement;

  if (accessEmail) accessEmail.value = email;
  if (accessPassword) {
    accessPassword.value = "";
    accessPassword.type = "password";
    accessPassword.autocomplete = hasAccount ? "current-password" : "new-password";
  }
  if (accessPwToggle) {
    accessPwToggle.setAttribute("aria-pressed", "false");
    accessPwToggle.setAttribute("aria-label", "Show password");
    accessPwToggle.setAttribute("title", "Show password");
  }
  if (accessTitle) {
    accessTitle.textContent = hasAccount
      ? "Sign in to Apex."
      : "Create a password for " + email + ".";
  }
  if (accessSub) {
    accessSub.textContent =
      "You'll use your email and password combination to login to Apex.";
  }
  if (accessSubmit) {
    accessSubmit.disabled = false;
    accessSubmit.textContent = "Continue";
  }
  setAccessError("");

  if (typeof accessModal.showModal === "function") {
    if (!accessModal.open) accessModal.showModal();
  } else {
    accessModal.setAttribute("open", "");
  }

  window.setTimeout(function () {
    if (accessPassword) accessPassword.focus();
  }, 30);
}

function closeAccessModal() {
  if (!accessModal) return;

  if (typeof accessModal.close === "function" && accessModal.open) {
    accessModal.close();
  } else {
    accessModal.removeAttribute("open");
  }

  if (accessPassword) accessPassword.value = "";
  setAccessError("");
  if (accessOpener && typeof accessOpener.focus === "function") accessOpener.focus();
}

if (accessClose) accessClose.addEventListener("click", closeAccessModal);

if (accessModal) {
  accessModal.addEventListener("click", function (event) {
    if (event.target === accessModal) closeAccessModal();
  });

  accessModal.addEventListener("close", function () {
    if (accessPassword) accessPassword.value = "";
  });
}

if (accessPwToggle && accessPassword) {
  accessPwToggle.addEventListener("click", function () {
    var show = accessPassword.type === "password";
    accessPassword.type = show ? "text" : "password";
    accessPwToggle.setAttribute("aria-pressed", show ? "true" : "false");
    accessPwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    accessPwToggle.setAttribute("title", show ? "Hide password" : "Show password");
    accessPassword.focus();
  });
}

if (accessForm) {
  accessForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    if (accessSubmit && accessSubmit.disabled) return;

    var email = accessEmail ? accessEmail.value.trim().toLowerCase() : "";
    var password = accessPassword ? accessPassword.value : "";

    setAccessError("");

    if (!email || !password) {
      setAccessError("Enter your password.");
      if (accessPassword) accessPassword.focus();
      return;
    }

    if (accessSubmit) {
      accessSubmit.disabled = true;
      accessSubmit.textContent = "Signing in…";
    }

    try {
      var response = await fetch("/api/account/access", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password })
      });

      if (response.ok) {
        window.location.assign("account.html");
        return;
      }

      if (response.status === 401) {
        if (accessTitle) accessTitle.textContent = "Sign in to Apex.";
        if (accessSub) {
          accessSub.textContent =
            "You'll use your email and password combination to login to Apex.";
        }
        if (accessPassword) {
          accessPassword.autocomplete = "current-password";
          accessPassword.value = "";
          accessPassword.focus();
        }
        setAccessError("Incorrect password. Try again.");
      } else if (response.status === 404) {
        setAccessError("This email is not on the early-access list.");
      } else if (response.status === 400) {
        setAccessError("Enter a valid email and password.");
      } else {
        setAccessError("Something went wrong. Please try again.");
      }
    } catch (err) {
      setAccessError("Unable to reach the server. Please try again.");
    } finally {
      if (accessSubmit) {
        accessSubmit.disabled = false;
        accessSubmit.textContent = "Continue";
      }
    }
  });
}

if (ctaForm) {
  ctaForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!ctaEmail || !ctaEmail.value) return;

    var emailValue = ctaEmail.value.trim();
    if (!EMAIL_RE.test(emailValue)) {
      ctaNote.textContent = "Please enter a valid email address, like name@example.com.";
      ctaEmail.focus();
      return;
    }

    var submitBtn = ctaForm.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    ctaNote.textContent = "Saving…";

    // Every named field in the form (checkboxes, selects, etc. included)
    var fields = Object.fromEntries(new FormData(ctaForm).entries());
    var email = (fields.email || ctaEmail.value).trim().toLowerCase();
    delete fields.email;

    var row = {
      email: email,
      fields: fields, // any extra inputs end up here as jsonb
      meta: {
        page_url: location.href,
        referrer: document.referrer || null,
        language: navigator.language,
        user_agent: navigator.userAgent,
        submitted_at: new Date().toISOString()
      }
    };

    try {
      var resp = await fetch("/api/signup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row)
      });

      var data = null;
      try {
        data = await resp.json();
      } catch (err) {
        // Keep the status-code fallback below.
      }

      if (resp.ok || resp.status === 409) {
        var hasAccount = !!(data && data.has_account);
        ctaNote.textContent = hasAccount
          ? "You're already on the list. Sign in to your early-access page."
          : "You're on the list. Set a password to open your early-access page.";
        openAccessModal(email, hasAccount);
      } else if (resp.status === 400) {
        ctaNote.textContent = "Please enter a valid email address, like name@example.com.";
      } else {
        throw new Error("signup failed");
      }
    } catch (err) {
      console.error(err);
      ctaNote.textContent = "Something went wrong. Please try again.";
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}
})();
