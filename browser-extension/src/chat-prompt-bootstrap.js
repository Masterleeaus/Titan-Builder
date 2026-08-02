(() => {
  const moduleUrl = chrome.runtime.getURL('src/chat-prompt-routing.js');
  import(moduleUrl)
    .then(({ installChatPromptRouting }) => installChatPromptRouting())
    .catch((error) => console.warn('[openbrowser] normal-chat prompt routing unavailable', error));
})();
