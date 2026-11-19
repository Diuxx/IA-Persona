/** Keyboard-accessible two-panel navigation, independent of the particle engine. */
function initializePersonaTabs() {
  const viewport = document.querySelector('#controls-viewport');
  const tabs = [...document.querySelectorAll('[data-panel-target]')];
  if (!viewport || tabs.length === 0) throw new Error('Onglets de contrôle introuvables.');

  function activate(targetId, focus = false) {
    for (const tab of tabs) {
      const active = tab.dataset.panelTarget === targetId;
      const panel = document.getElementById(tab.dataset.panelTarget);
      if (!panel) throw new Error(`Panneau introuvable : ${tab.dataset.panelTarget}`);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panel.hidden = !active;
      if (active && focus) tab.focus();
    }
    viewport.scrollTop = 0;
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.panelTarget));
    tab.addEventListener('keydown', event => {
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!offset && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
          : (index + offset + tabs.length) % tabs.length;
      activate(tabs[next].dataset.panelTarget, true);
    });
  });
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initializePersonaTabs };
} else {
  window.initializePersonaTabs = initializePersonaTabs;
}
