document.addEventListener('DOMContentLoaded', function () {
    // Reloj
    function updateClock() {
        const clockElement = document.getElementById('clockText');
        if (!clockElement) return;
        const now = new Date();
        const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
        clockElement.textContent = now.toLocaleTimeString('es-CO', options);
    }
    updateClock();
    setInterval(updateClock, 1000);

    // ── Modo oscuro / claro ──
    const root = document.documentElement;
    const btn = document.getElementById('themeToggle');
    const icon = document.getElementById('themeIcon');

    function applyTheme(theme) {
        root.setAttribute('data-bs-theme', theme);
        if (icon) {
            icon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
        }
        localStorage.setItem('ht-theme', theme);
    }

    // Aplicar el tema guardado o por defecto 'light'
    applyTheme(localStorage.getItem('ht-theme') || 'light');

    if (btn) {
        btn.addEventListener('click', function () {
            const current = root.getAttribute('data-bs-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            applyTheme(next);
        });
    }
});


function switchAuth() {
      const login = document.getElementById('login-view');
      const register = document.getElementById('register-view');
      const isLoginVisible = window.getComputedStyle(login).display !== 'none';
      if (isLoginVisible) {
        login.style.display = 'none';
        register.style.display = 'block';
      } else {
        login.style.display = 'block';
        register.style.display = 'none';
      }
    }

    function togglePass(id) {
      const input = document.getElementById(id);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    }
