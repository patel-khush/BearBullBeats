// If no support link is configured yet, the button explains instead of going nowhere.
(() => {
  const a = document.getElementById('support');
  if (!a || !a.hasAttribute('data-unset')) return;
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = 'Support link coming soon'; t.setAttribute('role', 'status');
  document.body.appendChild(t);
  let h = 0;
  a.addEventListener('click', (e) => { e.preventDefault(); t.classList.add('on'); clearTimeout(h); h = setTimeout(() => t.classList.remove('on'), 2200); });
})();
