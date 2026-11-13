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
    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');
    const logoText = document.querySelector('.logo-text'); // Si manejas el texto superior dinámico

    if (loginView.style.display === 'none') {
        // Estamos en Registro -> Volver al Login
        loginView.style.display = 'block';
        registerView.style.display = 'none';
    } else {
        // Estamos en Login -> Ir al Registro
        loginView.style.display = 'none';
        registerView.style.display = 'block';
    }
}

// Función inteligente para la flecha de atrás
function handleBack() {
    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');

    // Comprobamos cuál de los dos formularios está visible actualmente en la pantalla
    const isRegisterVisible = registerView && registerView.style.display !== 'none';

    if (isRegisterVisible) {
        // Si estamos viendo el formulario de Registro, la flecha nos devuelve al Login
        registerView.style.display = 'none';
        loginView.style.display = 'block';
    } else {
        // Si estamos viendo el formulario de Login, la flecha nos manda directo al Home
        window.location.href = homeUrl;
    }
}