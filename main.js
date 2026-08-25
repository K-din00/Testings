(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
     CTA form (demo only — no backend)
     ------------------------------------------------------------------ */
  var ctaForm = document.getElementById("ctaForm");
  var ctaNote = document.getElementById("ctaNote");
  var ctaEmail = document.getElementById("ctaEmail");

  if (ctaForm) {
    ctaForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (ctaEmail && ctaEmail.value) {
        ctaNote.textContent = "You're on the list — check " + ctaEmail.value + " for a confirmation.";
        ctaForm.reset();
      }
    });
  }
})();
