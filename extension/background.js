// background.js - Atlas Browser Extension Background Service Worker

const DEFAULT_RPC_PORT = 57096;
let rpcPort = DEFAULT_RPC_PORT;
let rpcURL = `http://127.0.0.1:${rpcPort}`;

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

const notifyTabsToRefresh = async () => {
    try {
        const tabs = await chrome.tabs.query({ url: ['*://*.f95zone.to/*', '*://*.lewdcorner.com/*'] });
        for (const tab of tabs || []) {
            if (tab && tab.id) {
                chrome.tabs.sendMessage(tab.id, { action: 'refresh' }).catch(() => {});
            }
        }
    } catch (err) {
        console.warn('Error notifying tabs:', err);
    }
};

const addGame = async (url, tabId) => {
    await rpcCall('POST', '/api/games/add', JSON.stringify([url]), tabId);
    await sleep(400);
    await notifyTabsToRefresh();
};

// Extension Lifecycle Setup
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'add-page-to-atlas',
        title: 'Add this page to Atlas',
        contexts: ['page'],
        documentUrlPatterns: ['*://*.f95zone.to/threads/*', '*://*.lewdcorner.com/threads/*'],
    });

    chrome.contextMenus.create({
        id: 'add-link-to-atlas',
        title: 'Add this link to Atlas',
        contexts: ['link'],
        targetUrlPatterns: ['*://*.f95zone.to/threads/*', '*://*.lewdcorner.com/threads/*'],
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (tab && tab.id) {
        switch (info.menuItemId) {
            case 'add-page-to-atlas':
                addGame(info.pageUrl, tab.id);
                break;
            case 'add-link-to-atlas':
                addGame(info.linkUrl || info.pageUrl, tab.id);
                break;
        }
    }
});

chrome.action.onClicked.addListener((tab) => {
    if (tab && tab.id && tab.url) {
        addGame(tab.url, tab.id);
    }
});

// Handle messages from content.js (proxy RPC requests cleanly to prevent cross-origin issues or special permission popups)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === 'get_data') {
        Promise.all([
            rpcCall('GET', '/api/games', null),
            rpcCall('GET', '/api/settings', null),
        ])
            .then(async ([resG, resS]) => {
                const games = resG ? await resG.json() : [];
                const settings = resS ? await resS.json() : {};
                sendResponse({ games, settings });
            })
            .catch(() => {
                sendResponse({ games: [], settings: {} });
            });
        return true; // async response
    }
});
