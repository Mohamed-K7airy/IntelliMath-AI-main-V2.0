// ============================================================
// Study Mode — Sphinx-SCA
// Focus timer, notes, tasks, and integrated chat
// ============================================================

import { supabase } from './supabaseClient.js';
import { initMarkdown, formatMessage } from './frontend/lib/markdown.js';
import { initCalculator, initMathToolbar, initGraph } from './frontend/lib/ui.js';

// ── State ─────────────────────────────────────────────────────
const state = {
    // Timer
    timerMode: 'work',
    workDuration: 25 * 60,
    breakDuration: 5 * 60,
    timeRemaining: 25 * 60,
    isRunning: false,
    isFreeTimer: false,
    freeTimerElapsed: 0,
    timerInterval: null,
    sessionsCompleted: 0,
    totalDuration: 25 * 60,

    // Tasks & Notes
    tasks: [],
    notes: [],

    // Chat
    currentMode: 'general',
    isStreaming: false,
    isChatActive: false,
    currentSessionId: null,
    currentUserId: null,

    // Image Upload
    uploadedImageUrl: null,
    isUploading: false
};

const $ = (id) => document.getElementById(id);

// ── Auth & History ───────────────────────────────────────────

async function initAuthAndHistory() {
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
        state.currentUserId = session.user.id;
        fetchHistory(session.user.id);
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
        if (session) {
            state.currentUserId = session.user.id;
            fetchHistory(session.user.id);
        } else {
            state.currentUserId = null;
            const historyList = $('sidebar-history-list');
            if (historyList) historyList.innerHTML = '<li class="history-item" style="padding:10px; color:var(--text-muted);">Log in to see history</li>';
        }
    });

    // Theme Toggle
    const themeBtn = $('theme-toggle-btn');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark-theme');
            document.body.classList.toggle('dark-theme', isDark);
            localStorage.setItem('theme', isDark ? 'dark' : 'light');

            // Update icon
            const icon = themeBtn.querySelector('.theme-icon');
            if (icon) icon.textContent = isDark ? 'light_mode' : 'dark_mode';
        });

        // Initialize icon based on current theme
        const icon = themeBtn.querySelector('.theme-icon');
        if (icon) {
            icon.textContent = document.documentElement.classList.contains('dark-theme') ? 'light_mode' : 'dark_mode';
        }
    }

    // Sidebar Toggles
    $('sidebar-toggle-btn')?.addEventListener('click', () => {
        $('main-sidebar')?.classList.toggle('collapsed');
    });

    $('toggle-right-panel')?.addEventListener('click', () => {
        const sidebar = $('study-right-sidebar');
        if (sidebar) {
            sidebar.classList.toggle('collapsed');
        }
    });

    $('close-right-panel')?.addEventListener('click', () => {
        $('study-right-sidebar')?.classList.add('collapsed');
    });

    $('open-right-panel')?.addEventListener('click', () => {
        $('study-right-sidebar')?.classList.remove('collapsed');
    });

    // Mobile Overlay
    $('sidebar-overlay')?.addEventListener('click', () => {
        $('main-sidebar')?.classList.add('collapsed');
        $('sidebar-overlay')?.classList.remove('active');
    });
}

async function fetchHistory(userId) {
    const historyList = $('sidebar-history-list');
    if (!historyList) return;

    try {
        const { data: messages, error } = await supabase
            .from('messages')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        historyList.innerHTML = '';
        const seenSessions = new Set();
        const topSessions = [];

        messages?.forEach(msg => {
            if (msg.session_id && !seenSessions.has(msg.session_id)) {
                seenSessions.add(msg.session_id);
                topSessions.push(msg);
            }
        });

        if (topSessions.length === 0) {
            historyList.innerHTML = '<li style="padding:10px; color:var(--text-muted); font-size:12px;">No recent chats</li>';
            return;
        }

        topSessions.slice(0, 10).forEach(session => {
            const li = document.createElement('li');
            li.className = 'history-item';
            li.innerHTML = `
                <a href="#" class="history-link" data-id="${session.session_id}">
                    <span class="history-text">${escapeHtml(session.content)}</span>
                </a>
            `;
            li.querySelector('.history-link').addEventListener('click', (e) => {
                e.preventDefault();
                loadSession(session.session_id);
            });
            historyList.appendChild(li);
        });
    } catch (err) {
        console.error('History fetch error:', err);
    }
}

