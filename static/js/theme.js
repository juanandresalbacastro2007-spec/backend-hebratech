// 1. Aplica el tema guardado o el del sistema inmediatamente para evitar destellos
(function () {
  const savedTheme = localStorage.getItem('theme');
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = savedTheme || systemTheme;
  document.documentElement.setAttribute('data-bs-theme', theme);
})();

// 2. Escucha el clic en CUALQUIER botón de cambio de tema
document.addEventListener('DOMContentLoaded', () => {
  const currentTheme = document.documentElement.getAttribute('data-bs-theme');
  
  const updateButtons = (theme) => {
    const buttons = document.querySelectorAll('.theme-toggle-btn');
    buttons.forEach(btn => {
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = theme === 'dark' ? 'fas fa-sun text-warning' : 'fas fa-moon';
      }
    });
  };

  updateButtons(currentTheme);

  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.theme-toggle-btn');
    if (!toggleBtn) return;

    const activeTheme = document.documentElement.getAttribute('data-bs-theme');
    const newTheme = activeTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-bs-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateButtons(newTheme);
  });
});