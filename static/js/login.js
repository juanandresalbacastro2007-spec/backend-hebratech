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
});


// Mostrar / ocultar contraseña (el ojito)
function togglePass(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const icon = input.parentElement.querySelector('.toggle-password');
    const mostrar = input.type === 'password';

    input.type = mostrar ? 'text' : 'password';

    if (icon) {
        icon.classList.toggle('fa-eye', !mostrar);
        icon.classList.toggle('fa-eye-slash', mostrar);
    }
}


function switchAuth() {
    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');

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

// Flecha de atrás: es un <a href="home"> normal (funciona aunque falle el JS).
// Si el formulario de registro está visible, en vez de ir al home vuelve al login.
document.addEventListener('DOMContentLoaded', function () {
    const back = document.getElementById('backArrowBtn');
    if (!back) return;

    back.addEventListener('click', function (e) {
        const loginView = document.getElementById('login-view');
        const registerView = document.getElementById('register-view');
        if (!loginView || !registerView) return;

        const registroVisible = window.getComputedStyle(registerView).display !== 'none';
        if (registroVisible) {
            e.preventDefault();
            registerView.style.display = 'none';
            loginView.style.display = 'block';
        }
    });
});