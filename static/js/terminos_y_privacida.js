function switchAuth() {
      const login = document.getElementById('terminos-view');
      const register = document.getElementById('register-view');
      const isLoginVisible = window.getComputedStyle(terminosView).display !== 'none';
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

// El modo oscuro lo maneja js/theme.js (cargado globalmente desde base_auth.html).

function switchAuth() {
      const login = document.getElementById('privacidad-view');
      const register = document.getElementById('register-view');
      const isLoginVisible = window.getComputedStyle(politicas_de_privacidad).display !== 'none';
      if (isLoginVisible) {// ===== Tema claro / oscuro para Términos y Privacidad =====
const THEME_KEY = 'hebratech-theme';

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  const icono = document.querySelector('#themeToggle i');
  if (icono) icono.className = tema === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  try { localStorage.setItem(THEME_KEY, tema); } catch (e) {}
}

function leerTema() {
  try {
    const guardado = localStorage.getItem(THEME_KEY);
    if (guardado) return guardado;
  } catch (e) {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function activarBotonTema() {
  aplicarTema(leerTema());
  const boton = document.getElementById('themeToggle');
  if (!boton) return;
  boton.addEventListener('click', () => {
    const actual = document.documentElement.getAttribute('data-theme');
    aplicarTema(actual === 'dark' ? 'light' : 'dark');
  });
}

// Una función por página (hacen lo mismo, cada página llama la suya)
function initTerminos()   { activarBotonTema(); }
function initPrivacidad() { activarBotonTema(); }
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