async function loadSession(sessionId) {
    state.currentSessionId = sessionId;
    state.isChatActive = true;

    $('study-hero').style.display = 'none';
    $('study-chat-active').style.display = 'flex';

    try {
        const { data: messages, error } = await supabase
            .from('messages')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        const chatContainer = $('chat-messages');
        chatContainer.innerHTML = '';
        messages.forEach(msg => {
            addMessage(msg.content, msg.sender, msg.image_url);
        });
    } catch (err) {
        console.error('Load session error:', err);
    }
}

async function saveMessageToSupabase(content, sender, imageUrl = null) {
    if (!state.currentUserId) return;

    try {
        const payload = {
            user_id: state.currentUserId,
            session_id: state.currentSessionId,
            content: content,
            sender: sender
        };
        if (imageUrl) payload.image_url = imageUrl;

        await supabase.from('messages').insert([payload]);
        fetchHistory(state.currentUserId);
    } catch (err) {
        console.error('Save message error:', err);
    }
}


// ── Image Upload Logic ────────────────────────────────────────

function initImageUpload() {
    ['hero', 'chat'].forEach(type => {
        const dropZone = $(`${type}-drop-zone`);
        const input = $(`${type}-drop-zone-input`);

        dropZone?.addEventListener('click', () => input.click());

        input?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleFileUpload(file, type);
        });

        // Drag & Drop
        dropZone?.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone?.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone?.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) handleFileUpload(file, type);
        });

        $(`${type}-remove-preview-btn`)?.addEventListener('click', () => {
            state.uploadedImageUrl = null;
            $(`${type}-image-preview-wrapper`).style.display = 'none';
            $(`${type}-drop-zone`).style.display = 'block';
        });
    });
}

async function handleFileUpload(file, type) {
    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file.');
        return;
    }

    state.isUploading = true;
    const previewWrapper = $(`${type}-image-preview-wrapper`);
    const previewImg = $(`${type}-image-preview-thumbnail`);
    const dropZone = $(`${type}-drop-zone`);

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (e) => {
        if (previewImg) previewImg.src = e.target.result;
        if (previewWrapper) previewWrapper.style.display = 'flex';
        // Usually we hide the drop zone if we want a clean look like main page
        if (dropZone) dropZone.style.display = 'none';
    };
    reader.readAsDataURL(file);

    setTimeout(() => {
        state.uploadedImageUrl = reader.result; // Use reader.result directly
        state.isUploading = false;
    }, 500);
}

// ── Chat & Mode Logic ──────────────────────────────────────────

