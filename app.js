const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu-button]");
const navLinks = Array.from(document.querySelectorAll(".site-nav a"));
const toast = document.querySelector("[data-toast]");

const showToast = message => {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
};

const setHeaderState = () => {
  header?.classList.toggle("is-scrolled", window.scrollY > 8);
};

window.addEventListener("scroll", setHeaderState, { passive: true });
setHeaderState();

menuButton?.addEventListener("click", () => {
  const isOpen = document.body.classList.toggle("nav-open");
  menuButton.setAttribute("aria-label", isOpen ? "关闭导航" : "打开导航");
});

navLinks.forEach(link => {
  link.addEventListener("click", () => document.body.classList.remove("nav-open"));
});

const sections = navLinks
  .map(link => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

const observer = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      navLinks.forEach(link => {
        link.classList.toggle("is-active", link.getAttribute("href") === `#${entry.target.id}`);
      });
    });
  },
  { rootMargin: "-45% 0px -48% 0px", threshold: 0 }
);

sections.forEach(section => observer.observe(section));

document.querySelectorAll("[data-tool]").forEach(tab => {
  tab.addEventListener("click", () => {
    const tool = tab.dataset.tool;
    document.querySelectorAll("[data-tool]").forEach(item => {
      const active = item.dataset.tool === tool;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
    });

    document.querySelectorAll("[data-preview-section]").forEach(section => {
      section.classList.toggle("is-active", section.dataset.previewSection === tool);
    });
  });
});
