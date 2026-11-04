'use strict';

const $ = id => document.getElementById(id);

let mode = 'register';
let token = localStorage.getItem('mea_token') || '';
let me = null;
let cache = null;

function toast(message) {
  const t = $('toast');
  if (!t) {
    alert(message);
    return;
  }
  t.textContent = message;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Add fields required by the server and existing account system.
function addField(id, labelText, placeholder, type = 'text') {
  if ($(id)) return $(id);

  const wrapper = document.createElement('div');
  wrapper.id = id + 'Field';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;

  const input = document.createElement('input');
  input.id = id;
  input.name = id;
  input.type = type;
  input.placeholder = placeholder;
  input.required = true;

  if (id === 'pin' || id === 'withdrawPin') {
    input.inputMode = 'numeric';
    input.maxLength = 6;
  }

  wrapper.append(label, input);

  const form = id === 'withdrawPin' ? $('withdrawForm') : $('authForm');
  const submit = form.querySelector('button[type="submit"], button:not([type])');
  form.insertBefore(wrapper, submit);

  return input;
}

const passwordInput = addField(
  'password',
  'Password',
  'Create a password (minimum 8 characters)',
  'password'
);

const pinInput = addField(
  'pin',
  'Security PIN',
  'Create 4 to 6 digit Security PIN',
  'password'
);

const withdrawPinInput = addField(
  'withdrawPin',
  'Security PIN',
  'Enter your 4 to 6 digit Security PIN',
  'password'
);

// Group name and referral fields so they can be hidden during login.
function wrapField(id, wrapperId) {
  const input = $(id);
  if (!input || $(wrapperId)) return;

  const label = input.previousElementSibling;
  const wrapper = document.createElement('div');
  wrapper.id = wrapperId;

  input.parentNode.insertBefore(wrapper, label || input);
  if (label && label.tagName === 'LABEL') wrapper.appendChild(label);
  wrapper.appendChild(input);
}

wrapField('name', 'nameField');
wrapField('ref', 'refField');

function setMode(selectedMode) {
  mode = selectedMode;

  $('regTab').classList.toggle('selected', mode === 'register');
  $('loginTab').classList.toggle('selected', mode === 'login');

  $('nameField').classList.toggle('hidden', mode === 'login');
  $('refField').classList.toggle('hidden', mode === 'login');
  $('pinField').classList.toggle('hidden', mode === 'login');

  $('name').required = mode === 'register';
  $('pin').required = mode === 'register';

  $('password').autocomplete =
    mode === 'login' ? 'current-password' : 'new-password';

  $('password').placeholder =
    mode === 'login' ? 'Enter your password' : 'Create a password (minimum 8 characters)';

  $('authHeading').textContent =
    mode === 'login' ? 'Welcome Back!' : 'Create Your Account';

  $('authDescription').textContent =
    mode === 'login'
      ? 'Login to continue your journey.'
      : 'Join HUNTER PAY and start your rewards journey.';

  $('authSubmit').textContent =
    mode === 'login' ? 'Login' : 'Create Account';
}

$('authForm').addEventListener('submit', async event => {
  event.preventDefault();

  const phone = $('phone').value.replace(/\D/g, '');
  const password = $('password').value;

  if (phone.length !== 10) {
    toast('Enter a valid 10-digit mobile number.');
    return;
  }

  if (mode === 'register') {
    if ($('name').value.trim().length < 2) {
      toast('Enter your full name.');
      return;
    }

    if (password.length < 8) {
      toast('Password must contain at least 8 characters.');
      return;
    }

    if (!/^\d{4,6}$/.test($('pin').value)) {
      toast('Security PIN must contain 4 to 6 digits.');
      return;
    }
  }

  if (!password) {
    toast('Enter your password.');
    return;
  }

  $('authSubmit').disabled = true;

  try {
    const body = mode === 'register'
      ? {
          name: $('name').value.trim(),
          phone,
          password,
          pin: $('pin').value,
          referral: $('ref').value.trim()
        }
      : { phone, password };

    const data = await api('/api/' + mode, 'POST', body);

    token = data.token;
    localStorage.setItem('mea_token', token);

    const success = await refresh();

    if (success) {
      toast(mode === 'register'
        ? 'Account created successfully.'
        : 'Login successful.');
    }
  } catch (error) {
    toast(error.message);
  } finally {
    $('authSubmit').disabled = false;
  }
});

function money(value) {
  return Number(value || 0).toFixed(2);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function statusClass(status) {
  status = String(status || '').toLowerCase();
  return status.includes('reject')
    ? 'rejected'
    : status.includes('pending')
      ? 'pending'
      : 'success';
}

async function refresh() {
  try {
    cache = await api('/api/me');if (!Array.isArray(cache.deposits)) cache.deposits = [];
    me = cache.user;

    if (!me) throw new Error('User data not found.');

    if (!Array.isArray(cache.tasks)) cache.tasks = [];
    if (!Array.isArray(cache.withdrawals)) cache.withdrawals = [];
    if (!Array.isArray(cache.ledger)) cache.ledger = [];
    if (!Array.isArray(me.claimedTasks)) me.claimedTasks = [];

    render();

    $('auth').classList.add('hidden');
    $('app').classList.remove('hidden');

    return true;
  } catch (error) {
    token = '';
    localStorage.removeItem('mea_token');
    me = null;
    cache = null;

    $('auth').classList.remove('hidden');
    $('app').classList.add('hidden');

    toast(error.message);
    return false;
  }
}

function render() {
  $('userName').textContent = me.name || 'User';
  $('balance').textContent = money(me.balance);
  $('walletBalance').textContent = money(me.balance);
  $('earned').textContent = money(me.earned);
  $('coins').textContent = Number(me.earned || 0);
  $('refCode').textContent = me.referralCode || '—';

  $('inviteUrl').textContent =
    location.origin + '/?ref=' + (me.referralCode || '');

  renderTasks();

  $('ledger').innerHTML = cache.ledger.length
    ? cache.ledger.map(item => `
        <tr>
          <td>${esc(item.title)}</td>
          <td>${Number(item.amount || 0)}</td>
          <td>₹${money(item.balance)}</td>
          <td><span class="pill ${statusClass(item.status)}">${esc(item.status)}</span></td>
        </tr>
      `).join('')
    : '<tr><td colspan="4">No transactions yet.</td></tr>';

  $('withdrawals').innerHTML = cache.withdrawals.length
    ? cache.withdrawals.map(item => `
        <div class="task">
          <b>₹${money(item.amount)}</b>
          <p>${esc(item.upi || '')}</p>
          <span class="pill ${statusClass(item.status)}">${esc(item.status)}</span>
        </div>
      `).join('')
    : '<p class="muted">No withdrawal requests yet.</p>';
}

function renderTasks() {
  const tasks = cache.tasks.filter(task =>
    task.id !== 'daily' && task.active !== false
  );

  const claimed = me.claimedTasks || [];

  const html = tasks.map(task => {
    const done = claimed.includes(task.id);

    return `
      <article class="task">
        <div class="emoji">⭐</div>
        <h3>${esc(task.title)}</h3>
        <p>${esc(task.description)}</p>
        <div class="reward">🪙 ${Number(task.coins || 0)} coins</div>
        <button class="btn ${done ? 'ghost' : 'primary'}"
          data-task-id="${esc(task.id)}" ${done ? 'disabled' : ''}>
          ${done ? 'Claimed' : 'Claim Reward'}
        </button>
      </article>
    `;
  }).join('');

  $('homeTasks').innerHTML = html || '<p class="muted">No tasks available right now.</p>';
  $('allTasks').innerHTML = html || '<p class="muted">No tasks available right now.</p>';

  document.querySelectorAll('[data-task-id]').forEach(button => {
    button.addEventListener('click', () => claim(button.dataset.taskId));
  });
}

async function claim(taskId) {
  try {
    await api('/api/claim', 'POST', { taskId });
    await refresh();
    toast('Demo reward claimed successfully.');
  } catch (error) {
    toast(error.message);
  }
}

function showView(viewName) {
  document.querySelectorAll('.view').forEach(view => {
    view.classList.add('hidden');
  });

  const selected = $('view-' + viewName);
  if (selected) selected.classList.remove('hidden');

  document.querySelectorAll('.nav button').forEach(button => {
    button.classList.toggle('active', button.dataset.view === viewName);
  });
}

document.querySelectorAll('.nav button').forEach(button => {
  button.addEventListener('click', () => showView(button.dataset.view));
});

function openWithdraw() {
  if (!me) return;

  $('amount').max = Number(me.balance || 0);
  $('withdrawForm').reset();
  $('modal').classList.remove('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
}

$('withdrawForm').addEventListener('submit', async event => {
  event.preventDefault();

  const amount = Number($('amount').value);
  const upi = $('upi').value.trim();
  const pin = $('withdrawPin').value;

  if (!Number.isFinite(amount) || amount < 10) {
    toast('Minimum demo withdrawal amount is ₹10.');
    return;
  }

  if (!/^\d{4,6}$/.test(pin)) {
    toast('Enter your 4 to 6 digit Security PIN.');
    return;
  }

  try {
    await api('/api/withdraw', 'POST', { amount, upi, pin });
    closeModal();
    await refresh();
    showView('wallet');
    toast('Demo withdrawal request submitted.');
  } catch (error) {
    toast(error.message);
  }
});

async function copyCode() {
  try {
    await navigator.clipboard.writeText(me.referralCode);
    toast('Referral code copied.');
  } catch {
    toast('Your referral code: ' + me.referralCode);
  }
}

function logout() {
  token = '';
  me = null;
  cache = null;

  localStorage.removeItem('mea_token');

  $('app').classList.add('hidden');
  $('auth').classList.remove('hidden');
  $('authForm').reset();

  setMode('login');
}

window.setMode = setMode;
window.logout = logout;
window.refresh = refresh;
window.showView = showView;
window.openWithdraw = openWithdraw;
window.closeModal = closeModal;
window.copyCode = copyCode;

const params = new URLSearchParams(location.search);
if (params.get('ref')) $('ref').value = params.get('ref');

setMode('register');

if (token) refresh();