function initChat() {
    // Mode Sync
    const heroTabs = document.querySelectorAll('.gpt-tab');
    heroTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            heroTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.currentMode = tab.dataset.mode;
            syncModeUI(state.currentMode);
        });
    });

    ['hero', 'chat'].forEach(type => {
        const sendBtn = $(`${type}-send-btn`);
        const input = $(`${type}-search-input`);

        sendBtn?.addEventListener('click', () => handleSend(type));
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(type);
            }
        });

        // Auto-resize
        input?.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = input.scrollHeight + 'px';
        });
    });

    initModeDropdowns();
    bindStudyChatActions();

    // Initialize External Tools (Calculator, Math Keyboard, Graph Bar)
    initCalculator();
    initMathToolbar();
    initGraph();

    // Wire mismatched Study Mode IDs for Math / Graph toggles that ui.js doesn't cover natively
    const heroMathToggle = $('hero-math-keyboard-toggle');
    const mathToolbar = $('math-toolbar');
    if (heroMathToggle && mathToolbar) {
        heroMathToggle.addEventListener('click', () => {
            const isVisible = mathToolbar.classList.toggle('visible');
            heroMathToggle.classList.toggle('active', isVisible);
            const chatMathToggle = $('chat-math-keyboard-toggle');
            if (chatMathToggle) chatMathToggle.classList.toggle('active', isVisible);
        });
    }

    const heroGraphToggle = $('hero-tool-create-graph');
    if (heroGraphToggle && window.toggleGraphBar) {
        heroGraphToggle.addEventListener('click', window.toggleGraphBar);
    }
    const chatGraphToggle = $('chat-tool-create-graph');
    if (chatGraphToggle && window.toggleGraphBar) {
        chatGraphToggle.addEventListener('click', window.toggleGraphBar);
    }

    // --- Study-specific Plotting Logic Overwrite (Synced with Main Page exactly) ---
    let graphCounter = 0;
    const plotBtn = $('graph-bar-plot-btn');
    if (plotBtn) {
        plotBtn.addEventListener('click', () => {
            const fnInput = $('fn-input');
            const expr = fnInput?.value?.trim();
            if (!expr) return;

            $('graph-input-bar').style.display = 'none';
            fnInput.value = '';

            // Unified Transition
            transitionToChat();

            const bubbleId = `ggb-study-${++graphCounter}`;
            const chatMessages = $('chat-messages');

            // Save USER plot request to Supabase
            saveMessageToSupabase(`📈 Plotting function: ${expr}`, 'user');

            const msgDiv = document.createElement('div');
            msgDiv.classList.add('message', 'ai-message');

            // EXACT SAME HTML AS MAIN PAGE
            const aiContent = `
                <div class="message-avatar"><img src="logo.png" alt="AI"></div>
                <div class="message-content" style="max-width:600px; width:100%;">
                    <div class="ai-name">Sphinx-SCA</div>
                    <div style="padding:10px 14px; font-size:13px; font-family:monospace; color:#e94560;">📈 f(x) = ${expr}</div>
                    <div style="border-radius:12px; overflow:hidden; border:1px solid #e0e0e0; background:#ffffff;">
                        <div id="${bubbleId}" style="width:100%; height:420px;"></div>
                    </div>
                </div>`;
            msgDiv.innerHTML = aiContent;
            chatMessages.appendChild(msgDiv);

            // Save AI graph response to Supabase (so it persists as a graph message)
            saveMessageToSupabase(`📈 f(x) = ${expr}`, 'ai');

            const scrollWrapper = $('study-chat-messages-wrapper');
            if (scrollWrapper) scrollWrapper.scrollTop = scrollWrapper.scrollHeight;

            // EXACT SAME LOADING LOGIC AS MAIN PAGE
            setTimeout(() => {
                const container = document.getElementById(bubbleId);
                if (!container) return;
                const appletParams = {
                    appName: 'graphing',
                    width: container.offsetWidth || 560,
                    height: 420,
                    showToolBar: false,
                    showAlgebraInput: true,
                    showMenuBar: false,
                    enableRightClick: false,
                    appletOnLoad: (api) => api.evalCommand('f(x) = ' + expr),
                };

                if (typeof GGBApplet !== 'undefined') {
                    new GGBApplet(appletParams, true).inject(bubbleId);
                } else {
                    const script = document.createElement('script');
                    script.src = 'https://www.geogebra.org/apps/deployggb.js';
                    script.onload = () => new GGBApplet(appletParams, true).inject(bubbleId);
                    script.onerror = () => {
                        container.innerHTML = '<div style="padding:20px;color:red;">Failed to load Graphing engine.</div>';
                    };
                    document.head.appendChild(script);
                }
            }, 300);
        });
    }
}

