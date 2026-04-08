// ============================================================
// Image Upload — Preview, Drag & Drop, Progress
// ============================================================

/**
 * Image upload state — used by chat.js for the send flow.
 */
export const imageState = {
    file: null,
    objectUrl: null,
    dataUrl: null,
    isPreparing: false,
};

// ── DOM Cache ─────────────────────────────────────────────────
let _previewWrapper, _previewThumb, _removeBtn, _overlayText, _progressBar;

function cacheDom() {
    _previewWrapper = document.getElementById('image-preview-wrapper');
    _previewThumb = document.getElementById('image-preview-thumbnail');
    _removeBtn = document.getElementById('remove-preview-btn');
    _overlayText = document.getElementById('upload-overlay-text');
    _progressBar = document.getElementById('upload-progress-bar');
}

// ── UI helpers ────────────────────────────────────────────────
export function setImageUploadUI(state) {
    if (!_previewWrapper || !_previewThumb) return;
    if (state.visible) _previewWrapper.classList.add('is-visible');
    else _previewWrapper.classList.remove('is-visible');

    _previewWrapper.classList.toggle('is-loading', !!state.loading);
    _previewWrapper.classList.toggle('is-ready', !!state.visible);
    if (_overlayText && typeof state.text === 'string') _overlayText.textContent = state.text;
    if (_progressBar && typeof state.progress === 'number') {
        _progressBar.style.width = `${Math.max(0, Math.min(100, state.progress))}%`;
    }
}

function revokePreviewUrl() {
    if (imageState.objectUrl) {
        try { URL.revokeObjectURL(imageState.objectUrl); } catch { /* ignore */ }
        imageState.objectUrl = null;
    }
}

function fileToDataUrlWithProgress(file, onProgress) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read image'));
        reader.onabort = () => reject(new Error('Image read aborted'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onprogress = (e) => {
            if (e.lengthComputable && typeof onProgress === 'function') {
                onProgress((e.loaded / e.total) * 100);
            }
        };
        reader.readAsDataURL(file);
    });
}

// ── Public API ────────────────────────────────────────────────

/** Show an image preview and read the file into a base64 data URL. */
export async function showImagePreview(file) {
    cacheDom();
    imageState.file = file;
    imageState.dataUrl = null;
    revokePreviewUrl();

    // Instant preview via object URL + fade-in
    imageState.objectUrl = URL.createObjectURL(file);
    if (_previewThumb) _previewThumb.src = imageState.objectUrl;
    setImageUploadUI({ visible: true, loading: true, progress: 0, text: 'Uploading…' });

    imageState.isPreparing = true;
    try {
        const dataUrl = await fileToDataUrlWithProgress(file, (p) => {
            setImageUploadUI({ visible: true, loading: true, progress: p, text: 'Uploading…' });
        });
        imageState.dataUrl = dataUrl;
        setImageUploadUI({ visible: true, loading: false, progress: 100, text: 'Uploaded' });
    } catch (e) {
        console.error('Image preparation failed:', e);
        imageState.dataUrl = null;
        setImageUploadUI({ visible: true, loading: false, progress: 0, text: 'Upload failed' });
    } finally {
        imageState.isPreparing = false;
    }
}

/** Clear the image preview and reset state. */
export function removeImagePreview() {
    cacheDom();
    imageState.file = null;
    imageState.dataUrl = null;
    revokePreviewUrl();
    setImageUploadUI({ visible: false, loading: false, progress: 0, text: '' });
    if (_previewThumb) _previewThumb.src = '';
    const inp = document.getElementById('image-upload-input');
    if (inp) inp.value = '';
}

/**
 * Initialize all image-related listeners:
 *  - Remove preview button
 *  - Upload button in hero
 *  - Drag & drop zones (hero + chat)
 */
export function initImageUpload() {
    cacheDom();

    // Remove preview button
    if (_removeBtn) {
        _removeBtn.addEventListener('click', removeImagePreview);
    }

    // Upload button (hero)
    const uploadBtnMain = document.getElementById('upload-btn-main');
    const imageUploadInput = document.getElementById('image-upload-input');
    if (uploadBtnMain && imageUploadInput) {
        uploadBtnMain.addEventListener('click', (e) => {
            e.stopPropagation();
            imageUploadInput.click();
        });
        imageUploadInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) showImagePreview(file);
        });
    }

    // Drag & Drop zones
    const dropZones = [
        { zone: document.getElementById('drop-zone'), input: document.getElementById('drop-zone-input') },
        { zone: document.getElementById('chat-drop-zone'), input: document.getElementById('chat-drop-zone-input') },
    ];

    dropZones.forEach(({ zone, input }) => {
        if (!zone || !input) return;

        zone.addEventListener('click', (e) => {
            if (e.target === zone || e.target.closest('.upload-content')) {
                e.stopPropagation();
                input.click();
            }
        });

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                showImagePreview(file);
                zone.classList.add('has-file');
            }
        });

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) {
                showImagePreview(file);
                zone.classList.add('has-file');
            }
        });
    });
}
