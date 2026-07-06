document.addEventListener("DOMContentLoaded", function() {
    initParticles();
    initNavScroll();
    initPageLinks();
});

function initParticles() {
    const canvas = document.getElementById("particleCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let particles = [];
    let w = 0;
    let h = 0;

    function resize() {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
    }

    function createParticles() {
        particles = [];
        const count = Math.min(80, Math.floor(w / 14));
        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * w,
                y: Math.random() * h,
                r: Math.random() * 2 + 0.5,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                a: Math.random() * 0.5 + 0.2
            });
        }
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        particles.forEach(function(p) {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0) p.x = w;
            if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h;
            if (p.y > h) p.y = 0;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(120, 180, 255, " + p.a + ")";
            ctx.fill();
        });
        requestAnimationFrame(draw);
    }

    resize();
    createParticles();
    draw();
    window.addEventListener("resize", function() {
        resize();
        createParticles();
    });
}

function initNavScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function(link) {
        link.addEventListener("click", function(e) {
            const id = link.getAttribute("href");
            if (!id || id === "#") return;
            const target = document.querySelector(id);
            if (!target) return;
            e.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
}

function navigateToLogin(tab) {
    const body = document.body;
    body.classList.add("page-exit");
    if (tab) {
        sessionStorage.setItem("securebank_auth_tab", tab);
    }
    sessionStorage.setItem("securebank_page_transition", "1");
    setTimeout(function() {
        window.location.href = "login.html";
    }, 420);
}

function initPageLinks() {
    document.querySelectorAll("[data-go-login]").forEach(function(el) {
        el.addEventListener("click", function(e) {
            e.preventDefault();
            navigateToLogin(el.dataset.goLogin || "");
        });
    });
}
