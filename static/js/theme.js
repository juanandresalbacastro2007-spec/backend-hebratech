// static/js/theme.js
// ─────────────────────────────────────────────────────────
// 1. Aplica el tema guardado o el del sistema ANTES de pintar
//    la página (evita el "flash" de tema equivocado).
(function () {
  const savedTheme = localStorage.getItem('theme');
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = savedTheme || systemTheme;
  document.documentElement.setAttribute('data-bs-theme', theme);
})();

// 2. Cuando el DOM esté listo: sincroniza el ícono de todos los
//    botones .theme-toggle-btn que existan en la página, y
//    escucha los clics en cualquiera de ellos (delegación en document,
//    así funciona aunque el botón se inyecte dinámicamente).
document.addEventListener('DOMContentLoaded', () => {
  const updateButtons = (theme) => {
    document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
      const icon = btn.querySelector('i');
      if (!icon) return;
      icon.className = theme === 'dark'
        ? 'bi bi-sun-fill'          // en oscuro, muestra sol (para volver a claro)
        : 'bi bi-moon-stars-fill';  // en claro, muestra luna (para ir a oscuro)
    });
  };

  updateButtons(document.documentElement.getAttribute('data-bs-theme'));

  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.theme-toggle-btn');
    if (!toggleBtn) return;

    const activeTheme = document.documentElement.getAttribute('data-bs-theme');
    const newTheme = activeTheme === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-bs-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateButtons(newTheme);
  });

  // 3. Si el usuario NO ha elegido manualmente un tema (no hay
  //    valor guardado), sigue el tema del sistema operativo en vivo.
  if (!localStorage.getItem('theme')) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      const theme = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-bs-theme', theme);
      updateButtons(theme);
    });
  }
});