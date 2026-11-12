const overlay = document.getElementById('overlay');
const countdown = document.getElementById('countdown');
const charges = document.getElementById('charges');

function reveal(el, shown) {
    if (!el) return;
    el.classList.toggle('hidden', !shown);
    el.style.display = shown ? 'flex' : 'none';
}

reveal(overlay, false);
reveal(countdown, false);

function starText(count) {
    const filled = Math.max(1, Math.min(5, Number(count) || 1));
    let text = '';
    for (let i = 1; i <= 5; i += 1) {
        text += i <= filled ? '★' : '☆';
    }
    return text;
}

function show(data) {
    document.getElementById('department').textContent = data.department || 'Police';
    document.getElementById('citation-id').textContent = data.id || '';
    document.getElementById('officer').textContent = data.officer || '';
    document.getElementById('badge').textContent = data.badge ? String(data.badge) : '';
    document.getElementById('street').textContent = data.street || '—';
    document.getElementById('detail').textContent = data.detail || '';
    document.getElementById('total').textContent = data.total || '';
    document.getElementById('status').textContent = data.status || '';
    document.getElementById('stars').textContent = starText(data.stars || 1);
    const warning = document.getElementById('warning');
    if (data.warning) {
        warning.textContent = data.warning;
        warning.classList.remove('hidden');
        warning.style.display = 'block';
    } else {
        warning.textContent = '';
        warning.classList.add('hidden');
        warning.style.display = 'none';
    }
    charges.innerHTML = '';
    (data.charges || []).forEach(function (charge) {
        const item = document.createElement('li');
        const name = document.createElement('span');
        const amount = document.createElement('strong');
        name.textContent = charge.label || 'Fine';
        amount.textContent = charge.amount || '';
        item.appendChild(name);
        item.appendChild(amount);
        charges.appendChild(item);
    });
    reveal(overlay, true);
    reveal(countdown, false);
}

function hide() {
    reveal(overlay, false);
}

window.addEventListener('message', function (event) {
    const data = event.data || {};
    if (data.action === 'citation') show(data);
    if (data.action === 'close') hide();
    if (data.action === 'countdown') {
        document.getElementById('count-num').textContent = String(data.seconds ?? '');
        reveal(countdown, true);
    }
    if (data.action === 'countdown-close') reveal(countdown, false);
});

document.getElementById('sign').addEventListener('click', function () {
    if (overlay.classList.contains('hidden')) return;
    hide();
    fetch('https://' + GetParentResourceName() + '/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
});

document.addEventListener('keydown', function (event) {
    if (overlay.classList.contains('hidden')) return;
    if (event.key === 'Escape' || event.key === 'Enter') {
        document.getElementById('sign').click();
    }
});
