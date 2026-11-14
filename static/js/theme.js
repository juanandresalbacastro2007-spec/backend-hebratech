// theme.js — ÚNICO responsable del modo oscuro (home, login, recuperar, términos, etc.)
// - Aplica el tema guardado antes de pintar (sin parpadeo).
// - Maneja el clic del botón #themeToggle (solo existe en home y login).
// - Es seguro cargarlo dos veces: no duplica listeners.
(function () {
  if (window.__htThemeInit) return;
  window.__htThemeInit = true;

  var root = document.documentElement;
  var KEY = 'ht-theme';

  function getTheme() {
    try { return localStorage.getItem(KEY) || 'light'; } catch (e) { return 'light'; }
  }

  function syncIcons(theme) {
    document.querySelectorAll('#themeToggle i, [data-theme-toggle] i').forEach(function (icon) {
      if (icon.classList.contains('bi')) {            // Bootstrap Icons
        icon.classList.toggle('bi-moon-fill', theme === 'light');
        icon.classList.toggle('bi-sun-fill', theme === 'dark');
      } else {                                         // Font Awesome
        icon.classList.toggle('fa-moon', theme === 'light');
        icon.classList.toggle('fa-sun', theme === 'dark');
      }
    });
  }

  function applyTheme(theme) {
    root.setAttribute('data-bs-theme', theme);
    syncIcons(theme);
  }

  applyTheme(getTheme());

  document.addEventListener('click', function (e) {
    if (!e.target.closest('#themeToggle, [data-theme-toggle]')) return;
    var next = root.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (err) {}
    applyTheme(next);
  });

  document.addEventListener('DOMContentLoaded', function () { syncIcons(getTheme()); });

  // Al volver con el botón "atrás" (página restaurada desde caché) se re-aplica el tema guardado
  window.addEventListener('pageshow', function () { applyTheme(getTheme()); });

  // Si cambia en otra pestaña
  window.addEventListener('storage', function (e) { if (e.key === KEY) applyTheme(getTheme()); });
})();