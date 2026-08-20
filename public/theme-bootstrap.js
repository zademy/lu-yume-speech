// No-flash dark mode bootstrap: applied before first paint.
// External same-origin file (not inline) so a strict CSP script-src 'self'
// never blocks it. Keep in sync with src/theme.ts expectations.
(function () {
  try {
    var stored = JSON.parse(localStorage.getItem('stt_theme'));
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || 'system';
    var isDark = theme === 'dark' || (theme === 'system' && prefersDark);
    if (isDark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
