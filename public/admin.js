
let at = localStorage.getItem('mea_admin_token') || '';
let snapshot = null;

const $ = id => document.getElementById(id);

function toast(s) {
  const t = $('toast');
  t.textContent = s;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function api(url, method = 'GET', body) {
  const r = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(at ? { authorization: 'Bearer ' + at } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const d = await r.json();
  if (!r.ok) throw Error(d.error || 'Request failed');
  return d;
}

$('adminForm').onsubmit = async e => {
  e.preventDefault();

  try {
    const d = await api('/api/admin/login', 'POST', {
      username: $('adminUser').value,
      password: $('adminPass').value
    });

    at = d.token;
    localStorage.setItem('mea_admin_token', at);
    await loadAdmin();
  } catch (e) {
    toast(e.message);
  }
};

async function loadAdmin() {
  try {
    snapshot = await api('/api/admin/overview');

    $('adminLogin').classList.add('hidden');
    $('adminApp').classList.remove('hidden');

    render();
  } catch (e) {
    if (at) {
      at = '';
      localStorage.removeItem('mea_admin_token');
    }

    $('adminLogin').classList.remove('hidden');
    $('adminApp').classList.add('hidden');
  }
}

function render() {
  const s = snapshot;

  $('usersCount').textContent = s.stats.users;
  $('pendingCount').textContent = s.stats.pending;
  $('earnedTotal').textContent =
    '₹' + Number(s.stats.totalDemoEarned).toFixed(2);
  $('txCount').textContent = s.ledger.length;

  // DEPOSIT REQUESTS
  const deposits = s.deposits || [];

  $('depositRows').innerHTML = deposits.length
    ? deposits.map(d => `
      <tr>
        <td>${esc(d.name)}<br><small>${esc(d.phone)}</small></td>
        <td>${Number(d.usdt).toFixed(2)} USDT</td>
        <td>₹${Number(d.inrAmount).toFixed(2)}</td>
        <td>${esc(d.reference)}</td>
        <td>${esc(d.status)}</td>
        <td>
          ${d.status === 'pending' ? `
            <button class="btn primary"
              onclick="decideDeposit('${d.id}','approve')">Approve</button>
            <button class="btn"
              onclick="decideDeposit('${d.id}','reject')">Reject</button>
          ` : '—'}
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="6">कोई deposit request नहीं।</td></tr>';

  // WITHDRAWALS
  $('withdrawRows').innerHTML = s.withdrawals.length
    ? s.withdrawals.map(w => `
      <tr>
        <td>${esc(w.name)}<br><small>${esc(w.phone)}</small></td>
        <td>₹${Number(w.amount).toFixed(2)}</td>
        <td>${esc(w.upi)}</td>
        <td>${esc(w.status)}</td>
        <td>
          ${w.status === 'pending' ? `
            <button class="btn primary"
              onclick="decide('${w.id}','approve')">Approve</button>
            <button class="btn"
              onclick="decide('${w.id}','reject')">Reject</button>
          ` : '—'}
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="5">कोई request नहीं।</td></tr>';

  // USERS
  $('userRows').innerHTML = s.users.length
    ? s.users.map(u => `
      <tr>
        <td>${esc(u.name)}<br><small>${esc(u.phone)}</small></td>
        <td>₹${Number(u.balance).toFixed(2)}</td>
        <td>${u.coins}</td>
        <td><button class="btn" onclick="credit('${u.id}')">Add</button></td>
      </tr>
    `).join('')
    : '<tr><td colspan="4">अभी कोई user नहीं।</td></tr>';

  // TASKS
  $('taskRows').innerHTML = s.tasks.map(t => `
    <div class="task-setting">
      <div>
        <b>${esc(t.title)}</b><br>
        <small class="muted">${t.active ? 'Active' : 'Paused'}</small>
      </div>
      <input type="number" min="1" max="10000"
        id="coins-${esc(t.id)}" value="${t.coins}">
      <button class="btn"
        onclick="saveTask('${esc(t.id)}',${!t.active})">
        ${t.active ? 'Pause' : 'Activate'}
      </button>
      <button class="btn primary"
        onclick="saveTask('${esc(t.id)}',null)">Save coins</button>
    </div>
  `).join('');

  // LEDGER
  $('ledgerRows').innerHTML = s.ledger.length
    ? s.ledger.map(t => `
      <tr>
        <td>${esc(t.type)}</td>
        <td>₹${Number(t.amount).toFixed(2)}</td>
        <td>${esc(t.status)}</td>
        <td>${new Date(t.createdAt).toLocaleDateString('en-IN')}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4">No ledger entries</td></tr>';
}

async function decideDeposit(id, action) {
  if (!confirm(action === 'approve'
    ? 'क्या इस DEMO deposit को approve करना है?'
    : 'क्या इस DEMO deposit को reject करना है?')) return;

  try {
    await api('/api/admin/deposit', 'POST', { id, action });
    await loadAdmin();
    toast(action === 'approve'
      ? 'Demo deposit approved'
      : 'Demo deposit rejected');
  } catch (e) {
    toast(e.message);
  }
}

async function decide(id, action) {
  try {
    await api('/api/admin/withdrawal', 'POST', { id, action });
    await loadAdmin();
    toast(action === 'approve'
      ? 'Request demo-approved'
      : 'Request rejected and demo balance refunded');
  } catch (e) {
    toast(e.message);
  }
}

async function credit(userId) {
  const coins = Number(prompt('कितने demo coins जोड़ने हैं?', '100'));
  if (!Number.isInteger(coins) || coins < 1) return;

  try {
    await api('/api/admin/credit', 'POST', { userId, coins });
    await loadAdmin();
    toast('Demo coins added');
  } catch (e) {
    toast(e.message);
  }
}

async function saveTask(id, active) {
  const coins = Number($('coins-' + id).value);

  try {
    await api('/api/admin/task', 'POST', {
      id,
      coins,
      ...(active === null ? {} : { active })
    });

    await loadAdmin();
    toast('Task settings saved');
  } catch (e) {
    toast(e.message);
  }
}

function adminLogout() {
  at = '';
  localStorage.removeItem('mea_admin_token');
  $('adminApp').classList.add('hidden');
  $('adminLogin').classList.remove('hidden');
}

if (at) loadAdmin();
