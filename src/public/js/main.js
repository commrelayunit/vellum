// Vellum JavaScript

// Swaps a button's icon for a spinning ring while an async action is in
// flight, restoring the original icon afterward. The button's current
// innerHTML is stashed on the element itself (not in a module-level map) so
// concurrent calls for different buttons never collide.
function setButtonLoading(btn, loading) {
    if (loading) {
        if (btn.dataset.loading === 'true') return;
        btn.dataset.loading = 'true';
        btn.dataset.originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="btn-spinner"></span>';
        btn.disabled = true;
    } else {
        if (btn.dataset.loading !== 'true') return;
        btn.innerHTML = btn.dataset.originalHtml;
        delete btn.dataset.loading;
        delete btn.dataset.originalHtml;
        btn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Toggle chat panel. setChatCollapsed is also used by the collapsed
    // rail's own Chat/Review icons further below (window-scoped, since
    // they're wired up alongside setPanel() in the chat/review block) to
    // force-expand regardless of current state.
    const toggleChatBtn = document.getElementById('toggle-chat');
    const chatPanel = document.getElementById('chat-panel');

    function setChatCollapsed(collapsed) {
        if (!chatPanel) return;
        chatPanel.classList.toggle('collapsed', collapsed);
        if (toggleChatBtn) {
            toggleChatBtn.setAttribute('aria-expanded', String(!collapsed));
            toggleChatBtn.setAttribute('aria-label', collapsed ? 'Expand chat' : 'Collapse chat');
            toggleChatBtn.setAttribute('title', collapsed ? 'Expand chat' : 'Collapse chat');
        }
    }

    if (toggleChatBtn && chatPanel) {
        toggleChatBtn.addEventListener('click', function() {
            setChatCollapsed(!chatPanel.classList.contains('collapsed'));
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
            menuDropdown.hidden = true;
            menuToggle.setAttribute('aria-expanded', 'false');
        }

        function openMenu() {
            menuDropdown.classList.add('open');
            menuDropdown.hidden = false;
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
    const editorContainer = document.getElementById('markdown-editor');
    const previewContent = document.createElement('div');
    previewContent.id = 'preview-content';
    previewContent.className = 'preview-content';
    previewContent.style.display = 'none';

    const EYE_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
    const PENCIL_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';

    // Insert preview element after the editor's mount container
    if (editorContainer && previewToggle) {
        editorContainer.parentNode.appendChild(previewContent);

        previewToggle.addEventListener('click', function() {
            if (editorContainer.style.display === 'none') {
                // Show editor, hide preview
                editorContainer.style.display = '';
                previewContent.style.display = 'none';
                previewToggle.innerHTML = EYE_ICON;
                previewToggle.setAttribute('aria-label', 'Show preview');
                previewToggle.setAttribute('title', 'Preview');
            } else {
                // Convert markdown to HTML and show preview, hide editor
                const markdownContent = window.__vellumEditorView ? window.__vellumEditorView.state.doc.toString() : '';
                const htmlContent = window.__vellumRenderMarkdown ? window.__vellumRenderMarkdown(markdownContent) : '<p>Preview renderer is unavailable.</p>';
                previewContent.innerHTML = htmlContent;
                editorContainer.style.display = 'none';
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
            const content = window.__vellumEditorView ? window.__vellumEditorView.state.doc.toString() : '';
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

    // File switcher: switch between a project's files, and create, rename,
    // or delete them - mirrors the projects-page new/rename-in-place forms
    // and the existing window.confirm() delete pattern (clear-chat,
    // delete-provider) rather than introducing new UI conventions.
    const fileSwitcher = document.getElementById('file-switcher');
    if (fileSwitcher) {
        const projectId = fileSwitcher.dataset.projectId;
        const currentFileId = fileSwitcher.dataset.fileId;
        const fileSelect = document.getElementById('file-select');
        const switcherControls = document.getElementById('file-switcher-controls');
        const newFileBtn = document.getElementById('new-file-btn');
        const renameFileBtn = document.getElementById('rename-file-btn');
        const deleteFileBtn = document.getElementById('delete-file-btn');

        if (fileSelect) {
            fileSelect.addEventListener('change', function() {
                window.location.href = `/writing?project=${projectId}&file=${fileSelect.value}`;
            });
        }

        function openInlineForm(placeholder, initialValue, onSubmit) {
            if (switcherControls.querySelector('.provider-form')) return;

            const form = document.createElement('form');
            form.className = 'provider-form file-switcher-form';

            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = placeholder;
            input.required = true;
            input.maxLength = 80;
            input.autocomplete = 'off';
            input.value = initialValue || '';

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'submit';
            confirmBtn.className = 'btn';
            confirmBtn.setAttribute('aria-label', 'Save');
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

            form.appendChild(input);
            form.appendChild(actions);
            form.appendChild(errorEl);

            switcherControls.replaceWith(form);
            input.focus();

            cancelBtn.addEventListener('click', function() {
                form.replaceWith(switcherControls);
            });

            form.addEventListener('submit', function(e) {
                e.preventDefault();
                errorEl.hidden = true;
                setButtonLoading(confirmBtn, true);
                onSubmit(input.value.trim())
                    .then(function(data) {
                        if (!data.success) {
                            setButtonLoading(confirmBtn, false);
                            errorEl.textContent = data.message || 'Something went wrong.';
                            errorEl.hidden = false;
                        }
                        // On success we navigate/reload rather than restore
                        // switcherControls - the page is about to change.
                    })
                    .catch(function() {
                        setButtonLoading(confirmBtn, false);
                        errorEl.textContent = 'Could not reach the server — check your connection and try again.';
                        errorEl.hidden = false;
                    });
            });
        }

        if (newFileBtn) {
            newFileBtn.addEventListener('click', function() {
                openInlineForm('File name', '', function(name) {
                    return fetch(`/api/projects/${projectId}/files`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name })
                    })
                    .then(function(response) { return response.json(); })
                    .then(function(data) {
                        if (data.success) {
                            window.location.href = `/writing?project=${projectId}&file=${data.file.id}`;
                        }
                        return data;
                    });
                });
            });
        }

        if (renameFileBtn) {
            renameFileBtn.addEventListener('click', function() {
                openInlineForm('File name', fileSwitcher.dataset.fileTitle, function(name) {
                    return fetch(`/api/files/${currentFileId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name })
                    })
                    .then(function(response) { return response.json(); })
                    .then(function(data) {
                        if (data.success) {
                            window.location.reload();
                        }
                        return data;
                    });
                });
            });
        }

        if (deleteFileBtn) {
            deleteFileBtn.addEventListener('click', function() {
                if (!window.confirm('Delete this file? This cannot be undone.')) return;
                setButtonLoading(deleteFileBtn, true);
                fetch(`/api/files/${currentFileId}/delete`, { method: 'POST' })
                    .then(function(response) { return response.json(); })
                    .then(function(data) {
                        if (data.success) {
                            window.location.href = `/writing?project=${projectId}`;
                        } else {
                            setButtonLoading(deleteFileBtn, false);
                            window.alert(data.message || 'Could not delete file.');
                        }
                    })
                    .catch(function() {
                        setButtonLoading(deleteFileBtn, false);
                    });
            });
        }
    }

    // Fallback periodic save. The WebSocket sync layer (added in a later
    // task) is the primary durability path once connected; this keeps
    // working standalone if that connection is ever unavailable.
    if (editorContainer) {
        let saveTimeout;
        function scheduleFallbackSave() {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(saveContent, 1000);
        }
        document.addEventListener('vellum:editor-changed', scheduleFallbackSave);

        function saveContent() {
            const fileId = editorContainer.dataset.fileId;
            const content = window.__vellumEditorView ? window.__vellumEditorView.state.doc.toString() : '';

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

    // Shared identity-color resolution + avatar rendering, used by the
    // presence-stack avatars, Settings page provider avatars, chat message
    // authors, and the Review tab's proposal cards - one place decides "what
    // color is this participant", so the same provider/profile reads the
    // same color everywhere it shows up. Hoisted above the chat/review code
    // below (which now also calls these) rather than left where it
    // originally sat, further down, serving only the Settings page's own
    // provider avatars.
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
    // Real hex mirrors of the --presence-* CSS custom properties (style.css).
    // <input type="color"> can't resolve a var() reference, so a color
    // picker's default swatch needs an actual hex value to show.
    const HEX_PRESENCE_COLORS = ['#2F6F64', '#C96F48', '#5B6EAE'];

    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash * 31 + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }

    // A custom color (the user's chosen cursor color, or a provider's chosen
    // color) always wins. Otherwise the user's own profile uses
    // AVATAR_COLORS[0] (--presence-you) so it visually matches the "this is
    // you" cursor-line tint, and everyone else falls back to a hash-derived
    // color from the same 3-color palette - the one rule every avatar,
    // chat-message author, and proposal author color resolves through.
    function resolveAvatarColor(customColor, isOwnProfile, label) {
        const color = customColor
            ? customColor
            : isOwnProfile
                ? AVATAR_COLORS[0]
                : AVATAR_COLORS[hashString(label) % AVATAR_COLORS.length];
        return color;
    }

    // Chat messages and Review proposals only ever carry a provider_color
    // SNAPSHOT, taken once at creation time (chat_messages/
    // agent_edit_proposals, see migrations 0011-0014) - so a provider's
    // color change in Settings previously never reached anything already
    // sent, which is the mismatch flagged in review. providerColorsById maps
    // providerId -> that provider's color AS CONFIGURED RIGHT NOW (including
    // providers deactivated but not deleted); it's fetched on load and
    // refreshed whenever this tab regains visibility (e.g. after editing a
    // color in Settings in another tab), so returning to an already-open
    // writing page repaints every author color live instead of only on a
    // full reload. A providerId with no entry here (the provider was
    // deleted) intentionally falls through to the snapshot - that's the one
    // case a snapshot is actually the right answer, since there's no "current
    // color" left to ask for.
    let providerColorsById = null;
    let providerIdentitiesById = null;
    let providerIdentitiesByLabel = null;
    let profileIdentity = null;

    // Historical messages and proposals created before provider_id was
    // recorded only have a label. Resolve those records only when today's
    // configured providers contain exactly one case-sensitive label match;
    // a missing or duplicate label must retain its saved snapshot instead
    // of silently attributing an old record to the wrong participant.
    function uniqueProviderByLabel(identitiesByLabel, label) {
        if (!label || !identitiesByLabel) return null;
        const matches = identitiesByLabel[label];
        return Array.isArray(matches) && matches.length === 1 ? matches[0] : null;
    }
    function loadProviderColors() {
        return fetch('/api/providers/colors')
            .then((r) => r.json())
            .then((data) => {
                if (!data.success) {
                    providerColorsById = {}; providerIdentitiesById = {}; providerIdentitiesByLabel = {};
                    return;
                }
                const map = {};
                const identities = {};
                const identitiesByLabel = {};
                data.providers.forEach((p) => {
                    map[p.id] = p.color;
                    identities[p.id] = p;
                    if (!identitiesByLabel[p.label]) identitiesByLabel[p.label] = [];
                    identitiesByLabel[p.label].push(p);
                });
                providerColorsById = map;
                providerIdentitiesById = identities;
                providerIdentitiesByLabel = identitiesByLabel;
                profileIdentity = data.profile || null;
            })
            // A failed optional live-color refresh must still unblock Chat;
            // snapshots/fallbacks remain the resilient behavior offline.
            .catch(() => { providerColorsById = {}; providerIdentitiesById = {}; providerIdentitiesByLabel = {}; });
    }
    // Keep the initial request as a promise that the first Chat render and
    // first streamed reply can await. Previously both used the still-null
    // map while this request was in flight, so a saved provider color lost
    // to the hash fallback on the page's first paint.
    const providerColorsReady = loadProviderColors();

    // providerId may be null/undefined (no provider on record, or this
    // message/proposal predates the provider_id column) - always fall back
    // to the snapshot in that case too.
    function resolveProviderColorById(providerId, snapshotColor, label) {
        if (providerId != null && providerColorsById && Object.prototype.hasOwnProperty.call(providerColorsById, providerId)) {
            return resolveAvatarColor(providerColorsById[providerId], false, label);
        }
        return resolveAvatarColor(snapshotColor, false, label);
    }
    function resolveProviderIdentityById(providerId, snapshotColor, snapshotLabel) {
        // Current records are deliberately id-only: label matching is a
        // compatibility bridge for null-ID history, never a fallback for a
        // present but deleted/unrecognised id.
        const live = providerId != null
            ? providerIdentitiesById && providerIdentitiesById[providerId]
            : uniqueProviderByLabel(providerIdentitiesByLabel, snapshotLabel);
        const label = (live && live.label) || snapshotLabel || 'Agent';
        return {
            label,
            avatarUrl: live && live.avatarUrl,
            color: live ? resolveAvatarColor(live.color, false, label) : resolveProviderColorById(providerId, snapshotColor, label)
        };
    }

    // The hex a color-picker swatch should default to when no custom color is
    // set yet: the same color resolveAvatarColor would currently paint, so
    // opening the picker doesn't jarringly default to black.
    function defaultColorFor(label, isOwnProfile) {
        return isOwnProfile
            ? HEX_PRESENCE_COLORS[0]
            : HEX_PRESENCE_COLORS[hashString(label) % HEX_PRESENCE_COLORS.length];
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
        const isOwnProfile = target.dataset.skipBrandLookup === 'true';
        const customColor = target.dataset.color;
        const color = resolveAvatarColor(customColor, isOwnProfile, label);
        target.style.backgroundColor = color;
        target.textContent = initialsFor(label);
    }

    // The small colored-circle-plus-initials identity chip reused next to
    // chat message authors and Review proposal cards - the same visual
    // identity treatment as the presence-stack/Settings avatars above, just
    // smaller and inline with text rather than a standalone element.
    // Decorative: the author's name is rendered as real text right next to
    // it, so assistive tech doesn't need this element announced too.
    function buildIdentityChip(label, color, avatarUrl) {
        const chip = document.createElement('span');
        chip.className = 'identity-chip';
        chip.style.backgroundColor = color;
        if (avatarUrl) {
            const image = document.createElement('img'); image.src = avatarUrl; image.alt = '';
            image.onerror = function() { image.remove(); chip.textContent = initialsFor(label); };
            chip.appendChild(image);
        } else chip.textContent = initialsFor(label);
        chip.setAttribute('aria-hidden', 'true');
        return chip;
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

    // Chat functionality: real streaming completions, per-file history
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const chatMessages = document.querySelector('.chat-messages');
    const chatProviderSelect = document.getElementById('chat-provider-select');
    const editorForChat = document.getElementById('markdown-editor');

    // Review is a peer tab, not a modal or a second chat. Proposal state is
    // read from the durable API each time it is opened so reloads and other
    // collaborators are reflected without trusting browser memory.
    const reviewTab = document.getElementById('review-tab');
    const chatTab = document.getElementById('chat-tab');
    const reviewContent = document.getElementById('review-content');
    const chatContent = document.getElementById('chat-content');
    const reviewList = document.getElementById('review-list');
    const reviewSummary = document.getElementById('review-summary');
    const reviewCount = document.getElementById('review-pending-count');
    const chatPanelEl = document.getElementById('chat-panel');
    const collapsedChatBtn = document.getElementById('collapsed-chat-btn');
    const collapsedReviewBtn = document.getElementById('collapsed-review-btn');
    const collapsedReviewPending = document.getElementById('collapsed-review-pending');
    let reviewFileId = editorForChat && editorForChat.dataset.fileId;
    // Review is a peer tab sharing the same sidebar slot as Chat (see
    // #chat-content/#review-content in style.css) - the editor stays
    // visible and interactive the entire time, in both tabs and regardless
    // of collapse state.
    function setPanel(panel) {
        const reviewing = panel === 'review';
        if (!reviewContent || !chatContent) return;
        reviewContent.hidden = !reviewing; chatContent.hidden = reviewing;
        reviewTab.setAttribute('aria-selected', String(reviewing)); chatTab.setAttribute('aria-selected', String(!reviewing));
        reviewTab.classList.toggle('active', reviewing); chatTab.classList.toggle('active', !reviewing);
        if (chatPanelEl) chatPanelEl.classList.toggle('review-mode', reviewing);
        // Mirrors the active tab onto the collapsed rail's own icons, so
        // which panel you'll land on is still visible (and correct) even
        // while collapsed.
        if (collapsedChatBtn && collapsedReviewBtn) {
            collapsedChatBtn.classList.toggle('active', !reviewing);
            collapsedReviewBtn.classList.toggle('active', reviewing);
        }
        if (reviewing) loadReview();
    }
    // The collapsed rail's two icons are the "obvious expansion path" out of
    // a collapsed panel: clicking either expands AND switches straight to
    // that tab, rather than requiring the chevron first and a tab click
    // after.
    if (collapsedChatBtn) collapsedChatBtn.addEventListener('click', function() { setChatCollapsed(false); setPanel('chat'); });
    if (collapsedReviewBtn) collapsedReviewBtn.addEventListener('click', function() { setChatCollapsed(false); setPanel('review'); });
    function proposalText(label, value, extraClass) { const el = document.createElement('pre'); el.className = `proposal-text${extraClass ? ` ${extraClass}` : ''}`; el.textContent = `${label}\n${value}`; return el; }
    function truncateConcise(text) {
        const trimmed = (text || '').trim().replace(/\s+/g, ' ');
        return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
    }
    function locationLabel(p) {
        if (!p.start_line) return '';
        return p.start_line === p.end_line ? `L${p.start_line}` : `L${p.start_line}-${p.end_line}`;
    }

    // Revise opens a persistent, dismissible context card above the chat
    // composer (not a one-shot text insertion) so the quoted proposal stays
    // visible while the user types their instruction, and is included with
    // their next send. window-scoped so loadReview()'s Revise button and
    // sendMessage() below can share state without a module wrapper.
    const reviseContextCard = document.getElementById('revise-context-card');
    const reviseContextTitle = document.getElementById('revise-context-title');
    const reviseContextOriginal = document.getElementById('revise-context-original');
    const reviseContextProposed = document.getElementById('revise-context-proposed');
    const reviseContextDismiss = document.getElementById('revise-context-dismiss');
    let activeReviseContext = null;
    function showReviseContext(p) {
        activeReviseContext = { id: p.id, providerLabel: p.provider_label || 'Agent', oldText: p.old_text, newText: p.new_text };
        reviseContextTitle.textContent = `Revising ${activeReviseContext.providerLabel}'s proposal${locationLabel(p) ? ` (${locationLabel(p)})` : ''}`;
        reviseContextOriginal.textContent = `Original\n${p.old_text}`;
        reviseContextProposed.textContent = `Proposed\n${p.new_text}`;
        reviseContextCard.hidden = false;
    }
    function clearReviseContext() {
        activeReviseContext = null;
        reviseContextCard.hidden = true;
    }
    if (reviseContextDismiss) reviseContextDismiss.addEventListener('click', clearReviseContext);

    // Keep the two Review groups independently controllable while a refresh
    // (including the one after Accept/Reject) redraws their cards. Pending is
    // deliberately open on first visit; accepted edits are useful history but
    // should not compete with work that still needs a decision.
    const reviewSectionsExpanded = { pending: true, accepted: false };
    function reviewSection(title, state, proposals) {
        const section = document.createElement('section');
        section.className = `review-section review-section-${state}`;
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.className = 'review-section-toggle';
        toggle.setAttribute('aria-expanded', String(reviewSectionsExpanded[state]));
        const label = document.createElement('span'); label.textContent = title;
        const count = document.createElement('span'); count.className = 'review-section-count'; count.textContent = `(${proposals.length})`;
        toggle.append(label, count);
        const body = document.createElement('div'); body.className = 'review-section-body';
        body.hidden = !reviewSectionsExpanded[state];
        toggle.addEventListener('click', () => {
            reviewSectionsExpanded[state] = !reviewSectionsExpanded[state];
            toggle.setAttribute('aria-expanded', String(reviewSectionsExpanded[state]));
            body.hidden = !reviewSectionsExpanded[state];
        });
        section.append(toggle, body);
        return { section, body };
    }

    function loadReview() {
        if (!reviewFileId || !reviewList) return;
        fetch(`/api/files/${reviewFileId}/proposals`).then(async r => {
            const data = await r.json();
            if (!r.ok || !data.success) throw new Error(data.message || `Review request failed (${r.status})`);
            return data;
        }).then(data => {
            if (!data.success) throw new Error(data.message);
            const proposals = data.proposals; const pending = proposals.filter(p => p.state === 'pending').length;
            reviewCount.textContent = pending ? `(${pending})` : '';
            if (collapsedReviewPending) collapsedReviewPending.textContent = pending ? String(pending) : '';
            reviewSummary.textContent = `${pending} pending · ${proposals.filter(p => p.state === 'accepted').length} accepted · ${proposals.filter(p => p.state === 'rejected').length} rejected · ${proposals.filter(p => p.state === 'stale').length} stale · ${proposals.filter(p => p.state === 'conflict').length} conflict`;
            if (window.__vellumSetProposalMarkers) window.__vellumSetProposalMarkers(proposals);
            // If the proposal currently quoted in the Revise context card is
            // no longer pending (accepted/rejected/stale/conflict, by this
            // user or a collaborator), the card would otherwise keep
            // offering to revise a decision that's already settled.
            if (activeReviseContext) {
                const stillPending = proposals.find(p => p.id === activeReviseContext.id && p.state === 'pending');
                if (!stillPending) clearReviseContext();
            }
            reviewList.innerHTML = '';
            const pendingSection = reviewSection('Pending', 'pending', proposals.filter(p => p.state === 'pending'));
            const acceptedSection = reviewSection('Accepted', 'accepted', proposals.filter(p => p.state === 'accepted'));
            reviewList.append(pendingSection.section, acceptedSection.section);
            proposals.forEach(p => {
                const card = document.createElement('article'); card.className = `proposal-card proposal-${p.state}`;
                const identity = resolveProviderIdentityById(p.provider_id, p.provider_color, p.provider_label);
                const authorLabel = identity.label;
                const heading = document.createElement('h4');
                heading.appendChild(buildIdentityChip(authorLabel, identity.color, identity.avatarUrl));
                const loc = locationLabel(p);
                const headingText = document.createElement('span');
                headingText.textContent = `${p.state} · ${authorLabel}${loc ? ` · ${loc}` : ''}`;
                heading.appendChild(headingText);
                card.appendChild(heading);
                const summary = document.createElement('p'); summary.className = 'proposal-summary';
                summary.textContent = `"${truncateConcise(p.old_text)}" → "${truncateConcise(p.new_text)}"`;
                card.appendChild(summary);
                const diffPair = document.createElement('div'); diffPair.className = 'proposal-diff-pair';
                diffPair.appendChild(proposalText('Original', p.old_text, 'proposal-text-old'));
                diffPair.appendChild(proposalText('Proposed', p.new_text, 'proposal-text-new'));
                card.appendChild(diffPair);
                if (p.outcome_message) { const outcome = document.createElement('p'); outcome.className = 'proposal-outcome'; outcome.textContent = p.outcome_message; card.appendChild(outcome); }
                if (p.state === 'pending') {
                    const actions = document.createElement('div'); actions.className = 'proposal-actions';
                    ['Accept', 'Reject'].forEach(action => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = action; b.addEventListener('click', async () => {
                        b.disabled = true;
                        try {
                            const response = await fetch(`/api/files/${reviewFileId}/proposals/${p.id}/${action.toLowerCase()}`, { method: 'POST' });
                            const result = await response.json();
                            if (!response.ok || !result.success) {
                                reviewSummary.textContent = result.message || `${action} failed (${response.status}).`;
                            }
                        } catch { reviewSummary.textContent = `${action} request failed. Your proposal history was not reloaded.`; }
                        finally { loadReview(); }
                    }); actions.appendChild(b); });
                    const revise = document.createElement('button'); revise.className = 'btn'; revise.textContent = 'Revise'; revise.addEventListener('click', () => {
                        setPanel('chat'); showReviseContext(p);
                        const input = document.getElementById('chat-input'); if (input) input.focus();
                    }); actions.appendChild(revise); card.appendChild(actions);
                }
                if (p.state === 'pending') pendingSection.body.appendChild(card);
                else if (p.state === 'accepted') acceptedSection.body.appendChild(card);
                // Existing non-accepted terminal states remain visible in
                // their established treatment below the two primary groups.
                else reviewList.appendChild(card);
            });
        }).catch((error) => { reviewSummary.textContent = error.message || 'Could not load review proposals.'; });
    }
    if (reviewTab && chatTab) { reviewTab.addEventListener('click', () => setPanel('review')); chatTab.addEventListener('click', () => setPanel('chat')); }
    if (reviewFileId) loadReview();

    if (chatInput && sendChatBtn && chatMessages && editorForChat) {
        const fileId = editorForChat.dataset.fileId;
        // Same color the presence-stack "you" avatar and live cursor use -
        // resolved once since it never changes mid-session.
        function currentProfileIdentity() {
            const profile = profileIdentity || { label: editorForChat.dataset.profileLabel, avatarUrl: editorForChat.dataset.profileAvatarUrl, color: editorForChat.dataset.profileCursorColor };
            return { label: profile.label || 'You', avatarUrl: profile.avatarUrl, color: resolveAvatarColor(profile.color, true, profile.label || 'You') };
        }
        const pendingReferencesEl = document.getElementById('chat-pending-references');
        let pendingReferences = [];

        function truncateSnippet(text) {
            const trimmed = text.trim().replace(/\s+/g, ' ');
            return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
        }

        function renderPendingReferences() {
            if (!pendingReferencesEl) return;
            pendingReferencesEl.innerHTML = '';
            pendingReferences.forEach(function(ref, index) {
                const chip = document.createElement('span');
                chip.className = 'reference-chip';
                chip.textContent = `L${ref.startLine}-${ref.endLine}: "${truncateSnippet(ref.quotedText)}"`;

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'reference-chip-remove';
                removeBtn.setAttribute('aria-label', 'Remove this reference');
                removeBtn.textContent = '×';
                removeBtn.addEventListener('click', function() {
                    pendingReferences.splice(index, 1);
                    renderPendingReferences();
                });

                chip.appendChild(removeBtn);
                pendingReferencesEl.appendChild(chip);
            });
        }

        document.addEventListener('vellum:selection-referenced', function(e) {
            pendingReferences.push(e.detail);
            renderPendingReferences();
        });

        const chatToolStatusEl = document.getElementById('chat-tool-status');
        function showToolStatus(tool) {
            if (!chatToolStatusEl) return;
            chatToolStatusEl.textContent = tool === 'edit_document' ? '✏️ Editing document...' : `Running ${tool}...`;
            chatToolStatusEl.hidden = false;
        }
        function hideToolStatus() {
            if (!chatToolStatusEl) return;
            chatToolStatusEl.hidden = true;
        }

        function formatTime(isoString) {
            const date = isoString ? new Date(isoString) : new Date();
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        // identityColor is a resolved CSS color (already run through
        // resolveAvatarColor by the caller, which knows whether this is the
        // user's own profile or a provider), not a raw custom color -
        // keeping that resolution out of addMessage lets 'Error' messages
        // (not a participant - skip the chip/rail entirely) stay a simple
        // caller-side check.
        function addMessage(author, content, className, timeString, selections, reviseContext, identityColor, avatarUrl) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${className || ''}`;

            const authorDiv = document.createElement('div');
            authorDiv.className = 'message-author';
            if (author !== 'Error' && identityColor) {
                authorDiv.appendChild(buildIdentityChip(author, identityColor, avatarUrl));
                messageDiv.style.setProperty('--identity-color', identityColor);
            }
            const authorNameEl = document.createElement('span');
            authorNameEl.textContent = author;
            authorDiv.appendChild(authorNameEl);
            messageDiv.appendChild(authorDiv);

            if (reviseContext) {
                const quoteEl = document.createElement('div');
                quoteEl.className = 'message-reference message-revise-reference';
                quoteEl.textContent = `Revising ${reviseContext.providerLabel}'s proposal: "${truncateSnippet(reviseContext.oldText)}" → "${truncateSnippet(reviseContext.newText)}"`;
                messageDiv.appendChild(quoteEl);
            }

            (selections || []).forEach(function(ref) {
                const quoteEl = document.createElement('div');
                quoteEl.className = 'message-reference';
                quoteEl.textContent = `L${ref.startLine}-${ref.endLine}: "${truncateSnippet(ref.quotedText)}"`;
                quoteEl.tabIndex = 0;
                quoteEl.setAttribute('role', 'button');
                quoteEl.addEventListener('click', function() {
                    if (typeof window.__vellumJumpToReference === 'function') {
                        window.__vellumJumpToReference(ref.anchor, ref.head);
                    }
                });
                messageDiv.appendChild(quoteEl);
            });

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = content;
            messageDiv.appendChild(contentDiv);

            const timeDiv = document.createElement('div');
            timeDiv.className = 'message-time';
            timeDiv.textContent = timeString || formatTime();
            messageDiv.appendChild(timeDiv);

            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return contentDiv;
        }

        function loadHistory() {
            // Cleared up front, not just appended to: this is also called
            // again on visibilitychange below so a provider color edited in
            // Settings, in another tab, repaints already-sent messages as
            // soon as this tab is looked at again rather than only on a full
            // reload - re-rendering from scratch is what makes that repaint
            // actually happen instead of just refreshing providerColorsById
            // underneath bubbles that already baked the old color into
            // their DOM.
            chatMessages.innerHTML = '';
            fetch(`/api/chat/${fileId}/messages`)
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (!data.success) return;
                    data.messages.forEach(function(message) {
                        if (message.role === 'user') {
                            const profile = currentProfileIdentity();
                            addMessage(profile.label, message.content, '', formatTime(message.createdAt), message.selections, null, profile.color, profile.avatarUrl);
                        } else if (message.role === 'assistant') {
                            const identity = resolveProviderIdentityById(message.providerId, message.providerColor, message.providerLabel);
                            addMessage(identity.label, message.content, 'agent-message', formatTime(message.createdAt), null, null, identity.color, identity.avatarUrl);
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
            // A fast first click can beat the initial /api/providers/colors
            // response just as history used to. Defer once so the provider
            // rail/chip created for the SSE reply uses its saved live color.
            if (providerColorsById === null) {
                providerColorsReady.then(sendMessage);
                return;
            }
            const message = chatInput.value.trim();
            if (!message || !chatProviderSelect) return;

            const selectionsForSend = pendingReferences.slice();
            const reviseOfForSend = activeReviseContext ? { ...activeReviseContext } : null;
            const profile = currentProfileIdentity();
            addMessage(profile.label, message, '', undefined, selectionsForSend, reviseOfForSend, profile.color, profile.avatarUrl);
            chatInput.value = '';
            chatInput.disabled = true;
            setButtonLoading(sendChatBtn, true);
            pendingReferences = [];
            renderPendingReferences();
            // The quoted context is included with this one send only - once
            // it's on its way, the card is dismissed rather than silently
            // reapplying to every message afterward.
            clearReviseContext();

            const providerId = chatProviderSelect.value;
            const selectedOption = chatProviderSelect.options[chatProviderSelect.selectedIndex];
            const selectedIdentity = resolveProviderIdentityById(providerId, selectedOption.dataset.color, selectedOption.textContent);
            const providerLabel = selectedIdentity.label;
            const providerColor = selectedIdentity.color;
            let replyContentEl = null;

            fetch(`/api/chat/${fileId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId, message, selections: selectionsForSend, reviseOf: reviseOfForSend })
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
                                    replyContentEl = addMessage(providerLabel, '', 'agent-message', undefined, null, null, providerColor, selectedIdentity.avatarUrl);
                                }
                                replyContentEl.textContent += payload.text;
                                chatMessages.scrollTop = chatMessages.scrollHeight;
                            } else if (payload.type === 'tool-start') {
                                showToolStatus(payload.tool);
                            } else if (payload.type === 'tool-end') {
                                hideToolStatus();
                            } else if (payload.type === 'error') {
                                hideToolStatus();
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
                setButtonLoading(sendChatBtn, false);
                hideToolStatus();
                chatInput.focus();
                if (reviewContent && !reviewContent.hidden) loadReview();
            });
        }

        sendChatBtn.addEventListener('click', sendMessage);

        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendMessage();
            }
        });

        // History needs the live provider map before it builds the author
        // rails/chips. Calling this directly raced the request above and
        // rendered hash fallback colors until a later visibility change.
        providerColorsReady.then(loadHistory);

        // Settings lives on a separate page, so the most common way a
        // provider color change actually reaches this already-open writing
        // page is switching back to this tab after editing it elsewhere -
        // refresh the live color map and repaint both panels from it
        // whenever that happens, rather than only on a full reload.
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState !== 'visible') return;
            loadProviderColors().then(function() {
                loadHistory();
                if (reviewContent && !reviewContent.hidden) loadReview();
            });
        });

        const clearChatBtn = document.getElementById('clear-chat-btn');
        if (clearChatBtn) {
            clearChatBtn.addEventListener('click', function() {
                if (!window.confirm('Clear all chat history for this file? This cannot be undone.')) return;
                setButtonLoading(clearChatBtn, true);
                fetch(`/api/chat/${fileId}/clear`, { method: 'POST' })
                    .then(function(response) { return response.json(); })
                    .then(function(data) {
                        setButtonLoading(clearChatBtn, false);
                        if (data.success) {
                            chatMessages.innerHTML = '';
                        }
                    })
                    .catch(function() {
                        setButtonLoading(clearChatBtn, false);
                    });
            });
        }
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
                setButtonLoading(confirmBtn, true);
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
                        setButtonLoading(confirmBtn, false);
                        input.focus();
                    }
                })
                .catch(function() {
                    setButtonLoading(confirmBtn, false);
                });
            });

            cancelBtn.addEventListener('click', restoreButton);
        }

        newProjectBtn.addEventListener('click', openNewProjectForm);

        if (window.location.hash === '#new-project') {
            openNewProjectForm();
        }
    }

    // Projects overview: rename a project in place, mirroring the
    // provider-edit-in-place pattern in Settings.
    if (projectsList) {
        projectsList.addEventListener('click', function(e) {
            const deleteBtn = e.target.closest('.project-delete-btn');
            if (deleteBtn) {
                const card = deleteBtn.closest('.project-card');
                if (!window.confirm(`Delete "${card.dataset.name}" and everything in it? This cannot be undone.`)) return;
                setButtonLoading(deleteBtn, true);
                fetch(`/api/projects/${card.dataset.projectId}/delete`, { method: 'POST' })
                    .then(function(response) { return response.json(); })
                    .then(function(data) {
                        if (data.success) {
                            card.remove();
                        } else {
                            setButtonLoading(deleteBtn, false);
                            window.alert(data.message || 'Could not delete project.');
                        }
                    })
                    .catch(function() {
                        setButtonLoading(deleteBtn, false);
                    });
                return;
            }

            const fileDeleteBtn = e.target.closest('.file-delete-btn');
            if (fileDeleteBtn) {
                const fileRow = fileDeleteBtn.closest('.recent-file');
                const fileName = fileRow.querySelector('a').textContent;
                if (!window.confirm(`Delete "${fileName}"? This cannot be undone.`)) return;
                setButtonLoading(fileDeleteBtn, true);
                fetch(`/api/files/${fileDeleteBtn.dataset.fileId}/delete`, { method: 'POST' })
                    .then(function(response) { return response.json(); })
                    .then(function(data) {
                        if (data.success) {
                            fileRow.remove();
                        } else {
                            setButtonLoading(fileDeleteBtn, false);
                            window.alert(data.message || 'Could not delete file.');
                        }
                    })
                    .catch(function() {
                        setButtonLoading(fileDeleteBtn, false);
                    });
                return;
            }

            const expandBtn = e.target.closest('.project-expand-files-btn');
            if (expandBtn) {
                const list = expandBtn.nextElementSibling;
                const isExpanded = expandBtn.getAttribute('aria-expanded') === 'true';
                if (isExpanded) {
                    // Set an explicit current height first (transitioning
                    // FROM 'none'/auto doesn't animate), then collapse on
                    // the next frame so the transition actually runs.
                    list.style.maxHeight = `${list.scrollHeight}px`;
                    requestAnimationFrame(function() {
                        list.style.maxHeight = '0px';
                    });
                } else {
                    // Measure list.scrollHeight, not the inner wrapper's -
                    // .all-files-list-inner's own margin-top isn't part of
                    // ITS scrollHeight (an element's scrollHeight never
                    // includes its own margin), but .all-files-list's
                    // overflow:hidden blocks margin collapsing, so that
                    // margin genuinely takes up space inside .all-files-list
                    // and only ITS scrollHeight accounts for it. Measuring
                    // the inner wrapper instead clipped the last item by
                    // roughly that margin every time.
                    list.style.maxHeight = `${list.scrollHeight}px`;
                }
                expandBtn.setAttribute('aria-expanded', String(!isExpanded));
                return;
            }

            const editBtn = e.target.closest('.project-edit-btn');
            if (!editBtn) return;

            const card = editBtn.closest('.project-card');
            if (card.querySelector('.provider-form')) return;

            const info = card.querySelector('.project-info');
            const form = document.createElement('form');
            form.className = 'provider-form';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.placeholder = 'Project name';
            nameInput.required = true;
            nameInput.maxLength = 60;
            nameInput.autocomplete = 'off';
            nameInput.value = card.dataset.name;

            const descriptionInput = document.createElement('input');
            descriptionInput.type = 'text';
            descriptionInput.placeholder = 'Description (optional)';
            descriptionInput.autocomplete = 'off';
            descriptionInput.value = card.dataset.description;

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'submit';
            confirmBtn.className = 'btn';
            confirmBtn.setAttribute('aria-label', 'Save project name');
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

            form.appendChild(nameInput);
            form.appendChild(descriptionInput);
            form.appendChild(actions);
            form.appendChild(errorEl);

            info.replaceWith(form);
            nameInput.focus();

            cancelBtn.addEventListener('click', function() {
                form.replaceWith(info);
            });

            form.addEventListener('submit', function(e) {
                e.preventDefault();
                errorEl.hidden = true;
                setButtonLoading(confirmBtn, true);
                fetch(`/api/projects/${card.dataset.projectId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: nameInput.value.trim(),
                        description: descriptionInput.value.trim()
                    })
                })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (data.success) {
                        window.location.reload();
                    } else {
                        setButtonLoading(confirmBtn, false);
                        errorEl.textContent = data.message || 'Something went wrong.';
                        errorEl.hidden = false;
                    }
                })
                .catch(function() {
                    setButtonLoading(confirmBtn, false);
                    errorEl.textContent = 'Could not reach the server — check your connection and try again.';
                    errorEl.hidden = false;
                });
            });
        });
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

            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.className = 'color-swatch-input';
            colorInput.setAttribute('aria-label', 'Color');
            colorInput.title = 'Color';
            colorInput.value = (existing && existing.color) || defaultColorFor(labelInput.value || 'A', false);

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
            form.appendChild(colorInput);
            form.appendChild(actions);
            form.appendChild(errorEl);

            form.addEventListener('submit', function(e) {
                e.preventDefault();
                clearFormError();
                setButtonLoading(confirmBtn, true);
                const payload = {
                    label: labelInput.value.trim(),
                    baseUrl: baseUrlInput.value.trim(),
                    apiKey: apiKeyInput.value.trim(),
                    color: colorInput.value,
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
                        setButtonLoading(confirmBtn, false);
                        showFormError(data.message || 'Something went wrong.');
                    }
                })
                .catch(function() {
                    setButtonLoading(confirmBtn, false);
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
                    avatarUrl: card.dataset.avatarUrl,
                    color: card.dataset.color
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

                setButtonLoading(deleteBtn, true);
                fetch(`/api/providers/${card.dataset.providerId}/delete`, { method: 'POST' })
                    .then(function(response) { return response.json(); })
                    .then(function(data) {
                        if (data.success) {
                            card.remove();
                        } else {
                            setButtonLoading(deleteBtn, false);
                            showDeleteError(data.message || 'Something went wrong.');
                        }
                    })
                    .catch(function() {
                        setButtonLoading(deleteBtn, false);
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

            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.className = 'color-swatch-input';
            colorInput.setAttribute('aria-label', 'Cursor color');
            colorInput.title = 'Cursor color';
            colorInput.value = profileCard.dataset.cursorColor || defaultColorFor(labelInput.value || 'You', true);

            const lineNumbersLabel = document.createElement('label');
            lineNumbersLabel.className = 'checkbox-field';
            const lineNumbersInput = document.createElement('input');
            lineNumbersInput.type = 'checkbox';
            lineNumbersInput.checked = profileCard.dataset.showLineNumbers === 'true';
            lineNumbersLabel.appendChild(lineNumbersInput);
            lineNumbersLabel.appendChild(document.createTextNode('Show line numbers'));

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
            form.appendChild(colorInput);
            form.appendChild(lineNumbersLabel);
            form.appendChild(actions);
            form.appendChild(errorEl);

            form.addEventListener('submit', function(ev) {
                ev.preventDefault();
                errorEl.hidden = true;
                setButtonLoading(confirmBtn, true);
                fetch('/api/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        label: labelInput.value.trim(),
                        avatarUrl: avatarUrlInput.value.trim(),
                        cursorColor: colorInput.value,
                        showLineNumbers: lineNumbersInput.checked
                    })
                })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (data.success) {
                        window.location.reload();
                    } else {
                        setButtonLoading(confirmBtn, false);
                        errorEl.textContent = data.message || 'Something went wrong.';
                        errorEl.hidden = false;
                    }
                })
                .catch(function() {
                    setButtonLoading(confirmBtn, false);
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

            setButtonLoading(toggleBtn, true);
            fetch(`/api/providers/${card.dataset.providerId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label: card.dataset.label,
                    baseUrl: card.dataset.baseUrl,
                    apiKey: '',
                    defaultModel: card.dataset.defaultModel,
                    avatarUrl: card.dataset.avatarUrl,
                    color: card.dataset.color,
                    activeInWorkspace: !currentlyActive
                })
            })
            .then(function(response) { return response.json(); })
            .then(function(data) {
                if (data.success) {
                    window.location.reload();
                } else {
                    setButtonLoading(toggleBtn, false);
                }
            })
            .catch(function() {
                setButtonLoading(toggleBtn, false);
            });
        });
    }
});
