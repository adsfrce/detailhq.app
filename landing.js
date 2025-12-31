// landing.js

// Mark page as loaded (for hero premium in)
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  window.addEventListener('load', () => {
    document.body.classList.add('is-loaded');
  }, { once: true });
})();

// Header blur on scroll
(() => {
  const header = document.querySelector("[data-header]");
  if (!header) return;

  const onScroll = () => {
    if (window.scrollY > 8) header.classList.add("is-scrolled");
    else header.classList.remove("is-scrolled");
  };

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
})();

// Mobile nav drawer
(() => {
  const toggle = document.querySelector("[data-nav-toggle]");
  const drawer = document.querySelector("[data-nav-drawer]");
  const closeLinks = document.querySelectorAll("[data-nav-close]");

  if (!toggle || !drawer) return;

  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    drawer.classList.toggle("is-open", open);
    document.documentElement.classList.toggle("nav-open", open);
  };

  toggle.addEventListener("click", () => {
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    setOpen(!isOpen);
  });

  drawer.addEventListener("click", (e) => {
    if (e.target === drawer) setOpen(false);
  });

  closeLinks.forEach((a) => a.addEventListener("click", () => setOpen(false)));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
})();

// Billing toggle (monthly/yearly)
(() => {
  const buttons = document.querySelectorAll(".toggle-btn[data-billing]");
  const monthlyPrice = document.querySelector("[data-price-monthly]");
  const yearlyPrice = document.querySelector("[data-price-yearly]");
  const monthlyPer = document.querySelector("[data-per-monthly]");
  const yearlyPer = document.querySelector("[data-per-yearly]");
  const monthlySub = document.querySelector("[data-subline-monthly]");
  const yearlySub = document.querySelector("[data-subline-yearly]");

  if (!buttons.length || !monthlyPrice || !yearlyPrice || !monthlyPer || !yearlyPer || !monthlySub || !yearlySub) return;

  const showMonthly = (isMonthly) => {
    monthlyPrice.hidden = !isMonthly;
    monthlyPer.hidden = !isMonthly;
    monthlySub.hidden = !isMonthly;

    yearlyPrice.hidden = isMonthly;
    yearlyPer.hidden = isMonthly;
    yearlySub.hidden = isMonthly;
  };

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", active ? "true" : "false");
      });

      showMonthly(btn.dataset.billing === "monthly");
    });
  });

  showMonthly(true);
})();

// Footer year
(() => {
  const y = document.getElementById("y");
  if (y) y.textContent = String(new Date().getFullYear());
})();

// High-end motion: reveal on scroll + subtle device tilt
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  // Add reveal classes automatically (no HTML edits needed)
  const revealEls = [
    ...document.querySelectorAll(".section-head, .hero-copy, .hero-visual, .split-copy, .split-visual, .steps, .pricing-wrap, .faq, .final-cta")
  ];
  revealEls.forEach(el => el.classList.add("reveal"));

  const staggerEls = [
    ...document.querySelectorAll(".grid-3, .trust-strip, .pricing-grid")
  ];
  staggerEls.forEach(el => el.classList.add("reveal-stagger"));

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.14, rootMargin: "0px 0px -6% 0px" });

  [...revealEls, ...staggerEls].forEach(el => io.observe(el));

  // Device tilt (subtle)
  const device = document.querySelector(".device");
  if (!device) return;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const state = { tx: 0, ty: 0, rx: 0, ry: 0, raf: 0 };
  const render = () => {
    state.raf = 0;
    // dampening
    state.rx += (state.tx - state.rx) * 0.12;
    state.ry += (state.ty - state.ry) * 0.12;

    device.style.transform = `perspective(980px) rotateX(${state.rx}deg) rotateY(${state.ry}deg) translateY(-1px)`;
    device.classList.add("is-tilt");
  };

  const onMove = (ev) => {
    const r = device.getBoundingClientRect();
    const x = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const y = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);

    state.tx = clamp(-y * 3.0, -4, 4);
    state.ty = clamp(x * 3.0, -4, 4);

    if (!state.raf) state.raf = requestAnimationFrame(render);
  };

  const onLeave = () => {
    device.style.transform = "";
    device.classList.remove("is-tilt");
  };

  device.addEventListener("mousemove", onMove);
  device.addEventListener("mouseleave", onLeave);
})();
