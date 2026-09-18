(function () {
  'use strict';

  var KEY = 'um_lang';
  var LABEL = { ar: 'English', en: 'العربية' };

  function getLang() {
    try {
      var saved = localStorage.getItem(KEY);
      if (saved === 'ar' || saved === 'en') return saved;
    } catch (e) {}
    return 'ar';
  }

  function setLang(lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    apply(lang);
  }

  function apply(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

    document.querySelectorAll('[data-lang]').forEach(function (el) {
      el.hidden = el.getAttribute('data-lang') !== lang;
    });

    document.querySelectorAll('.lang-toggle').forEach(function (btn) {
      btn.textContent = LABEL[lang];
      btn.setAttribute('aria-label', lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
    });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.lang-toggle');
    if (!btn) return;
    setLang(getLang() === 'ar' ? 'en' : 'ar');
  });

  apply(getLang());
})();
