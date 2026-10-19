/** Shared by the URL-served and srcDoc prototype previews; never navigates the host. */
export const PREVIEW_HISTORY_READY = 'od:preview-history-ready';
export const PREVIEW_HISTORY_PROBE = 'od:preview-history-probe';
export const PREVIEW_HISTORY_STATE = 'od:preview-history-state';
export const PREVIEW_HISTORY_BACK = 'od:preview-history-back';
export const PREVIEW_HISTORY_BRIDGE_MARKER = 'data-od-preview-history';

/**
 * Run inside the sandboxed iframe. Only entries observed in THIS document count:
 * history.length also includes unrelated browser entries, so using it to decide
 * whether Back is safe could accidentally navigate the OpenDesign host.
 */
export function buildPreviewHistoryBridge(): string {
  return `<script ${PREVIEW_HISTORY_BRIDGE_MARKER}>(function(){
  if (window.__odPreviewHistoryBridge) return;
  window.__odPreviewHistoryBridge = true;
  var entries = [location.href];
  var index = 0;
  var requestId = '';
  var pendingBack = false;
  function announce(){
    if (!requestId) return;
    try { window.parent.postMessage({ type: '${PREVIEW_HISTORY_STATE}', requestId: requestId, canGoBack: index > 0 }, '*'); } catch (_) {}
  }
  function push(){
    entries = entries.slice(0, index + 1);
    entries.push(location.href);
    index++;
    announce();
  }
  function reset(href){
    entries = [href];
    index = 0;
  }
  function traversed(event){
    var href = location.href;
    if (pendingBack) {
      pendingBack = false;
      if (index > 0) index--;
      entries[index] = href;
    } else if (entries[index] !== href) {
      var matches = [];
      for (var i = 0; i < entries.length; i++) if (entries[i] === href) matches.push(i);
      if (matches.length === 1) index = matches[0];
      else if (matches.length > 1) reset(href);
      else if (event.type === 'hashchange' || href.split('#')[0] === entries[index].split('#')[0]) push();
      else reset(href);
    } else if (event.type === 'popstate') {
      // An authored/native traversal between identical URLs has no known
      // direction. Start a new safe baseline rather than count host history.
      reset(href);
    }
    announce();
  }
  try {
    var history = window.history;
    var nativePush = history.pushState;
    var nativeReplace = history.replaceState;
    history.pushState = function(){
      var result = nativePush.apply(history, arguments);
      // Only a successful native push is a new entry. The srcDoc sandbox
      // shim catches native SecurityErrors outside this wrapper, so rejected
      // URL changes cannot falsely enable Back.
      push();
      return result;
    };
    history.replaceState = function(){
      var result = nativeReplace.apply(history, arguments);
      entries[index] = location.href;
      return result;
    };
  } catch (_) {}
  window.addEventListener('popstate', traversed);
  window.addEventListener('hashchange', traversed);
  window.addEventListener('message', function(event){
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data.requestId !== 'string' || !data.requestId) return;
    if (data.type === '${PREVIEW_HISTORY_PROBE}') {
      requestId = data.requestId;
      announce();
    } else if (data.type === '${PREVIEW_HISTORY_BACK}' && data.requestId === requestId && index > 0 && !pendingBack) {
      pendingBack = true;
      history.back();
    }
  });
  try { window.parent.postMessage({ type: '${PREVIEW_HISTORY_READY}' }, '*'); } catch (_) {}
})();</script>`;
}
