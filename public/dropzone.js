// Admin-only. A reusable drag-and-drop image upload zone: click-to-browse
// fallback, an immediate local preview (before any network request), and
// pending/success/error visual states driven entirely by the caller's own
// async upload handler — this module only owns the interaction/UI, not the
// resize-and-POST logic (admin.js already has resizeImageToDataUrl for that).

// root: an empty container element to mount into.
// onFile(file): async handler called with the raw File once one is chosen
// (by drop or by the file picker). Throw to signal failure — the dropzone
// shows the error message and stays interactive so the user can retry.
// Returns { reset() } to clear back to the empty state.
function createDropzone(root, { onFile, hint = 'Drag an image here, or click to browse' } = {}) {
  root.classList.add('dropzone');
  root.innerHTML = `
    <input type="file" accept="image/*" class="dropzone-input" hidden />
    <div class="dropzone-placeholder">
      <span class="dropzone-icon">⬆</span>
      <span class="dropzone-hint">${hint}</span>
    </div>
    <img class="dropzone-preview hidden" alt="" />
    <div class="dropzone-status hidden"></div>
  `;
  const input = root.querySelector('.dropzone-input');
  const preview = root.querySelector('.dropzone-preview');
  const placeholder = root.querySelector('.dropzone-placeholder');
  const status = root.querySelector('.dropzone-status');

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = `dropzone-status dropzone-status-${kind}`;
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      setStatus('Please choose an image file.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      preview.src = reader.result;
      preview.classList.remove('hidden');
      placeholder.classList.add('hidden');

      root.classList.add('dropzone-pending');
      setStatus('Uploading…', 'pending');
      try {
        await onFile(file);
        setStatus('✓ Uploaded', 'success');
      } catch (err) {
        setStatus(err?.message || 'Upload failed — try again.', 'error');
      } finally {
        root.classList.remove('dropzone-pending');
      }
    };
    reader.readAsDataURL(file);
  }

  root.addEventListener('click', (e) => {
    if (e.target !== input) input.click();
  });
  input.addEventListener('change', () => {
    if (input.files[0]) handleFile(input.files[0]);
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    root.addEventListener(evt, (e) => {
      e.preventDefault();
      root.classList.add('dropzone-active');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    root.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === 'dragleave' && root.contains(e.relatedTarget)) return;
      root.classList.remove('dropzone-active');
    });
  });
  root.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  return {
    reset() {
      preview.classList.add('hidden');
      placeholder.classList.remove('hidden');
      status.classList.add('hidden');
      status.className = 'dropzone-status hidden';
      input.value = '';
    },
  };
}
