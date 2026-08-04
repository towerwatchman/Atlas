const DEFAULT_RPC_PORT = 57096;
let rpcPort = DEFAULT_RPC_PORT;
let rpcURL = `http://127.0.0.1:${rpcPort}`;
let games = [];
let settings = {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rpcCall = async (method, path, body, tabId) => {
    if (typeof method !== 'string' || typeof path !== 'string' || (typeof body !== 'string' && body !== null)) {
        return null;
    }
    try {
        const res = await fetch(`${rpcURL}${path}`, {
            method: method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
            body: body,
        });
        if (!res.ok) {
            throw res.status;
        }
        return res;
    } catch (err) {
        if (tabId) {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    alert('Could not connect to Atlas!\nIs Atlas running and RPC enabled in Settings?');
                },
            });
        }
        return null;
    }
};

const getData = async () => {
    const resGames = await rpcCall('GET', '/api/games', null);
    if (resGames) {
        games = await resGames.json();
    }
    const resSettings = await rpcCall('GET', '/api/settings', null);
    if (resSettings) {
        settings = await resSettings.json();
    }
};

const addGame = async (url, tabId) => {
    await rpcCall('POST', '/api/games/add', JSON.stringify([url]), tabId);
    await sleep(500);
    await updateIcons(tabId);
};

