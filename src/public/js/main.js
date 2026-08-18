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
    
    // Chat functionality with Enter key support
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const chatMessages = document.querySelector('.chat-messages');
    
    if (chatInput && sendChatBtn && chatMessages) {
        function sendMessage() {
            const message = chatInput.value.trim();
            if (message) {
                addMessage('You', message, true);
                chatInput.value = '';
                
                // Simulate agent response after a short delay
                setTimeout(() => {
                    addMessage('Agent', 'I\'ve received your message. How can I help you with this file?', false);
                }, 1000);
            }
        }
        
        // Send on button click
        sendChatBtn.addEventListener('click', sendMessage);
        
        // Send on Enter key press (with Ctrl modifier for clarity)
        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent default form submission
                sendMessage();
            }
        });
        
        function addMessage(author, content, isUser) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isUser ? '' : 'agent-message'}`;

            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const authorDiv = document.createElement('div');
            authorDiv.className = 'message-author';
            authorDiv.textContent = author;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = content;

            const timeDiv = document.createElement('div');
            timeDiv.className = 'message-time';
            timeDiv.textContent = timeString;

            messageDiv.appendChild(authorDiv);
            messageDiv.appendChild(contentDiv);
            messageDiv.appendChild(timeDiv);

            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
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

    // Writing view: presence avatars + a decorative live-cursor preview.
    // Mock collaborators only - there's no multi-user backend yet (M6).
    const PRESENCE_USERS = [
        { name: 'You', initials: 'Y', color: 'var(--presence-you)' },
        { name: 'Ada Chen', initials: 'AC', color: 'var(--presence-2)' },
        { name: 'Milo Reyes', initials: 'MR', color: 'var(--presence-3)' }
    ];

    const presenceStack = document.getElementById('presence-stack');
    if (presenceStack) {
        PRESENCE_USERS.forEach(function(user) {
            const avatar = document.createElement('div');
            avatar.className = 'presence-avatar';
            avatar.style.backgroundColor = user.color;
            avatar.textContent = user.initials;
            avatar.title = user.name;
            presenceStack.appendChild(avatar);
        });
    }

    const cursorLineTint = document.getElementById('cursor-line-tint');
    if (cursorLineTint) {
        const demoUser = PRESENCE_USERS[1];
        cursorLineTint.style.backgroundColor = `color-mix(in srgb, ${demoUser.color} 14%, transparent)`;
    }

    const cursorFlag = document.getElementById('cursor-demo');
    if (cursorFlag) {
        const demoUser = PRESENCE_USERS[1];
        const caret = document.createElement('span');
        caret.className = 'caret';
        caret.style.backgroundColor = demoUser.color;
        const label = document.createElement('span');
        label.textContent = demoUser.name;
        cursorFlag.appendChild(caret);
        cursorFlag.appendChild(label);
    }
});