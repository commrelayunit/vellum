// Vellum JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Toggle chat panel
    const toggleChatBtn = document.getElementById('toggle-chat');
    const chatPanel = document.getElementById('chat-panel');
    
    if (toggleChatBtn && chatPanel) {
        toggleChatBtn.addEventListener('click', function() {
            const collapsed = chatPanel.classList.toggle('collapsed');
            toggleChatBtn.setAttribute('aria-expanded', String(!collapsed));
            toggleChatBtn.setAttribute('aria-label', collapsed ? 'Expand chat' : 'Collapse chat');
            toggleChatBtn.setAttribute('title', collapsed ? 'Expand chat' : 'Collapse chat');
        });
    }
    
    // Header dropdown menu
    const menuToggle = document.getElementById('menu-toggle');
    const menuDropdown = document.getElementById('menu-dropdown');

    if (menuToggle && menuDropdown) {
        const overviewItem = menuDropdown.querySelector('[data-menu-action="overview"]');
        if (overviewItem && document.body.dataset.page === 'projects') {
            // Already on the overview - no point linking back to it
            overviewItem.style.display = 'none';
        }

        const settingsItem = menuDropdown.querySelector('[data-menu-action="settings"]');
        if (settingsItem && document.body.dataset.page === 'settings') {
            // Already on settings - no point linking back to it
            settingsItem.style.display = 'none';
        }

        function closeMenu() {
            menuDropdown.classList.remove('open');
            menuToggle.setAttribute('aria-expanded', 'false');
        }

        function openMenu() {
            menuDropdown.classList.add('open');
            menuToggle.setAttribute('aria-expanded', 'true');
        }

        menuToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            if (menuDropdown.classList.contains('open')) {
                closeMenu();
            } else {
                openMenu();
            }
        });

        menuDropdown.addEventListener('click', function(e) {
            e.stopPropagation();
        });

        document.addEventListener('click', closeMenu);
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeMenu();
        });
    }
    
    // Toggle preview mode
    const previewToggle = document.getElementById('preview-toggle');
    const editorTextarea = document.getElementById('markdown-editor');
    const previewContent = document.createElement('div');
    previewContent.id = 'preview-content';
    previewContent.className = 'preview-content';
    previewContent.style.display = 'none';

    const EYE_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
    const PENCIL_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';

    // Insert preview element after editor
    if (editorTextarea && previewToggle) {
        editorTextarea.parentNode.appendChild(previewContent);

        previewToggle.addEventListener('click', function() {
            if (editorTextarea.style.display === 'none') {
                // Show editor, hide preview
                editorTextarea.style.display = 'block';
                previewContent.style.display = 'none';
                previewToggle.innerHTML = EYE_ICON;
                previewToggle.setAttribute('aria-label', 'Show preview');
                previewToggle.setAttribute('title', 'Preview');
            } else {
                // Convert markdown to HTML and show preview, hide editor
                const markdownContent = editorTextarea.value;
                const htmlContent = convertMarkdownToHtml(markdownContent);
                previewContent.innerHTML = htmlContent;
                editorTextarea.style.display = 'none';
                previewContent.style.display = 'block';
                previewToggle.innerHTML = PENCIL_ICON;
                previewToggle.setAttribute('aria-label', 'Edit source');
                previewToggle.setAttribute('title', 'Edit');
            }
        });
    }
    
    // Export button functionality
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            const content = editorTextarea.value;
            const blob = new Blob([content], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'document.md';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }
    
    // Save functionality
    if (editorTextarea) {
        let saveTimeout;
        editorTextarea.addEventListener('input', function() {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(saveContent, 1000); // Save after 1 second of inactivity
        });
        
        function saveContent() {
            const fileId = editorTextarea.dataset.fileId;
            const content = editorTextarea.value;
            
            fetch(`/api/save-file/${fileId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    console.log('File saved successfully');
                } else {
                    console.error('Failed to save file:', data.message);
                }
            })
            .catch(error => {
                console.error('Error saving file:', error);
            });
        }
    }
    
    // Chat functionality: real streaming completions, per-file history
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const chatMessages = document.querySelector('.chat-messages');
    const chatProviderSelect = document.getElementById('chat-provider-select');
    const editorForChat = document.getElementById('markdown-editor');

    if (chatInput && sendChatBtn && chatMessages && editorForChat) {
        const fileId = editorForChat.dataset.fileId;

        function formatTime(isoString) {
            const date = isoString ? new Date(isoString) : new Date();
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        function addMessage(author, content, className, timeString) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${className || ''}`;

            const authorDiv = document.createElement('div');
            authorDiv.className = 'message-author';
            authorDiv.textContent = author;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = content;

            const timeDiv = document.createElement('div');
            timeDiv.className = 'message-time';
            timeDiv.textContent = timeString || formatTime();

            messageDiv.appendChild(authorDiv);
            messageDiv.appendChild(contentDiv);
            messageDiv.appendChild(timeDiv);

            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return contentDiv;
        }

        function loadHistory() {
            fetch(`/api/chat/${fileId}/messages`)
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (!data.success) return;
                    data.messages.forEach(function(message) {
                        if (message.role === 'user') {
                            addMessage('You', message.content, '', formatTime(message.createdAt));
                        } else if (message.role === 'assistant') {
                            addMessage(message.providerLabel || 'Agent', message.content, 'agent-message', formatTime(message.createdAt));
                        } else {
                            addMessage('Error', message.content, 'error-message', formatTime(message.createdAt));
                        }
                    });
                })
                .catch(function() {
                    addMessage('Error', 'Your session expired — reload the page and sign in again.', 'error-message');
                });
        }

        // A POST to /api/chat/:fileId/messages is only usable as an SSE
        // stream if the server actually sent one. If express-session's
        // in-memory store lost the session (e.g. after a server restart —
        // there's no cookie.maxAge, so this is routine), requireAuth
        // redirects to /login; fetch's default redirect:'follow' silently
        // re-issues that as a GET and resolves with a 200 OK HTML login
        // page, which looks like success unless we check for it explicitly.
        function isSseResponse(response) {
            if (response.redirected) return false;
            const contentType = response.headers.get('Content-Type') || '';
            return contentType.indexOf('text/event-stream') !== -1;
        }

        function sendMessage() {
            const message = chatInput.value.trim();
            if (!message || !chatProviderSelect) return;

            addMessage('You', message, '');
            chatInput.value = '';
            chatInput.disabled = true;
            sendChatBtn.disabled = true;

            const providerId = chatProviderSelect.value;
            const providerLabel = chatProviderSelect.options[chatProviderSelect.selectedIndex].textContent;
            let replyContentEl = null;

            fetch(`/api/chat/${fileId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId, message })
            })
            .then(function(response) {
                if (!isSseResponse(response)) {
                    // Not a real SSE stream — most likely a dead session
                    // redirected to the login page, or a JSON validation
                    // error (400/404) from before headers were committed to
                    // SSE. Try to recover a real message from JSON; if that
                    // also fails (e.g. it's the login page's HTML), fall
                    // back to a generic "session expired" message.
                    return response.json()
                        .then(function(data) {
                            addMessage('Error', (data && data.message) || 'Something went wrong.', 'error-message');
                        })
                        .catch(function() {
                            addMessage('Error', 'Your session expired — reload the page and sign in again.', 'error-message');
                        });
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                function readChunk() {
                    return reader.read().then(function(result) {
                        if (result.done) return;
                        buffer += decoder.decode(result.value, { stream: true });
                        const events = buffer.split('\n\n');
                        buffer = events.pop();
                        events.forEach(function(eventText) {
                            if (!eventText.startsWith('data: ')) return;
                            const payload = JSON.parse(eventText.slice(6));
                            if (payload.type === 'delta') {
                                if (!replyContentEl) {
                                    replyContentEl = addMessage(providerLabel, '', 'agent-message');
                                }
                                replyContentEl.textContent += payload.text;
                                chatMessages.scrollTop = chatMessages.scrollHeight;
                            } else if (payload.type === 'error') {
                                addMessage('Error', payload.message, 'error-message');
                            }
                        });
                        return readChunk();
                    });
                }

                return readChunk();
            })
            .catch(function() {
                addMessage('Error', 'Could not reach the server — check your connection and try again.', 'error-message');
            })
            .then(function() {
                chatInput.disabled = false;
                sendChatBtn.disabled = false;
                chatInput.focus();
            });
        }

        sendChatBtn.addEventListener('click', sendMessage);

        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendMessage();
            }
        });

        loadHistory();
    }
    
    // Simple markdown to HTML converter
    function escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function convertMarkdownToHtml(markdown) {
        // Simple conversion for demo purposes
        let html = escapeHtml(markdown)
            .replace(/^# (.*)$/gm, '<h1>$1</h1>')
            .replace(/^## (.*)$/gm, '<h2>$1</h2>')
            .replace(/^### (.*)$/gm, '<h3>$1</h3>')
            .replace(/^\*\*([^*]+)\*\*$/gm, '<strong>$1</strong>')
            .replace(/^\*([^*]+)\*$/gm, '<em>$1</em>')
            .replace(/^\- (.*)$/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
        
        // Wrap in paragraph tags
        if (!html.startsWith('<')) {
            html = `<p>${html}</p>`;
        }

        return html;
    }

    // Projects overview: relative "updated" times
    function formatRelativeTime(iso) {
        const diffMs = Date.now() - new Date(iso).getTime();
        const mins = Math.round(diffMs / 60000);
        if (mins < 1) return 'updated just now';
        if (mins < 60) return `updated ${mins}m ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `updated ${hours}h ago`;
        const days = Math.round(hours / 24);
        return `updated ${days}d ago`;
    }

    document.querySelectorAll('time[data-updated]').forEach(function(el) {
        el.textContent = formatRelativeTime(el.getAttribute('data-updated'));
    });

    // Projects overview: New Project - creates the project via the API and
    // navigates straight to its default file.
    const newProjectBtn = document.getElementById('new-project-btn');
    const projectsList = document.querySelector('.projects-list');

    if (newProjectBtn && projectsList) {
        function openNewProjectForm() {
            if (document.getElementById('new-project-form')) return;

            const form = document.createElement('form');
            form.id = 'new-project-form';
            form.className = 'new-project-form';

            const input = document.createElement('input');
            input.type = 'text';
            input.id = 'new-project-name';
            input.placeholder = 'Project name';
            input.maxLength = 60;
            input.autocomplete = 'off';

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'submit';
            confirmBtn.className = 'btn';
            confirmBtn.setAttribute('aria-label', 'Create project');
            confirmBtn.title = 'Create';
            confirmBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn';
            cancelBtn.setAttribute('aria-label', 'Cancel');
            cancelBtn.title = 'Cancel';
            cancelBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>';

            form.appendChild(input);
            form.appendChild(confirmBtn);
            form.appendChild(cancelBtn);

            newProjectBtn.replaceWith(form);
            input.focus();

            function restoreButton() {
                form.replaceWith(newProjectBtn);
            }

            form.addEventListener('submit', function(e) {
                e.preventDefault();
                const name = input.value.trim();
                if (!name) return;
                confirmBtn.disabled = true;
                fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (data.success) {
                        window.location.href = `/writing?project=${data.project.id}&file=${data.file.id}`;
                    } else {
                        confirmBtn.disabled = false;
                        input.focus();
                    }
                })
                .catch(function() {
                    confirmBtn.disabled = false;
                });
            });

            cancelBtn.addEventListener('click', restoreButton);
        }

        newProjectBtn.addEventListener('click', openNewProjectForm);

        if (window.location.hash === '#new-project') {
            openNewProjectForm();
        }
    }

    // Settings page: resolve each provider's avatar (custom URL > known-brand
    // icon via Simple Icons > initials+color fallback, same visual pattern as
    // the collaborator presence avatars).
    const KNOWN_PROVIDER_ICONS = [
        { pattern: /openai|gpt/i, slug: 'openai' },
        { pattern: /anthropic|claude/i, slug: 'anthropic' },
        { pattern: /google|gemini/i, slug: 'googlegemini' },
        { pattern: /mistral/i, slug: 'mistralai' },
        // ollama must be checked before meta|llama - "ollama" contains the
        // substring "llama", so the meta pattern would otherwise always win.
        { pattern: /ollama/i, slug: 'ollama' },
        { pattern: /meta|llama/i, slug: 'meta' }
    ];

    const AVATAR_COLORS = ['var(--presence-you)', 'var(--presence-2)', 'var(--presence-3)'];

    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash * 31 + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }

    function initialsFor(label) {
        // Punctuation-only "words" (e.g. a spaced en-dash in "OpenClaw – home")
        // shouldn't count as a word on their own, and shouldn't contribute a
        // non-alphanumeric character to the initials.
        const words = label.trim().split(/\s+/).filter(function(w) { return /[a-z0-9]/i.test(w); });
        if (words.length === 0) return '?';
        if (words.length === 1) {
            const alnum = words[0].replace(/[^a-z0-9]/gi, '');
            return (alnum.slice(0, 2) || '?').toUpperCase();
        }
        const firstChar = words[0].match(/[a-z0-9]/i)[0];
        const secondChar = words[1].match(/[a-z0-9]/i)[0];
        return (firstChar + secondChar).toUpperCase();
    }

    function renderInitialsFallback(target, label) {
        // The user's own profile avatar (data-skip-brand-lookup="true") always
        // uses AVATAR_COLORS[0] (--presence-you) so it visually matches the
        // "this is you" cursor-line tint, instead of a hash-derived color that
        // would only coincidentally line up with --presence-you.
        const isOwnProfile = target.dataset.skipBrandLookup === 'true';
        const color = isOwnProfile
            ? AVATAR_COLORS[0]
            : AVATAR_COLORS[hashString(label) % AVATAR_COLORS.length];
        target.style.backgroundColor = color;
        target.textContent = initialsFor(label);
    }

    function resolveProviderAvatar(target) {
        const customUrl = target.dataset.avatarUrl;
        const label = target.dataset.label || '';
        const skipBrandLookup = target.dataset.skipBrandLookup === 'true';

        function withImageFallback(src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = label;
            img.onerror = function() {
                // The image (custom URL, or cdn.simpleicons.org - which may be
                // unreachable from a self-hosted/Tailscale-only deployment)
                // failed to load. Drop it and fall back to initials+color
                // instead of leaving a blank circle.
                img.remove();
                renderInitialsFallback(target, label);
            };
            target.appendChild(img);
        }

        if (customUrl) {
            withImageFallback(customUrl);
            return;
        }

        if (!skipBrandLookup) {
            const known = KNOWN_PROVIDER_ICONS.find(function(entry) { return entry.pattern.test(label); });
            if (known) {
                withImageFallback(`https://cdn.simpleicons.org/${known.slug}`);
                return;
            }
        }

        renderInitialsFallback(target, label);
    }

    document.querySelectorAll('[data-avatar-target]').forEach(resolveProviderAvatar);

    // Writing view: highlight the line your cursor is currently on.
    const lineTint = document.getElementById('cursor-line-tint');
    if (editorTextarea && lineTint) {
        // Matches .editor-textarea's 14px font-size * 1.5 line-height.
        const LINE_HEIGHT_PX = 21;

        function updateCursorLineTint() {
            const value = editorTextarea.value;
            const cursorPos = editorTextarea.selectionStart;
            const linesBeforeCursor = value.slice(0, cursorPos).split('\n').length - 1;
            const top = linesBeforeCursor * LINE_HEIGHT_PX - editorTextarea.scrollTop;
            lineTint.style.top = `${top}px`;
        }

        editorTextarea.addEventListener('click', updateCursorLineTint);
        editorTextarea.addEventListener('keyup', updateCursorLineTint);
        editorTextarea.addEventListener('input', updateCursorLineTint);
        editorTextarea.addEventListener('select', updateCursorLineTint);
        editorTextarea.addEventListener('scroll', updateCursorLineTint);
        updateCursorLineTint();
    }

    // Settings page: add/edit/delete provider forms
    const providersList = document.getElementById('providers-list');
    const newProviderBtn = document.getElementById('new-provider-btn');

    if (providersList && newProviderBtn) {
        function buildProviderForm(existing) {
            const form = document.createElement('form');
            form.className = 'provider-form';

            const labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.placeholder = 'Label (e.g. "Claude direct")';
            labelInput.required = true;
            labelInput.autocomplete = 'off';
            labelInput.value = existing ? existing.label : '';

            const baseUrlInput = document.createElement('input');
            baseUrlInput.type = 'text';
            baseUrlInput.placeholder = 'Base URL (e.g. https://api.anthropic.com/v1)';
            baseUrlInput.required = true;
            baseUrlInput.autocomplete = 'off';
            baseUrlInput.value = existing ? existing.baseUrl : '';

            const apiKeyInput = document.createElement('input');
            apiKeyInput.type = 'password';
            apiKeyInput.placeholder = existing ? 'New API key (leave blank to keep current)' : 'API key';
            apiKeyInput.required = !existing;
            // 'new-password' tells the browser this is a credential field
            // without inviting it to autofill a previously-saved password.
            apiKeyInput.autocomplete = 'new-password';

            const defaultModelInput = document.createElement('input');
            defaultModelInput.type = 'text';
            defaultModelInput.placeholder = 'Default model (optional)';
            defaultModelInput.autocomplete = 'off';
            defaultModelInput.value = existing ? existing.defaultModel : '';

            const reasoningEffortSelect = document.createElement('select');
            [
                { value: '', label: 'Reasoning effort: none' },
                { value: 'low', label: 'Reasoning effort: low' },
                { value: 'medium', label: 'Reasoning effort: medium' },
                { value: 'high', label: 'Reasoning effort: high' }
            ].forEach(function(opt) {
                const optionEl = document.createElement('option');
                optionEl.value = opt.value;
                optionEl.textContent = opt.label;
                reasoningEffortSelect.appendChild(optionEl);
            });
            reasoningEffortSelect.value = existing ? (existing.defaultReasoningEffort || '') : '';

            const avatarUrlInput = document.createElement('input');
            avatarUrlInput.type = 'text';
            avatarUrlInput.placeholder = 'Avatar image URL (optional)';
            avatarUrlInput.autocomplete = 'off';
            avatarUrlInput.value = existing ? existing.avatarUrl : '';

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'submit';
            confirmBtn.className = 'btn';
            confirmBtn.setAttribute('aria-label', existing ? 'Save provider' : 'Create provider');
            confirmBtn.title = existing ? 'Save' : 'Create';
            confirmBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn';
            cancelBtn.setAttribute('aria-label', 'Cancel');
            cancelBtn.title = 'Cancel';
            cancelBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>';

            const actions = document.createElement('div');
            actions.className = 'provider-form-actions';
            actions.appendChild(confirmBtn);
            actions.appendChild(cancelBtn);

            const errorEl = document.createElement('p');
            errorEl.className = 'provider-form-error';
            errorEl.hidden = true;

            function showFormError(message) {
                errorEl.textContent = message;
                errorEl.hidden = false;
            }

            function clearFormError() {
                errorEl.hidden = true;
                errorEl.textContent = '';
            }

            form.appendChild(labelInput);
            form.appendChild(baseUrlInput);
            form.appendChild(apiKeyInput);
            form.appendChild(defaultModelInput);
            form.appendChild(reasoningEffortSelect);
            form.appendChild(avatarUrlInput);
            form.appendChild(actions);
            form.appendChild(errorEl);

            form.addEventListener('submit', function(e) {
                e.preventDefault();
                clearFormError();
                confirmBtn.disabled = true;
                const payload = {
                    label: labelInput.value.trim(),
                    baseUrl: baseUrlInput.value.trim(),
                    apiKey: apiKeyInput.value.trim(),
                    defaultModel: defaultModelInput.value.trim(),
                    defaultReasoningEffort: reasoningEffortSelect.value,
                    avatarUrl: avatarUrlInput.value.trim()
                };
                const url = existing ? `/api/providers/${existing.id}` : '/api/providers';
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (data.success) {
                        window.location.reload();
                    } else {
                        confirmBtn.disabled = false;
                        showFormError(data.message || 'Something went wrong.');
                    }
                })
                .catch(function() {
                    confirmBtn.disabled = false;
                    showFormError('Could not reach the server — check your connection and try again.');
                });
            });

            return { form, cancelBtn };
        }

        newProviderBtn.addEventListener('click', function() {
            if (document.querySelector('.provider-form')) return;
            newProviderBtn.disabled = true;
            const { form, cancelBtn } = buildProviderForm(null);
            const wrapper = document.createElement('div');
            wrapper.className = 'provider-card';
            wrapper.appendChild(form);
            providersList.insertBefore(wrapper, providersList.firstChild);
            cancelBtn.addEventListener('click', function() {
                wrapper.remove();
                newProviderBtn.disabled = false;
            });
            form.querySelector('input').focus();
        });

        providersList.addEventListener('click', function(e) {
            const editBtn = e.target.closest('.provider-edit-btn');
            const deleteBtn = e.target.closest('.provider-delete-btn');

            if (editBtn) {
                const card = editBtn.closest('.provider-card');
                if (card.querySelector('.provider-form')) return;
                const existing = {
                    id: card.dataset.providerId,
                    label: card.dataset.label,
                    baseUrl: card.dataset.baseUrl,
                    defaultModel: card.dataset.defaultModel,
                    defaultReasoningEffort: card.dataset.defaultReasoningEffort,
                    avatarUrl: card.dataset.avatarUrl
                };
                const info = card.querySelector('.project-info');
                const { form, cancelBtn } = buildProviderForm(existing);
                info.replaceWith(form);
                cancelBtn.addEventListener('click', function() {
                    form.replaceWith(info);
                });
            }

            if (deleteBtn) {
                if (!window.confirm('Delete this provider? This cannot be undone.')) return;

                const card = deleteBtn.closest('.provider-card');
                const info = card.querySelector('.project-info');

                function showDeleteError(message) {
                    if (!info) return;
                    let errorEl = info.querySelector('.provider-form-error');
                    if (!errorEl) {
                        errorEl = document.createElement('p');
                        errorEl.className = 'provider-form-error';
                        info.appendChild(errorEl);
                    }
                    errorEl.textContent = message;
                    errorEl.hidden = false;
                }

                if (info) {
                    const existingError = info.querySelector('.provider-form-error');
                    if (existingError) existingError.remove();
                }

                deleteBtn.disabled = true;
                fetch(`/api/providers/${card.dataset.providerId}/delete`, { method: 'POST' })
                    .then(function(response) { return response.json(); })
                    .then(function(data) {
                        if (data.success) {
                            card.remove();
                        } else {
                            deleteBtn.disabled = false;
                            showDeleteError(data.message || 'Something went wrong.');
                        }
                    })
                    .catch(function() {
                        deleteBtn.disabled = false;
                        showDeleteError('Could not reach the server — check your connection and try again.');
                    });
            }
        });
    }

    // Settings page: your profile card
    const profileCard = document.getElementById('profile-card');
    if (profileCard) {
        profileCard.addEventListener('click', function(e) {
            const editBtn = e.target.closest('.profile-edit-btn');
            if (!editBtn) return;
            if (profileCard.querySelector('form')) return;

            const info = profileCard.querySelector('.project-info');
            const form = document.createElement('form');
            form.className = 'provider-form';

            const labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.placeholder = 'Your name';
            labelInput.required = true;
            labelInput.autocomplete = 'off';
            labelInput.value = profileCard.dataset.label;

            const avatarUrlInput = document.createElement('input');
            avatarUrlInput.type = 'text';
            avatarUrlInput.placeholder = 'Avatar image URL (optional)';
            avatarUrlInput.autocomplete = 'off';
            avatarUrlInput.value = profileCard.dataset.avatarUrl;

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'submit';
            confirmBtn.className = 'btn';
            confirmBtn.setAttribute('aria-label', 'Save profile');
            confirmBtn.title = 'Save';
            confirmBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn';
            cancelBtn.setAttribute('aria-label', 'Cancel');
            cancelBtn.title = 'Cancel';
            cancelBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>';

            const actions = document.createElement('div');
            actions.className = 'provider-form-actions';
            actions.appendChild(confirmBtn);
            actions.appendChild(cancelBtn);

            const errorEl = document.createElement('p');
            errorEl.className = 'provider-form-error';
            errorEl.hidden = true;

            form.appendChild(labelInput);
            form.appendChild(avatarUrlInput);
            form.appendChild(actions);
            form.appendChild(errorEl);

            form.addEventListener('submit', function(ev) {
                ev.preventDefault();
                errorEl.hidden = true;
                confirmBtn.disabled = true;
                fetch('/api/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        label: labelInput.value.trim(),
                        avatarUrl: avatarUrlInput.value.trim()
                    })
                })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (data.success) {
                        window.location.reload();
                    } else {
                        confirmBtn.disabled = false;
                        errorEl.textContent = data.message || 'Something went wrong.';
                        errorEl.hidden = false;
                    }
                })
                .catch(function() {
                    confirmBtn.disabled = false;
                    errorEl.textContent = 'Could not reach the server — check your connection and try again.';
                    errorEl.hidden = false;
                });
            });

            info.replaceWith(form);
            cancelBtn.addEventListener('click', function() {
                form.replaceWith(info);
            });
        });
    }

    // Settings page: toggle a provider's active-in-workspace state
    if (providersList) {
        providersList.addEventListener('click', function(e) {
            const toggleBtn = e.target.closest('.provider-toggle-active-btn');
            if (!toggleBtn) return;

            const card = toggleBtn.closest('.provider-card');
            const currentlyActive = toggleBtn.dataset.active === 'true';

            toggleBtn.disabled = true;
            fetch(`/api/providers/${card.dataset.providerId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label: card.dataset.label,
                    baseUrl: card.dataset.baseUrl,
                    apiKey: '',
                    defaultModel: card.dataset.defaultModel,
                    avatarUrl: card.dataset.avatarUrl,
                    activeInWorkspace: !currentlyActive
                })
            })
            .then(function(response) { return response.json(); })
            .then(function(data) {
                if (data.success) {
                    window.location.reload();
                } else {
                    toggleBtn.disabled = false;
                }
            })
            .catch(function() {
                toggleBtn.disabled = false;
            });
        });
    }
});