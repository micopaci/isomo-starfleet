const $ = (id) => document.getElementById(id);

async function load() {
  const managed = await chrome.storage.managed.get(null).catch(() => ({}));
  const local = await chrome.storage.local.get(['apiBase', 'apiToken', 'siteId']);

  $('apiBase').value = managed.apiBase || local.apiBase || '';
  $('apiToken').value = managed.apiToken || local.apiToken || '';
  $('siteId').value = managed.siteId || local.siteId || 0;

  if (managed.apiBase) {
    $('apiBase').disabled = true;
    $('apiBase').title = 'Set by admin policy';
  }
  if (managed.apiToken) {
    $('apiToken').disabled = true;
    $('apiToken').title = 'Set by admin policy';
  }
}

$('save').addEventListener('click', async () => {
  const status = $('status');
  try {
    await chrome.storage.local.set({
      apiBase: $('apiBase').value.replace(/\/$/, ''),
      apiToken: $('apiToken').value,
      siteId: Number($('siteId').value) || 0,
    });
    status.className = 'status ok';
    status.textContent = 'Saved. Next heartbeat will use these settings.';
  } catch (err) {
    status.className = 'status err';
    status.textContent = err.message;
  }
});

load();
