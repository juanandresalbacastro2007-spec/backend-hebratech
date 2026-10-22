// home.js

// ── Smooth scroll para links ancla del navbar ──
document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', function (e) {
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;
        const target = document.querySelector(targetId);
        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Cierra el menú móvil si está abierto
            const navCollapse = document.querySelector('#mainNav');
            if (navCollapse && navCollapse.classList.contains('show')) {
                const toggler = document.querySelector('.navbar-toggler');
                toggler && toggler.click();
            }
        }
    });
});

// ── Intersection Observer para animaciones de aparición ──
const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
        if (e.isIntersecting) {
            e.target.classList.add('in-view');
            e.target.classList.add('visible');
        }
    });
}, { threshold: 0.15 });

document.querySelectorAll('.stat-card, .feat-card, .how-step, .fd-kpi, .fade-up').forEach(el => observer.observe(el));