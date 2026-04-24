// ==UserScript==
// @name         Lichess Dynamic Badge + Name + Flair (Final Stable)
// @namespace    http://tampermonkey.net/
// @version      27.5
// @description  Remote-controlled Lichess UI with fully safe parsing
// @match        https://lichess.org/*
// @grant        GM_xmlhttpRequest
// @connect      someoneofficial.github.io
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const BASE_URL =
        'https://someoneofficial.github.io/DatabaseStorage/LichessNameFlairAndTitle.txt';

    let PLAYERS = [];

    function normalizeUser(value) {
        return (value || '').trim().toLowerCase();
    }

    function extractUserFromHref(href) {
        const match = (href || '').match(/\/@\/([^/?#]+)/i);
        if (!match) return '';

        try {
            return normalizeUser(decodeURIComponent(match[1]));
        } catch (e) {
            return normalizeUser(match[1]);
        }
    }

    function resolveUserForElement(el) {
        // Profile header uses span.user-link with data-href.
        const dataHrefUser = extractUserFromHref(el.getAttribute('data-href') || '');
        if (dataHrefUser) return dataHrefUser;

        // Normal links use href.
        const hrefUser = extractUserFromHref(el.getAttribute('href') || '');
        if (hrefUser) return hrefUser;

        // Fallback to data-username only when href does not expose a user.
        return normalizeUser(el.getAttribute('data-username'));
    }

    function createBadge(title) {
        if (!title) return '';
        return `<span class="utitle injected-badge"
            title="${title}"
            style="margin-right:8px;margin-left:2px;display:inline-block;">
            ${title}
        </span>`;
    }

    // 🧠 SAFE PARSER (FIXED FLAIR + STRUCTURE)
    function parseLine(line) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) return null;

        const raw = line.slice(colonIndex + 1).trim();
        if (!raw) return null;

        const parts = raw.split(',').map(x => x.trim());

        const name = parts[0] || '';
        let title = parts[1] || '';
        const displayName = parts[2] || '';

        // 🧠 EVERYTHING AFTER INDEX 2 = FULL FLAIR (SAFE)
        const flair = parts.slice(3).join(',').trim();

        if (!name) return null;

        return {
            name,
            id: name.toLowerCase(),
            title,
            displayName,
            flair
        };
    }

    function loadData() {
        return new Promise((resolve) => {
            const url = BASE_URL + '?t=' + Date.now();

            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function (response) {
                    try {
                        const lines = response.responseText.split('\n');
                        const parsed = [];

                        for (let line of lines) {
                            line = line.trim();

                            // 🧠 HARD FILTERS (prevents "title" bug)
                            if (!line.startsWith('Player')) continue;
                            if (line.includes('name, title')) continue;
                            if (!line.includes(':')) continue;

                            const player = parseLine(line);
                            if (!player) continue;

                            // 🧠 TITLE SANITIZER (fixes "title" bug)
                            const cleanTitle =
                                (!player.title ||
                                 player.title.toLowerCase() === 'title')
                                    ? ''
                                    : player.title;

                            parsed.push({
                                ...player,
                                title: cleanTitle,
                                badge: createBadge(cleanTitle)
                            });
                        }

                        PLAYERS = parsed;
                        console.log("Loaded players:", PLAYERS);
                        resolve();

                    } catch (e) {
                        console.error("Parse error:", e);
                        resolve();
                    }
                },
                onerror: function (err) {
                    console.error("Fetch failed:", err);
                    resolve();
                }
            });
        });
    }

    function getPrimaryTextNode(el) {
        for (let node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
                return node;
            }
        }

        return null;
    }

    function replaceName(el, newName) {
        const textNode = getPrimaryTextNode(el);
        if (!textNode) return;

        if (!el.dataset.originalName) {
            el.dataset.originalName = textNode.nodeValue;
        }

        if (newName) {
            textNode.nodeValue = newName;
        } else if (el.dataset.originalName) {
            textNode.nodeValue = el.dataset.originalName;
        }
    }

    function setFlair(el, flairUrl) {
        el.querySelectorAll('img.injected-flair').forEach((img) => img.remove());
        if (!flairUrl) return;

        const img = document.createElement('img');
        img.className = 'uflair injected-flair';
        img.src = flairUrl;
        el.appendChild(img);
    }

    function clearInjected(el) {
        if (el.dataset.originalName) {
            const textNode = getPrimaryTextNode(el);
            if (textNode) {
                textNode.nodeValue = el.dataset.originalName;
            }
        }

        el.querySelectorAll('.injected-badge').forEach((badge) => badge.remove());
        el.querySelectorAll('img.injected-flair').forEach((img) => img.remove());

        delete el.dataset.originalName;
        delete el.dataset.injectedFor;
        delete el.dataset.injectedSig;
    }

    function inject() {
        if (!PLAYERS.length) return;

        const playersById = new Map(PLAYERS.map((p) => [p.id, p]));
        const elements = document.querySelectorAll(
            '.user-link'
        );

        elements.forEach(el => {
            const currentUser = resolveUserForElement(el);

            // Only apply when the element exposes an explicit username.
            if (!currentUser) {
                if (el.dataset.injectedFor) clearInjected(el);
                return;
            }

            const player = playersById.get(currentUser);

            // If username is not in remote targets, ensure no injected residue remains.
            if (!player) {
                if (el.dataset.injectedFor) clearInjected(el);
                return;
            }

            const signature = [player.displayName, player.title, player.flair].join('\u0001');
            if (
                el.dataset.injectedFor === player.id &&
                el.dataset.injectedSig === signature
            ) {
                return;
            }

            if (el.dataset.injectedFor && el.dataset.injectedFor !== player.id) {
                clearInjected(el);
            }

            // name replace
            replaceName(el, player.displayName);

            // badge
            el.querySelectorAll('.injected-badge').forEach((badge) => badge.remove());
            if (player.badge) {
                const wrapper = document.createElement('span');
                wrapper.innerHTML = player.badge;
                const badge = wrapper.firstChild;

                const icon = el.querySelector('i.line');

                if (icon) icon.insertAdjacentElement('afterend', badge);
                else el.prepend(badge);
            }

            // flair (FULL SAFE URL SUPPORT)
            setFlair(el, player.flair);

            el.dataset.injectedFor = player.id;
            el.dataset.injectedSig = signature;
        });
    }

    function observe() {
        const obs = new MutationObserver(inject);
        obs.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    async function init() {
        await loadData();
        inject();
        observe();
    }

    init();
})();
