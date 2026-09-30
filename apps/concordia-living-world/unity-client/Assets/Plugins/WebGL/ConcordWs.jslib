mergeInto(LibraryManager.library, {
  ConcordWsConnect: function (urlPtr) {
    var url = UTF8ToString(urlPtr);
    try {
      if (window._concordWs) {
        try { window._concordWs.close(); } catch (e) {}
      }
      var ws = new WebSocket(url);
      window._concordWs = ws;
      ws.onopen = function () {
        SendMessage('ConcordClient', 'OnWsOpen', '');
      };
      ws.onclose = function () {
        SendMessage('ConcordClient', 'OnWsClose', '');
      };
      ws.onerror = function () {
        SendMessage('ConcordClient', 'OnWsError', 'error');
      };
      ws.onmessage = function (ev) {
        if (typeof ev.data === 'string') {
          SendMessage('ConcordClient', 'OnWsMessage', ev.data);
        }
      };
    } catch (e) {
      SendMessage('ConcordClient', 'OnWsError', String(e));
    }
  },

  ConcordWsSend: function (msgPtr) {
    var msg = UTF8ToString(msgPtr);
    var ws = window._concordWs;
    if (ws && ws.readyState === 1) ws.send(msg);
  },

  ConcordWsClose: function () {
    var ws = window._concordWs;
    if (ws) {
      try { ws.close(); } catch (e) {}
    }
    window._concordWs = null;
  },

  ConcordReadConfig: function (keyPtr) {
    var key = UTF8ToString(keyPtr);
    var cfg = window.CONCORD_UNITY_CONFIG || {};
    var v = cfg[key] || '';
    var len = lengthBytesUTF8(v) + 1;
    var buf = _malloc(len);
    stringToUTF8(v, buf, len);
    return buf;
  }
});
