// ==UserScript==
// @name         Lichess Dynamic Badge + Name + Flair (Final Stable)
// @namespace    http://tampermonkey.net/
// @version      29.0.0
// @description  Remote-controlled Lichess UI driven by Supabase table data
// @match        https://lichess.org/*
// @updateURL    https://someoneofficial.github.io/LichessEdits/LichessFlairNameAndTitleChanger/LichessFlairNameTitleChange.js
// @downloadURL  https://someoneofficial.github.io/LichessEdits/LichessFlairNameAndTitleChanger/LichessFlairNameTitleChange.js
// @grant        GM_xmlhttpRequest
// @connect      wkhbvgqvafooneuwhppj.supabase.co
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SUPABASE_URL = 'https://wkhbvgqvafooneuwhppj.supabase.co';
    const SUPABASE_TABLE = 'LichessChangesDB';
    const SUPABASE_ANON_KEY = 'REPLACE_WITH_YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY';
    const REFRESH_MS = 60000;

    let PLAYERS = [];

    function normalizeUser(value) {
        return String(value || '').trim().replace(/^@+/, '').toLowerCase();
    }

    function pickFirst(row, keys) {
        for (const key of keys) {
            if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
            const value = row[key];
            if (value === null || value === undefined) continue;
            return String(value).trim();
        }
        return '';
    }

    function sanitizeTitle(value) {
        const title = String(value || '').trim();
        if (!title) return '';
        return title.toLowerCase() === 'title' ? '' : title;
    }

    function toBoolean(value, fallback = true) {
        if (value === null || value === undefined) return fallback;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        const normalized = String(value).trim().toLowerCase();
        if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
        if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
        return fallback;
    }

    function normalizePlayer(row) {
        const sourceUser = pickFirst(row, [
            'username',
            'user',
            'lichess_username',
            'lichessUser',
            'name'
        ]);

        const id = normalizeUser(sourceUser);
        if (!id) return null;

        const displayName = pickFirst(row, [
            'display_name',
            'displayName',
            'custom_name',
            'customName',
            'shown_name',
            'shownName',
            'name'
        ]);

        const flair = pickFirst(row, [
            'flair',
            'flair_url',
            'flairUrl',
            'image_url',
            'imageUrl',
            'avatar_url',
            'avatarUrl'
        ]);

        const enabled = toBoolean(
            row.enabled ?? row.active ?? row.is_active ?? row.isActive,
            true
        );

        return {
            id,
            name: sourceUser,
            title: sanitizeTitle(row.title ?? row.badge ?? row.utitle),
            displayName,
            flair,
            enabled
        };
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
        const dataHrefUser = extractUserFromHref(el.getAttribute('data-href') || '');
        if (dataHrefUser) return dataHrefUser;

        const hrefUser = extractUserFromHref(el.getAttribute('href') || '');
        if (hrefUser) return hrefUser;

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

    function loadData() {
        return new Promise((resolve) => {
            if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('REPLACE_WITH')) {
                console.error('[Lichess Supabase] Missing SUPABASE_ANON_KEY in userscript settings.');
                resolve();
                return;
            }

            const url =
                `${SUPABASE_URL}/rest/v1/${encodeURIComponent(SUPABASE_TABLE)}` +
                '?select=*';

            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: {
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                    Accept: 'application/json'
                },
                onload: function (response) {
                    try {
                        if (response.status < 200 || response.status >= 300) {
                            console.error(
                                '[Lichess Supabase] Fetch failed',
                                response.status,
                                response.responseText
                            );
                            resolve();
                            return;
                        }

                        const rows = JSON.parse(response.responseText);
                        if (!Array.isArray(rows)) {
                            console.error('[Lichess Supabase] Expected array response', rows);
                            resolve();
                            return;
                        }

                        PLAYERS = rows
                            .map(normalizePlayer)
                            .filter((player) => player && player.enabled)
                            .map((player) => ({
                                ...player,
                                badge: createBadge(player.title)
                            }));

                        console.log('[Lichess Supabase] Loaded players:', PLAYERS.length);
                        resolve();
                    } catch (e) {
                        console.error('[Lichess Supabase] Parse error:', e);
                        resolve();
                    }
                },
                onerror: function (err) {
                    console.error('[Lichess Supabase] Network error:', err);
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
        if (!PLAYERS.length) {
            document.querySelectorAll('.user-link[data-injected-for]').forEach(clearInjected);
            return;
        }

        const playersById = new Map(PLAYERS.map((p) => [p.id, p]));
        const elements = document.querySelectorAll('.user-link');

        elements.forEach((el) => {
            const currentUser = resolveUserForElement(el);

            if (!currentUser) {
                if (el.dataset.injectedFor) clearInjected(el);
                return;
            }

            const player = playersById.get(currentUser);

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

            replaceName(el, player.displayName);

            el.querySelectorAll('.injected-badge').forEach((badge) => badge.remove());
            if (player.badge) {
                const wrapper = document.createElement('span');
                wrapper.innerHTML = player.badge;
                const badge = wrapper.firstChild;

                const icon = el.querySelector('i.line');

                if (icon) icon.insertAdjacentElement('afterend', badge);
                else el.prepend(badge);
            }

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

    function startRefreshLoop() {
        setInterval(async () => {
            await loadData();
            inject();
        }, REFRESH_MS);
    }

    async function init() {
        await loadData();
        inject();
        observe();
        startRefreshLoop();
    }

    init();
})();