function bindStudyChatActions() {
    const chatContainer = $('chat-messages');
    if (!chatContainer) return;

    chatContainer.addEventListener('click', (e) => {
        // AI Actions
        const btn = e.target.closest('.action-btn');
        if (btn) {
            const action = btn.dataset.action;
            const msgEl = btn.closest('.message');
            const msgContent = msgEl?.querySelector('.message-content');

            if (action === 'copy' || action === 'copy-user') {
                const text = msgContent?.querySelector('.text-body')?.innerText;
                if (text) {
                    navigator.clipboard.writeText(text).then(() => {
                        btn.classList.add('copied');
                        const icon = btn.querySelector('.material-symbols-outlined');
                        if (icon) icon.textContent = 'check';
                        setTimeout(() => {
                            btn.classList.remove('copied');
                            if (icon) icon.textContent = 'content_copy';
                        }, 1500);
                    });
                }
            } else if (action === 'regenerate') {
                // Remove AI message, take last user message text, and resend
                const userMessages = chatContainer.querySelectorAll('.user-message');
                const lastUser = userMessages[userMessages.length - 1];
                if (lastUser) {
                    const prompt = lastUser.querySelector('.text-body')?.innerText;
                    if (prompt) {
                        msgEl.remove();
                        const ci = $('chat-search-input');
                        if (ci) ci.value = prompt;
                        handleSend('chat');
                    }
                }
            } else if (action === 'like') {
                btn.classList.toggle('liked');
                const icon = btn.querySelector('.material-symbols-outlined');
                if (icon) icon.textContent = btn.classList.contains('liked') ? 'thumb_up' : 'thumb_up_off_alt';
                const dislikeBtn = btn.parentElement?.querySelector('[data-action="dislike"]');
                if (dislikeBtn?.classList.contains('disliked')) {
                    dislikeBtn.classList.remove('disliked');
                    const di = dislikeBtn.querySelector('.material-symbols-outlined');
                    if (di) di.textContent = 'thumb_down_off_alt';
                }
            } else if (action === 'dislike') {
                btn.classList.toggle('disliked');
                const icon = btn.querySelector('.material-symbols-outlined');
                if (icon) icon.textContent = btn.classList.contains('disliked') ? 'thumb_down' : 'thumb_down_off_alt';
                const likeBtn = btn.parentElement?.querySelector('[data-action="like"]');
                if (likeBtn?.classList.contains('liked')) {
                    likeBtn.classList.remove('liked');
                    const li = likeBtn.querySelector('.material-symbols-outlined');
                    if (li) li.textContent = 'thumb_up_off_alt';
                }
            } else if (action === 'edit-user') {
                const textBody = msgContent?.querySelector('.text-body');
                const actionsInline = msgEl?.querySelector('.message-actions-inline');
                if (!textBody) return;

                const originalText = textBody.textContent;
                const editContainer = document.createElement('div');
                editContainer.className = 'user-edit-container';
                editContainer.innerHTML = `
                    <textarea class="user-edit-box" style="width: 100%; min-width: 250px; min-height: 80px; background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 8px; padding: 12px; font-family: inherit; font-size: 14px; outline: none; resize: vertical; margin-bottom: 8px;">${originalText}</textarea>
                    <div class="user-edit-actions" style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button class="edit-cancel-btn" type="button" style="padding: 6px 12px; background: transparent; border: 1px solid var(--border-color); color: var(--text-secondary); border-radius: 6px; cursor: pointer; transition: all 0.2s;">Cancel</button>
                        <button class="edit-save-btn" type="button" style="padding: 6px 14px; background: var(--primary); color: #fff; border: none; border-radius: 6px; font-weight: 500; cursor: pointer; transition: all 0.2s;">Save & Submit</button>
                    </div>
                `;

                // Hide original content
                textBody.style.display = 'none';
                if (actionsInline) actionsInline.style.display = 'none';

                textBody.parentNode.insertBefore(editContainer, textBody);

                const textarea = editContainer.querySelector('textarea');
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);

                // Cancel logic
                editContainer.querySelector('.edit-cancel-btn').addEventListener('click', () => {
                    editContainer.remove();
                    textBody.style.display = '';
                    if (actionsInline) actionsInline.style.display = 'flex';
                });

                // Save & Submit logic
                editContainer.querySelector('.edit-save-btn').addEventListener('click', () => {
                    const newText = textarea.value.trim();
                    if (!newText) return;

                    textBody.textContent = newText;
                    editContainer.remove();
                    textBody.style.display = '';
                    if (actionsInline) actionsInline.style.display = 'flex';

                    const ci = $('chat-search-input');
                    if (ci) ci.value = newText;

                    let next = msgEl.nextElementSibling;
                    while (next) {
                        const toRemove = next;
                        next = next.nextElementSibling;
                        toRemove.remove();
                    }

                    handleSend('chat');
                });
            } else if (action === 'resend-user') {
                const text = msgContent?.querySelector('.text-body')?.textContent;
                if (text) {
                    const ci = $('chat-search-input');
                    if (ci) ci.value = text;
                    handleSend('chat');
                }
            }
        }
    });
}

