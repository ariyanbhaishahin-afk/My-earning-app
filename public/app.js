
const $ = id => document.getElementById(id);

let mode = 'register';
let token = localStorage.getItem('mea_token') || '';
let me = null;
let cache = null;

function toast(s) {
  const t = $('toast');
  if (!t) {
    alert(s);
    return;
  }
  t.textContent = s;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(url, method = 'GET', body) {
  const r = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const d = await r.json();

  if (!r.ok) throw Error(d.error || 'Request failed');

  return d;
}

function setMode(m) {
  mode = m;

  $('regTab').classList.toggle('selected', m === 'register');
  $('loginTab').classList.toggle('selected', m === 'login');

  $('name').classList.toggle('hidden', m === 'login');
  $('name').required = m === 'register';

  $('ref').classList.toggle('hidden', m === 'login');
  $('refLabel').classList.toggle('hidden', m === 'login');

  $('authSubmit').textContent =
    m === 'register' ? 'अकाउंट बनाएं' : 'लॉगिन करें';
}

$('authForm').onsubmit = async e => {
  e.preventDefault();

  const phone = $('phone').value.replace(/\D/g, '');

  if (phone.length !== 10) {
    toast('कृपया 10 अंकों का मोबाइल नंबर डालें');
    return;
  }

  toast('कृपया इंतजार करें...');

  try {
    const d = await api('/api/' + mode, 'POST', {
      name: $('name').value.trim(),
      phone: phone,
      referralCode: $('ref').value.trim()
    });

    token = d.token;
    localStorage.setItem('mea_token', token);

    await refresh();

  } catch (e) {
    toast('Login/Register Error: ' + e.message);
  }
};

async function refresh() {
  try {
    cache = await api('/api/me');
    me = cache.user;

    if (!me) throw Error('User data नहीं मिला');

    if (!Array.isArray(me.claimed)) me.claimed = [];
    if (!Array.isArray(cache.tasks)) cache.tasks = [];
    if (!Array.isArray(cache.transactions)) cache.transactions = [];
    if (!Array.isArray(cache.withdrawals)) cache.withdrawals = [];

    render();

    $('auth').classList.add('hidden');
    $('app').classList.remove('hidden');

    return true;

  } catch (e) {
    if (token) {
      token = '';
      localStorage.removeItem('mea_token');
    }

    $('auth').classList.remove('hidden');
    $('app').classList.add('hidden');

    toast('Error: ' + e.message);
    return false;
  }
}

function money(n) {
  return Number(n || 0).toFixed(2);
}

function render() {
  const u = me;

  $('userName').textContent = u.name || '';
  $('balance').textContent = money(u.balance);
  $('walletBalance').textContent = money(u.balance);
  $('earned').textContent = money(u.earned);
  $('coins').textContent = u.coins || 0;
  $('refCode').textContent = u.referralCode || '';
  $('inviteUrl').textContent =
    location.origin + '/?ref=' + (u.referralCode || '');

  renderTasks();

  $('ledger').innerHTML = cache.transactions.length
    ? cache.transactions.map(t =>
        `<tr>
          <td>${esc(t.type)}</td>
          <td>${t.coins || 0}</td>
          <td>₹${money(t.amount)}</td>
          <td><span class="pill ${statusClass(t.status)}">${esc(t.status)}</span></td>
        </tr>`
      ).join('')
    : '<tr><td colspan="4">अभी कोई transaction नहीं।</td></tr>';

  $('withdrawals').innerHTML = cache.withdrawals.length
    ? cache.withdrawals.map(w =>
        `<div class="task">
          <b>₹${money(w.amount)}</b> • ${esc(w.status)}
          <p>${esc(w.upi)} • ${w.createdAt ? new Date(w.createdAt).toLocaleString('en-IN') : ''}</p>
        </div>`
      ).join('')
    : '<p class="muted">अभी कोई withdrawal request नहीं।</p>';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function statusClass(s) {
  s = String(s || '');

  return s.includes('reject')
    ? 'rejected'
    : s.includes('pending') ? 'pending' : 'success';
}

function renderTasks() {
  const tasks = Array.isArray(cache.tasks) ? cache.tasks : [];
  const claimed = Array.isArray(me.claimed) ? me.claimed : [];

  const html = tasks.map(t => {
    const done = claimed.includes(t.id);

    return `<article class="task">
      <div class="emoji">${t.id === 'daily' ? '📅' : t.id === 'offer' ? '🎯' : '⭐'}</div>
      <h3>${esc(t.title)}</h3>
      <p>${esc(t.description)}</p>
      <div class="reward">🪙 ${t.coins || 0} coins</div>
      <button class="btn ${done ? 'ghost' : 'primary'}"
        ${done ? 'disabled' : ''}
        onclick="claim('${esc(t.id)}')">
        ${done ? 'Claimed' : 'Claim reward'}
      </button>
    </article>`;
  }).join('');

  $('homeTasks').innerHTML =
    html || '<p class="muted">अभी कोई task उपलब्ध नहीं।</p>';

  $('allTasks').innerHTML = html;
}

async function claim(id) {
  try {
    await api('/api/claim', 'POST', { taskId: id });
    await refresh();
    toast('Demo reward coins जोड़े गए');
  } catch (e) {
    toast(e.message);
  }
}

function openWithdraw() {
  $('amount').max = me.balance;
  $('modal').classList.remove('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
}

$('withdrawForm').onsubmit = async e => {
  e.preventDefault();

  try {
    await api('/api/withdraw', 'POST', {
      amount: Number($('amount').value),
      upi: $('upi').value.trim()
    });

    closeModal();
    await refresh();
    showView('wallet');
    toast('Demo request admin panel में भेज दी गई');

  } catch (e) {
    toast(e.message);
  }
};

async function copyCode() {
  try {
    await navigator.clipboard.writeText(me.referralCode);
    toast('Referral code copied');
  } catch {
    toast('Code: ' + me.referralCode);
  }
}

function showView(v) {
  document.querySelectorAll('.view').forEach(x =>
    x.classList.add('hidden')
  );

  $('view-' + v).classList.remove('hidden');

  document.querySelectorAll('.nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === v)
  );
}

document.querySelectorAll('.nav button').forEach(b => {
  b.onclick = () => showView(b.dataset.view);
});

function logout() {
  token = '';
  localStorage.removeItem('mea_token');
  me = null;

  $('app').classList.add('hidden');
  $('auth').classList.remove('hidden');
}

const params = new URLSearchParams(location.search);

if (params.get('ref')) {
  $('ref').value = params.get('ref');
}

if (token) refresh();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
