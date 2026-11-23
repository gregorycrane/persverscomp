/* Canonical Perseus application navigation. Sync consumers with
   tools/sync_perseus_navigation.py; do not edit generated copies. */
(function (global) {
  "use strict";

  function resolveElement(value) {
    return typeof value === "string" ? document.querySelector(value) : value;
  }

  function renderBrowseNavigation(options) {
    const mount = resolveElement(options.mount);
    if (!mount) throw new Error("PerseusNavigation requires a browse-navigation mount point.");
    const nav = document.createElement("nav");
    nav.className = options.className || "fc-browse-nav";
    nav.setAttribute("aria-label", options.ariaLabel || "Browse the library");
    const label = document.createElement("span");
    label.textContent = options.label || "Browse:";
    nav.append(label);
    (options.links || []).forEach((item) => {
      const link = document.createElement("a");
      link.href = item.href;
      link.textContent = item.label;
      if (item.current) link.setAttribute("aria-current", "page");
      nav.append(link);
    });
    mount.replaceWith(nav);
    return nav;
  }

  function initCollapsibleNavigation(options) {
    const button = resolveElement(options.button);
    const targets = (options.targets || []).map(resolveElement).filter(Boolean);
    if (!button || !targets.length) return null;
    let hidden = false;
    try { hidden = localStorage.getItem(options.storageKey) === "true"; } catch (_) {}

    function setHidden(value) {
      hidden = Boolean(value);
      targets.forEach((target) => target.classList.toggle("perseus-navigation-hidden", hidden));
      button.textContent = hidden ? (options.showLabel || "Show navigation bar") : (options.hideLabel || "Hide navigation bar");
      button.setAttribute("aria-pressed", String(hidden));
      try { localStorage.setItem(options.storageKey, String(hidden)); } catch (_) {}
    }

    button.addEventListener("click", () => setHidden(!hidden));
    setHidden(hidden);
    return { setHidden, isHidden: () => hidden };
  }

  global.PerseusNavigation = Object.freeze({ renderBrowseNavigation, initCollapsibleNavigation });
}(window));
