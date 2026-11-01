(() => {
  const suggestions = [
    { id: '1', line: 'L8', old: 'only the creak of the rope against its post', next: 'the bell from the old schoolhouse, carrying across the flats' },
    { id: '2', line: 'L10', old: 'The orchard knows what it has kept.', next: 'There is something in the west field you should see.' },
    { id: '3', line: 'L11', old: 'No text — insertion', next: 'He took the path between the trees.' }
  ];
  const state = { active: '1', remaining: new Set(suggestions.map(({ id }) => id)) };
  const list = document.querySelector('#review-list');
  const detail = document.querySelector('#review-detail');
  const count = document.querySelector('#pending-count');
  const position = document.querySelector('#review-position');
  const empty = document.querySelector('#review-empty');

  const activeSuggestions = () => suggestions.filter(({ id }) => state.remaining.has(id));
  const getSuggestion = (id) => suggestions.find((suggestion) => suggestion.id === id);
  const escapeHtml = (value) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

  function showDetail(id) {
    const suggestion = getSuggestion(id);
    if (!suggestion || !state.remaining.has(id)) return;
    state.active = id;
    detail.hidden = false;
    detail.innerHTML = `<p class="prototype-kicker">Original text · ${suggestion.line}</p><p><del>${escapeHtml(suggestion.old)}</del></p><div><button class="btn" type="button" data-action="accept" data-id="${id}">Accept</button><button class="btn" type="button" data-action="reject" data-id="${id}">Reject</button></div>`;
    render();
  }

  function resolve(id, action) {
    const suggestion = getSuggestion(id);
    state.remaining.delete(id);
    const marker = document.querySelector(`.review-marker[data-proposal-id="${id}"]`);
    if (marker) {
      marker.textContent = action === 'accept'
        ? suggestion.next
        : (suggestion.old === 'No text — insertion' ? '' : suggestion.old);
      marker.disabled = true;
      marker.classList.add('is-resolved');
    }
    detail.hidden = true;
    const remaining = activeSuggestions();
    state.active = remaining[0]?.id || null;
    render();
    if (action === 'revise') return;
  }

  function render() {
    const remaining = activeSuggestions();
    count.textContent = remaining.length;
    empty.hidden = remaining.length !== 0;
    list.innerHTML = remaining.map((suggestion) => `<article class="review-card ${suggestion.id === state.active ? 'is-active' : ''}" data-card-id="${suggestion.id}"><button class="review-card-target" type="button" data-focus-id="${suggestion.id}" aria-label="Show suggestion at ${suggestion.line}"><span>${suggestion.line} · Replace</span><del>${escapeHtml(suggestion.old)}</del><ins>${escapeHtml(suggestion.next)}</ins></button><div class="review-card-actions"><button class="btn" type="button" data-action="accept" data-id="${suggestion.id}">Accept</button><button class="btn" type="button" data-action="reject" data-id="${suggestion.id}">Reject</button><button class="btn" type="button" data-action="revise" data-id="${suggestion.id}">Revise</button></div></article>`).join('');
    const index = remaining.findIndex(({ id }) => id === state.active);
    position.textContent = remaining.length ? `${index + 1} of ${remaining.length}` : 'Complete';
  }

  document.addEventListener('click', (event) => {
    const marker = event.target.closest('.review-marker');
    if (marker && !marker.classList.contains('is-resolved')) showDetail(marker.dataset.proposalId);
    const focus = event.target.closest('[data-focus-id]');
    if (focus) showDetail(focus.dataset.focusId);
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const id = action.dataset.id;
    if (action.dataset.action === 'revise') {
      const suggestion = getSuggestion(id);
      const replacement = window.prompt('Revise suggested text', suggestion.next);
      if (replacement?.trim()) {
        suggestion.next = replacement.trim();
        const marker = document.querySelector(`.review-marker[data-proposal-id="${id}"]`);
        if (marker) marker.textContent = suggestion.next;
      }
      render();
      return;
    }
    resolve(id, action.dataset.action);
  });
  document.addEventListener('focusin', (event) => {
    const marker = event.target.closest('.review-marker');
    if (marker && !marker.classList.contains('is-resolved')) showDetail(marker.dataset.proposalId);
  });
  document.addEventListener('mouseover', (event) => {
    const marker = event.target.closest('.review-marker');
    if (marker && !marker.classList.contains('is-resolved')) showDetail(marker.dataset.proposalId);
  });
  document.querySelector('#accept-all').addEventListener('click', () => activeSuggestions().forEach(({ id }) => resolve(id, 'accept')));
  document.querySelector('#reject-all').addEventListener('click', () => activeSuggestions().forEach(({ id }) => resolve(id, 'reject')));
  document.querySelector('#previous-change').addEventListener('click', () => navigate(-1));
  document.querySelector('#next-change').addEventListener('click', () => navigate(1));
  function navigate(direction) {
    const remaining = activeSuggestions();
    if (!remaining.length) return;
    const current = Math.max(0, remaining.findIndex(({ id }) => id === state.active));
    const next = (current + direction + remaining.length) % remaining.length;
    const marker = document.querySelector(`.review-marker[data-proposal-id="${remaining[next].id}"]`);
    marker?.focus();
    marker?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showDetail(remaining[next].id);
  }
  render();
})();
