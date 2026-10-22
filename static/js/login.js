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

    // ── Modo oscuro ──
    (function () {
      const root = document.documentElement;
      const toggleBtn = document.getElementById('themeToggle');
      const icon = toggleBtn ? toggleBtn.querySelector('i') : null;

      function applyTheme(theme) {
        root.setAttribute('data-bs-theme', theme);
        if (icon) {
          icon.classList.toggle('fa-moon', theme === 'light');
          icon.classList.toggle('fa-sun', theme === 'dark');
        }
      }

      applyTheme(localStorage.getItem('ht-theme') || 'light');

      if (toggleBtn) {
        toggleBtn.addEventListener('click', function () {
          const next = root.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
          localStorage.setItem('ht-theme', next);
          applyTheme(next);
        });
      }
    })();