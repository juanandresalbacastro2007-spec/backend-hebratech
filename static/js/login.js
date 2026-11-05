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

// El modo oscuro lo maneja js/theme.js (cargado globalmente desde base_auth.html).