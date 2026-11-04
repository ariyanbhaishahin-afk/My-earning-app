$('authForm').onsubmit = async e => {
  e.preventDefault();

  try {
    const phone = $('phone').value.replace(/\D/g, '');

    if (phone.length !== 10) {
      alert('कृपया सही 10 अंकों का मोबाइल नंबर डालें');
      return;
    }

    const d = await api('/api/login', 'POST', { phone });

    alert('Login सफल हुआ!');
    token = d.token;
    localStorage.setItem('mea_token', token);
    await refresh();

  } catch (e) {
    alert('Login Error: ' + e.message);
  }
};
