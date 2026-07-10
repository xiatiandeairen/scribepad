/* global window */
/* ═══ Spec Plan — 早期 console / error 环形缓冲 ═══
   在 React / Babel 之前作为普通同步脚本加载，越早挂钩越好——这样组件渲染前
   （bootstrap / 首屏）抛的错也能被捕获。面板反馈提交时经 window.__recentConsoleErrors()
   读最近 N 条，随请求上报供复现。
   容量上限（arch-runtime §2：资源必有上限）——只留最近 CAP 条，不无限增长。
   依赖从 window 取（addEventListener / console），使源可用 new Function 单测。 */
(function (win) {
  var CAP = 20;
  var buf = [];
  function push(msg) {
    buf.push(msg);
    if (buf.length > CAP) buf.shift(); // ring: drop oldest once over cap
  }
  function textOf(v) {
    if (v && typeof v.message === 'string') return v.message; // Error / event-like
    return typeof v === 'string' ? v : String(v);
  }

  win.addEventListener('error', function (e) {
    push(textOf(e));
  });
  win.addEventListener('unhandledrejection', function (e) {
    push('unhandledrejection: ' + textOf(e && e.reason));
  });

  // Wrap console.error before React caches it, so React warnings land here too;
  // always forward to the original so the real console (and Playwright) still sees it.
  var c = win.console;
  if (c && typeof c.error === 'function') {
    var orig = c.error;
    c.error = function () {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) parts.push(textOf(arguments[i]));
        push(parts.join(' '));
      } catch {
        /* buffering must never break real logging */
      }
      return orig.apply(c, arguments);
    };
  }

  // Reader returns a copy so callers can't mutate the internal buffer.
  win.__recentConsoleErrors = function () {
    return buf.slice();
  };
})(window);
