for (const form of document.querySelectorAll('form[data-action]')) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    const result = form.querySelector('.result');
    button.disabled = true;
    result.dataset.error = 'false';
    result.textContent = '処理中…';
    try {
      const response = await fetch(`/api/${form.dataset.action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '処理に失敗しました。');
      result.textContent = form.dataset.action === 'shorten' ? data.shortUrl : data.url;
    } catch (error) {
      result.dataset.error = 'true';
      result.textContent = error instanceof Error ? error.message : '通信に失敗しました。';
    } finally {
      button.disabled = false;
    }
  });
}