function initModeDropdowns() {
    ['hero', 'chat'].forEach(type => {
        const btn = $(`${type}-mode-btn`) || $(`${type}-mode-dropdown-btn`);
        const menu = $(`${type}-mode-dropdown-menu`);

        btn?.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('active');
        });

        menu?.querySelectorAll('.mode-option').forEach(opt => {
            opt.addEventListener('click', () => {
                state.currentMode = opt.dataset.mode;
                syncModeUI(state.currentMode);
                menu.classList.remove('active');
            });
        });
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.mode-dropdown-menu').forEach(m => m.classList.remove('active'));
    });
}

function syncModeUI(mode) {
    document.querySelectorAll('.gpt-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));

    ['hero', 'chat'].forEach(type => {
        const btn = $(`${type}-mode-btn`) || $(`${type}-mode-dropdown-btn`);
        if (!btn) return;
        const text = btn.querySelector('.dropdown-text');
        const icon = btn.querySelector('.dropdown-icon');

        const label = mode === 'think' ? 'Deep Think' : (mode === 'steps' ? 'Steps' : 'General');
        const iconName = mode === 'think' ? 'psychology' : (mode === 'steps' ? 'format_list_numbered' : 'auto_awesome');

        if (text) text.textContent = label;
        if (icon) icon.textContent = iconName;

        $(type + '-mode-dropdown-menu')?.querySelectorAll('.mode-option').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.mode === mode);
        });
    });
}

function transitionToChat() {
    if (!state.isChatActive) {
        state.isChatActive = true;

        const studyHero = $('study-hero');
        const studyChat = $('study-chat-active');

        if (studyHero) studyHero.style.display = 'none';
        if (studyChat) studyChat.style.display = 'flex';
    }

    if (!state.currentSessionId) {
        state.currentSessionId = generateUUID();
    }
}

