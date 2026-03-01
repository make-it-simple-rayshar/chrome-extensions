const captureBtn = document.getElementById('captureBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const statusText = document.getElementById('statusText');
const errorText = document.getElementById('errorText');

captureBtn.addEventListener('click', () => {
  captureBtn.disabled = true;
  errorText.style.display = 'none';
  progressContainer.style.display = 'block';
  progressFill.style.width = '0%';
  statusText.textContent = 'Preparing...';

  chrome.runtime.sendMessage({ action: 'START_CAPTURE' });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'PROGRESS') {
    const pct = Math.round((msg.current / msg.total) * 100);
    progressFill.style.width = `${pct}%`;
    statusText.textContent = `Capturing... ${msg.current}/${msg.total}`;
  }

  if (msg.action === 'CAPTURE_COMPLETE') {
    progressFill.style.width = '100%';
    statusText.textContent = 'Done!';
    captureBtn.disabled = false;
  }

  if (msg.action === 'CAPTURE_ERROR') {
    progressContainer.style.display = 'none';
    errorText.style.display = 'block';
    errorText.textContent = msg.error;
    captureBtn.disabled = false;
  }
});
