// Cookie Lite Editor - Background Service Worker
// Monitors cookie changes and can notify popup

let popupPort = null;

// Listen for popup connection
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'cookie-lite-popup') {
    popupPort = port;
    
    port.onDisconnect.addListener(() => {
      popupPort = null;
    });
  }
});

// Listen for cookie changes
chrome.cookies.onChanged.addListener((changeInfo) => {
  // Notify popup if it's open
  if (popupPort) {
    popupPort.postMessage({
      type: 'cookieChanged',
      cause: changeInfo.cause,
      cookie: changeInfo.cookie,
      removed: changeInfo.removed
    });
  }
});

// Optional: Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Cookie Lite Editor installed successfully');
  }
});