// theme.js — Modo oscuro global para las páginas de autenticación (base_auth.html)
// Único responsable del tema: aplica el guardado, cambia con el botón y sincroniza el icono.
// Comparte la clave 'ht-theme' con el home y el panel de administración.
(function () {
  var root = document.documentElement;
  var KEY = 'ht-theme';

  function getTheme() {
    try { return localStorage.getItem(KEY) || 'light'; } catch (e) { return 'light'; }
  }

  function syncIcons(theme) {
    document.querySelectorAll('#themeToggle i, [data-theme-toggle] i').forEach(function (icon) {
      icon.classList.toggle('fa-moon', theme === 'light');
      icon.classList.toggle('fa-sun', theme === 'dark');
    });
  }

  function applyTheme(theme) {
    root.setAttribute('data-bs-theme', theme);
    syncIcons(theme);
  }

  // 1) Se aplica en el <head>, antes de pintar la página (sin parpadeo blanco)
  applyTheme(getTheme());

  // 2) Clic en el botón (delegado: funciona aunque el botón aún no exista al cargar)
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#themeToggle, [data-theme-toggle]')) return;
    var next = root.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (err) {}
    applyTheme(next);
  });

  // 3) Cuando el DOM esté listo, sincroniza el icono (sol/luna)
  document.addEventListener('DOMContentLoaded', function () { syncIcons(getTheme()); });

  // 4) Si el tema cambia en otra pestaña (home, admin), se actualiza aquí también
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) applyTheme(getTheme());
  });
})();