const updateIcons = async (tabId) => {
    await getData();

    try {
        await chrome.scripting.insertCSS({
            target: { tabId: tabId },
            files: ['styles/overlay.css']
        }).catch(() => {});
    } catch {
        // Ignore CSS injection failure if already injected
    }

    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (gamesList, userSettings) => {
            const logoUrl = chrome.runtime.getURL('icons/logo.png');

            const extractThreadId = (urlStr) => {
                const match = /threads\/(?:(?:[^\.\/]*)\.)?(\d+)/.exec(urlStr);
                return match ? parseInt(match[1], 10) : null;
            };

            const createContainer = () => {
                const c = document.createElement('div');
                c.classList.add('atlas-library-icons');
                c.style.display = 'inline-flex';
                c.style.alignItems = 'center';
                c.style.verticalAlign = 'middle';
                c.style.marginRight = '4px';
                return c;
            };

            const createIcon = (gameId) => {
                const container = document.createElement('span');
                container.classList.add('atlas-badge-wrapper');
                
                const img = document.createElement('img');
                img.src = logoUrl;
                img.classList.add('atlas-badge-icon');
                img.style.width = '18px';
                img.style.height = '18px';
                img.style.objectFit = 'contain';
                img.style.borderRadius = '3px';

                const game = gamesList.find(g => 
                    (g.f95Id && parseInt(g.f95Id, 10) === gameId) || 
                    (g.lcId && parseInt(g.lcId, 10) === gameId) || 
                    (g.id === gameId)
                );

                let statusColor = '#3b82f6';
                let tooltipText = 'Present in your Atlas library';

                if (game) {
                    if (game.installed) {
                        statusColor = '#22c55e'; // Green
                        tooltipText = `In Atlas Library (Installed: ${game.installedVersion || 'v1.0'})`;
                    } else if (game.isWishlist) {
                        statusColor = '#a855f7'; // Purple
                        tooltipText = `In Atlas Wishlist`;
                    } else {
                        statusColor = '#3b82f6'; // Blue
                        tooltipText = `Tracked in Atlas`;
                    }

                    if (game.notes) {
                        tooltipText += `\n\nNotes: ${game.notes}`;
                    }
                    if (game.rating) {
                        tooltipText += `\nRating: ${game.rating}/10`;
                    }
                }

                img.setAttribute('title', tooltipText);
                img.style.border = `2px solid ${statusColor}`;

                if (userSettings.icon_glow) {
                    img.style.boxShadow = `0 0 8px ${statusColor}aa`;
                }

                container.appendChild(img);
                return container;
            };

            const createNbsp = () => {
                const span = document.createElement('span');
                span.style.display = 'inline-block';
                span.innerHTML = '&nbsp;';
                return span;
            };

            const removeOldIcons = () => {
                document.querySelectorAll('.atlas-library-icons').forEach((e) => e.remove());
            };

            const isValidHrefElem = (elem, elemId, pageId) => {
                if (/reply\?.*$/.test(elem.href)) return false;
                const parent = elem.parentNode;
                if (/page-.*$/.test(elem.href)) return false;
                if (parent && parent.classList.contains('pageNav')) return false;
                if (parent && parent.classList.contains('pageNav-page')) return false;

                const ul = elem.closest('ul');
                if (ul && ul.classList.contains('message-attribution-opposite')) return false;
                if (elem.closest('.message-threadStarterPost') && elemId === pageId) return false;

                if (elem.classList.contains('button')) return false;
                if (elem.classList.contains('tabs-tab')) return false;
                if (elem.classList.contains('u-concealed')) return false;

                return true;
            };

            const knownIds = gamesList.map(g => {
                if (g.f95Id) return parseInt(g.f95Id, 10);
                if (g.lcId) return parseInt(g.lcId, 10);
                return g.id;
            }).filter(Boolean);

            const addHrefIcons = () => {
                const pageId = extractThreadId(document.location.href);
                for (const elem of document.querySelectorAll('a[href*="/threads/"]')) {
                    const elemId = extractThreadId(elem.href);

                    if (!elemId || !knownIds.includes(elemId)) {
                        continue;
                    }

                    const isImage =
                        elem.classList.contains('resource-tile_link') ||
                        (elem.parentNode && elem.parentNode.parentNode && elem.parentNode.parentNode.classList.contains('es-slides'));

                    if (!isImage && !isValidHrefElem(elem, elemId, pageId)) {
                        continue;
                    }

                    const container = createContainer();
                    const iconNode = createIcon(elemId);
                    container.appendChild(iconNode);

                    if (isImage) {
                        container.style.position = 'absolute';
                        container.style.zIndex = '50';
                        container.style.left = '5px';
                        container.style.top = '5px';
                        container.style.background = 'rgba(24, 24, 27, 0.85)';
                        container.style.padding = '2px';
                        container.style.borderRadius = '4px';
                        elem.appendChild(container);
                    } else if (elem.children.length > 0) {
                        const whitespaces = elem.querySelectorAll('span.label-append');
                        if (whitespaces.length > 0) {
                            const lastWhitespace = whitespaces[whitespaces.length - 1];
                            lastWhitespace.insertAdjacentElement('afterend', createNbsp());
                            lastWhitespace.insertAdjacentElement('afterend', container);
                        } else if (elem.classList.contains('link--internal')) {
                            if (elem.querySelector('img[data-src]')) {
                                continue;
                            }
                            elem.insertAdjacentElement('beforebegin', container);
                            elem.insertAdjacentElement('beforebegin', createNbsp());
                        }
                    } else {
                        elem.insertAdjacentElement('beforebegin', container);
                        elem.insertAdjacentElement('beforebegin', createNbsp());
                    }
                }
            };

            const addPageIcon = () => {
                const id = extractThreadId(document.location.href);
                if (!id || !knownIds.includes(id)) return;

                const container = createContainer();
                const iconNode = createIcon(id);
                container.appendChild(iconNode);

                const title = document.getElementsByClassName('p-title-value')[0];
                if (title) {
                    title.insertBefore(container, title.firstChild);
                    title.insertBefore(createNbsp(), title.childNodes[1]);
                }
            };

            const highlightTags = () => {
                if (!userSettings.highlight_tags || !userSettings.tags_highlights) return;
                const highlightColors = {
                    1: { text: '#ffffff', background: '#15803d', border: '1px solid #22c55e' }, // Positive
                    2: { text: '#ffffff', background: '#b91c1c', border: '1px solid #ef4444' }, // Negative
                    3: { text: '#ffffff', background: '#09090b', border: '1px solid #64748b' }, // Critical
                };

                const tagLinks = document.querySelectorAll('a.tagItem, span.tagItem');
                tagLinks.forEach((link) => {
                    const name = link.innerText.trim();
                    if (userSettings.tags_highlights.hasOwnProperty(name)) {
                        const highlight = userSettings.tags_highlights[name];
                        if (highlightColors[highlight]) {
                            link.style.color = highlightColors[highlight].text;
                            link.style.backgroundColor = highlightColors[highlight].background;
                            link.style.border = highlightColors[highlight].border;
                        }
                    }
                });
            };

            const doUpdate = () => {
                removeOldIcons();
                addHrefIcons();
                addPageIcon();
                highlightTags();
            };

            doUpdate();
        },
        args: [games, settings],
    });
};

chrome.webNavigation.onCompleted.addListener(
    (details) => {
        if (details.frameId === 0) {
            updateIcons(details.tabId);
        }
    },
    { url: [{ hostSuffix: 'f95zone.to' }, { hostSuffix: 'lewdcorner.com' }] }
);

// Context menus setup
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'add-page-to-atlas',
        title: 'Add page to Atlas',
        contexts: ['page'],
        documentUrlPatterns: ['*://*.f95zone.to/threads/*', '*://*.lewdcorner.com/threads/*'],
    });

    chrome.contextMenus.create({
        id: 'add-link-to-atlas',
        title: 'Add link to Atlas',
        contexts: ['link'],
        targetUrlPatterns: ['*://*.f95zone.to/threads/*', '*://*.lewdcorner.com/threads/*'],
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    const targetUrl = info.linkUrl || info.pageUrl || (tab ? tab.url : '');
    if (targetUrl) {
        addGame(targetUrl, tab ? tab.id : null);
    }
});

setInterval(getData, 5 * 60 * 1000);
getData();
