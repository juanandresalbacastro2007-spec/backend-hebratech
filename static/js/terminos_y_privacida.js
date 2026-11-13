document.addEventListener('DOMContentLoaded', function () {
        // Reloj
        function updateClock() {
          const clockElement = document.getElementById('clockText')
          if (!clockElement) return
          const now = new Date()
          const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }
          clockElement.textContent = now.toLocaleTimeString('es-CO', options)
        }
        updateClock()
        setInterval(updateClock, 1000)

        // ── Modo oscuro / claro ──
        const root = document.documentElement
        const btn = document.getElementById('themeToggle')
        const icon = document.getElementById('themeIcon')

        function applyTheme(theme) {
          root.setAttribute('data-bs-theme', theme)
          if (icon) {
            icon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill'
          }
          localStorage.setItem('ht-theme', theme)
        }

        applyTheme(localStorage.getItem('ht-theme') || 'light')

        if (btn) {
          btn.addEventListener('click', function () {
            const current = root.getAttribute('data-bs-theme')
            const next = current === 'dark' ? 'light' : 'dark'
            applyTheme(next)
          })
        }
      })