async function handleSend(type) {
    if (state.isStreaming) return;

    const input = $(`${type}-search-input`);
    const text = input.value.trim();
    const imageUrl = state.uploadedImageUrl;

    if (!text && !imageUrl) return;

    // Transition
    transitionToChat();

    // Reset Input
    input.value = '';
    input.style.height = 'auto';
    $(`${type}-image-preview-wrapper`).style.display = 'none';
    $(`${type}-drop-zone`).style.display = 'block';
    state.uploadedImageUrl = null;

    addMessage(text, 'user', imageUrl);
    saveMessageToSupabase(text || '📷 Image Message', 'user', imageUrl);

    // AI Response Placeholder
    const aiMsgDiv = addMessage('', 'ai');
    const aiTextDiv = aiMsgDiv.querySelector('.text-body');

    // Add professional skeleton loading state before response arrives
    aiTextDiv.innerHTML = `
        <div class="stream-skeleton" data-role="skeleton">
            <div class="skeleton skeleton-line" style="width:70%"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line" style="width:45%"></div>
        </div>`;

    state.isStreaming = true;
    let fullResponse = '';
    let gotFirstToken = false;

    try {
        const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:8000' : '';
        const response = await fetch(`${API_URL}/solve_stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: text || 'Solve this math problem from the image.',
                image_data: imageUrl,
                mode: state.currentMode,
                session_id: state.currentSessionId,
                user_id: state.currentUserId
            })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            lines.forEach(line => {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6).trim();
                    if (dataStr === '[DONE]') return;
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.content) {
                            if (!gotFirstToken) {
                                gotFirstToken = true;
                                const sk = aiTextDiv.querySelector('[data-role="skeleton"]');
                                if (sk) sk.remove();
                            }
                            fullResponse += data.content;
                            aiTextDiv.innerHTML = formatMessage(fullResponse) + '<span class="typing-cursor" aria-hidden="true"></span>';

                            // Use direct scrollTop for immediate updates to prevent 'smooth' animation stuttering
                            const wrapper = $('study-chat-messages-wrapper');
                            wrapper.scrollTop = wrapper.scrollHeight;
                        }
                    } catch (e) { }
                }
            });
        }

        // Save AI Response
        if (fullResponse) {
            saveMessageToSupabase(fullResponse, 'ai');
        }
    } catch (err) {
        aiTextDiv.innerHTML = '<span style="color:var(--primary);">Error connecting to server. Please try again.</span>';
    } finally {
        state.isStreaming = false;
        aiTextDiv.innerHTML = formatMessage(fullResponse);
    }
}

function addMessage(text, sender, imageUrl = null) {
    const chatContainer = $('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender}-message`;

    if (sender === 'ai') {
        msgDiv.innerHTML = `
            <div class="message-avatar"><img src="logo.png"></div>
            <div class="message-content">
                <div class="ai-name">SPHINX-SCA</div>
                <div class="text-body">${formatMessage(text)}</div>
                <div class="message-actions">
                    <button class="action-btn" data-action="copy" title="Copy">
                        <span class="material-symbols-outlined">content_copy</span>
                    </button>
                    <button class="action-btn" data-action="regenerate" title="Regenerate">
                        <span class="material-symbols-outlined">refresh</span>
                    </button>
                    <button class="action-btn" data-action="like" title="Like">
                        <span class="material-symbols-outlined">thumb_up_off_alt</span>
                    </button>
                    <button class="action-btn" data-action="dislike" title="Dislike">
                        <span class="material-symbols-outlined">thumb_down_off_alt</span>
                    </button>
                </div>
            </div>
        `;
    } else {
        msgDiv.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: flex-end; width: 100%;">
                <div class="message-content" style="max-width: 100%;">
                    ${imageUrl ? `<img src="${imageUrl}" class="message-image">` : ''}
                    <div class="text-body">${escapeHtml(text)}</div>
                </div>
                <div class="message-actions-inline" style="display: flex; gap: 4px; align-items: center; margin-top: 6px; margin-right: 4px;">
                    <span class="message-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <button class="action-btn" data-action="resend-user" title="Resend">
                        <span class="material-symbols-outlined">refresh</span>
                    </button>
                    <button class="action-btn" data-action="edit-user" title="Edit">
                        <span class="material-symbols-outlined">edit</span>
                    </button>
                    <button class="action-btn" data-action="copy-user" title="Copy">
                        <span class="material-symbols-outlined">content_copy</span>
                    </button>
                </div>
            </div>
            <div class="message-avatar"><img src="user.png"></div>
        `;
    }

    chatContainer.appendChild(msgDiv);
    const wrapper = $('study-chat-messages-wrapper');
    wrapper.scrollTo({ top: wrapper.scrollHeight, behavior: 'smooth' });
    return msgDiv;
}

// ── Study Tools (Timer, Notes, Tasks) ──────────────────────────

function initStudyTools() {
    // Timer
    const playBtn = $('timer-play-btn');
    const resetBtn = $('timer-reset-btn');
    const skipBtn = $('timer-skip-btn');
    const planBtns = document.querySelectorAll('.timer-plan-btn');

    planBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            planBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const work = parseInt(btn.dataset.work);
            state.isFreeTimer = (work === 0);
            state.workDuration = work * 60;
            state.timeRemaining = state.workDuration;
            state.freeTimerElapsed = 0;
            updateTimerUI();
        });
    });

    playBtn?.addEventListener('click', () => {
        if (state.isRunning) pauseTimer();
        else startTimer();
    });

    resetBtn?.addEventListener('click', () => {
        pauseTimer();
        if (state.isFreeTimer) {
            state.freeTimerElapsed = 0;
        } else {
            state.timeRemaining = state.workDuration;
        }
        updateTimerUI();
    });

    skipBtn?.addEventListener('click', () => {
        if (state.isFreeTimer) return;

        pauseTimer();
        // Toggle between work and break phases (simple toggle for now)
        if (state.timerMode === 'work') {
            state.timerMode = 'break';
            state.timeRemaining = state.breakDuration;
        } else {
            state.timerMode = 'work';
            state.timeRemaining = state.workDuration;
        }
        updateTimerUI();
        startTimer(); // Auto-start the next phase
    });

    // Tasks & Notes
    initTasks();
    initNotes();
}

// ── Tasks & Notes Management ───────────────────────────────────

function initTasks() {
    const taskInput = $('task-input');
    const taskAddBtn = $('task-add-btn');
    const clearTasksBtn = $('clear-tasks-btn');

    // Load from LocalStorage
    const savedTasks = localStorage.getItem('study-tasks');
    if (savedTasks) {
        try {
            state.tasks = JSON.parse(savedTasks);
            renderTasks();
        } catch (e) { console.error('Error loading tasks:', e); }
    }

    taskAddBtn?.addEventListener('click', () => addTask());
    taskInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTask();
    });

    clearTasksBtn?.addEventListener('click', () => {
        if (confirm('Clear all tasks?')) {
            state.tasks = [];
            saveTasks();
            renderTasks();
        }
    });
}

function addTask() {
    const input = $('task-input');
    const text = input.value.trim();
    if (!text) return;

    const newTask = {
        id: Date.now(),
        text: text,
        completed: false
    };

    state.tasks.push(newTask);
    input.value = '';
    saveTasks();
    renderTasks();
}

function toggleTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        saveTasks();
        renderTasks();
    }
}

function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveTasks();
    renderTasks();
}

function saveTasks() {
    localStorage.setItem('study-tasks', JSON.stringify(state.tasks));
}

function renderTasks() {
    const list = $('tasks-list');
    if (!list) return;

    list.innerHTML = state.tasks.map(task => `
        <li class="task-item ${task.completed ? 'completed' : ''}" data-id="${task.id}">
            <div class="task-checkbox">
                <span class="material-symbols-outlined">${task.completed ? 'check_circle' : 'circle'}</span>
            </div>
            <span class="task-text">${escapeHtml(task.text)}</span>
            <button class="task-delete-btn">
                <span class="material-symbols-outlined">delete</span>
            </button>
        </li>
    `).join('');

    // Attach listeners
    list.querySelectorAll('.task-item').forEach(item => {
        const id = parseInt(item.dataset.id);
        item.querySelector('.task-checkbox').addEventListener('click', () => toggleTask(id));
        item.querySelector('.task-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTask(id);
        });
    });
}

function initNotes() {
    const noteInput = $('note-input');
    const noteAddBtn = $('note-add-btn');
    const clearNotesBtn = $('clear-notes-btn');

    // Load from LocalStorage
    const savedNotes = localStorage.getItem('study-notes-blocks');
    if (savedNotes) {
        try {
            state.notes = JSON.parse(savedNotes);
            renderNotes();
        } catch (e) { console.error('Error loading notes:', e); }
    } else {
        // Migration from old single-string format
        const oldNotes = localStorage.getItem('study-notes');
        if (oldNotes && typeof oldNotes === 'string' && oldNotes.trim()) {
            state.notes = [{ id: Date.now(), text: oldNotes }];
            saveNotes();
            renderNotes();
            localStorage.removeItem('study-notes'); // Clean up old format
        }
    }

    noteAddBtn?.addEventListener('click', () => addNote());
    noteInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addNote();
    });

    clearNotesBtn?.addEventListener('click', () => {
        if (confirm('Clear all notes?')) {
            state.notes = [];
            saveNotes();
            renderNotes();
        }
    });
}

function addNote() {
    const input = $('note-input');
    const text = input.value.trim();
    if (!text) return;

    const newNote = {
        id: Date.now(),
        text: text
    };

    state.notes.push(newNote);
    input.value = '';
    saveNotes();
    renderNotes();
}

function deleteNote(id) {
    state.notes = state.notes.filter(n => n.id !== id);
    saveNotes();
    renderNotes();
}

function saveNotes() {
    localStorage.setItem('study-notes-blocks', JSON.stringify(state.notes));
}

function renderNotes() {
    const list = $('notes-list');
    if (!list) return;

    list.innerHTML = state.notes.map(note => `
        <li class="note-item" data-id="${note.id}">
            <div class="note-icon">
                <span class="material-symbols-outlined">description</span>
            </div>
            <div class="note-text">${escapeHtml(note.text)}</div>
            <button class="note-delete-btn">
                <span class="material-symbols-outlined">delete</span>
            </button>
        </li>
    `).join('');

    // Attach listeners
    list.querySelectorAll('.note-delete-btn').forEach(btn => {
        const id = parseInt(btn.closest('.note-item').dataset.id);
        btn.addEventListener('click', () => deleteNote(id));
    });
}

function startTimer() {
    state.isRunning = true;
    $('play-icon').textContent = 'pause';
    state.timerInterval = setInterval(() => {
        if (state.isFreeTimer) {
            state.freeTimerElapsed++;
            updateTimerUI();
        } else {
            if (state.timeRemaining > 0) {
                state.timeRemaining--;
                updateTimerUI();
            } else {
                clearInterval(state.timerInterval);
                state.isRunning = false;
                $('play-icon').textContent = 'play_arrow';
                alert('Timer Finished!');
            }
        }
    }, 1000);
}

function pauseTimer() {
    state.isRunning = false;
    $('play-icon').textContent = 'play_arrow';
    clearInterval(state.timerInterval);
}

function updateTimerUI() {
    let displayTime = state.timeRemaining;
    if (state.isFreeTimer) {
        displayTime = state.freeTimerElapsed;
        $('timer-label').textContent = 'Elapsed';
    } else {
        $('timer-label').textContent = 'Focus';
    }

    const mins = Math.floor(Math.max(0, displayTime) / 60);
    const secs = Math.max(0, displayTime) % 60;
    $('timer-time').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const ring = $('timer-ring-progress');
    const circumference = 2 * Math.PI * 100;
    let offset = circumference; // Default full

    if (state.isFreeTimer) {
        // For free timer, maybe showing a constant pulse or slow rotation
        offset = circumference * (1 - (state.freeTimerElapsed % 60) / 60);
    } else if (state.workDuration > 0) {
        offset = circumference * (1 - state.timeRemaining / state.workDuration);
    }

    ring.style.strokeDashoffset = offset;
}

// ── Helpers ───────────────────────────────────────────────────

function generateUUID() { return crypto.randomUUID(); }
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function initModals() {
    $('welcome-start-btn')?.addEventListener('click', () => {
        $('study-welcome-overlay').classList.remove('active');
    });
}

function initToolsAndSymbols() {
    const mathSymbolSets = {
        popular: ['π', '∞', '√', '∫', 'Σ', '±', '≠', '≈', '≥', '≤', '÷', '×', 'log', 'ln', 'x²', 'x³', 'xⁿ'],
        trig: ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'θ', 'φ', 'α', 'β'],
        calculus: ['∫', '∬', '∮', 'd/dx', '∂', 'lim', '→', 'Δ', '∇', 'dy/dx'],
        comparison: ['=', '≠', '≈', '≡', '≈', '>', '<', '≥', '≤', '≫', '≪'],
        sets: ['∈', '∉', '⊂', '⊃', '⊆', '⊇', '∩', '∪', '∅', 'ℝ', 'ℤ', 'ℕ'],
        arrows: ['→', '←', '↔', '⇒', '⇐', '⇔', '↑', '↓', '⟹', '⟸'],
        greek: ['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'σ', 'τ', 'φ', 'ω', 'Ω', 'Δ'],
    };

    const toolbar = $('math-toolbar');
    const grid = $('math-symbols-grid');

    // Symbols insert logic
    $('hero-math-keyboard-toggle')?.addEventListener('click', () => toolbar.classList.toggle('active'));
    $('chat-math-keyboard-toggle')?.addEventListener('click', () => toolbar.classList.toggle('active'));
    $('math-toolbar-close')?.addEventListener('click', () => toolbar.classList.remove('active'));

    const renderSymbols = (category) => {
        const symbols = mathSymbolSets[category] || mathSymbolSets.popular;
        grid.innerHTML = symbols.map(s => `<button class="math-sym-btn">${s}</button>`).join('');

        grid.querySelectorAll('.math-sym-btn').forEach(btn => {
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const activeType = state.isChatActive ? 'chat' : 'hero';
                const input = $(`${activeType}-search-input`);
                if (!input) return;

                const start = input.selectionStart;
                const end = input.selectionEnd;
                const text = input.value;
                const symbol = btn.textContent;

                input.value = text.substring(0, start) + symbol + text.substring(end);
                input.focus();
                const newCursorPos = start + symbol.length;
                input.setSelectionRange(newCursorPos, newCursorPos);
                input.dispatchEvent(new Event('input'));
            });
        });
    };

    renderSymbols('popular');

    document.querySelectorAll('.math-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.math-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderSymbols(tab.dataset.tab);
        });
    });
}

// ── Bootstrap ─────────────────────────────────────────────────


    document.addEventListener('DOMContentLoaded', () => {
        initMarkdown();
        initAuthAndHistory();
        initImageUpload();
        initChat();
        initStudyTools();
        initModals();
        initToolsAndSymbols();
    });
