(() => {
  "use strict";

  const LANGS = ["en", "zh-TW", "zh-CN", "ja"];
  const LABELS = {
    en: "English",
    "zh-TW": "繁體中文",
    "zh-CN": "简体中文",
    ja: "日本語",
  };
  const HTML_LANG = {
    en: "en",
    "zh-TW": "zh-Hant",
    "zh-CN": "zh-Hans",
    ja: "ja",
  };
  const packs = window.__GAME_I18N_PACKS__ || {};
  const sourceLang = window.__GAME_I18N_SOURCE_LANG__ || "zh-TW";
  const storageKey = `game-language:${location.pathname}`;
  const textState = new WeakMap();
  const attributeState = new WeakMap();
  const templateCache = new Map();
  const translatableAttributes = ["aria-label", "title", "placeholder", "alt", "content"];
  let currentLang = sourceLang;
  let scheduled = false;

  function safeGetLanguage() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (LANGS.includes(saved)) return saved;
    } catch {
      // Storage can be unavailable on hardened file:// browsers.
    }
    const browser = String(navigator.language || "").toLowerCase();
    if (browser.startsWith("ja")) return "ja";
    if (browser === "zh-cn" || browser === "zh-sg") return "zh-CN";
    if (browser.startsWith("zh")) return "zh-TW";
    return "en";
  }

  function safeSaveLanguage(lang) {
    try {
      localStorage.setItem(storageKey, lang);
    } catch {
      // Keep the in-memory selection when storage is blocked.
    }
  }

  function escapePattern(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function compiledTemplates(lang) {
    const cached = templateCache.get(lang);
    if (cached) return cached;
    const translations = packs[lang] || {};
    const compiled = Object.entries(translations)
      .filter(([source]) => /\{\{\d+\}\}/.test(source))
      .map(([source, target]) => {
        const tokens = [];
        const pattern = source
          .split(/(\{\{\d+\}\})/g)
          .map((part) => {
            const match = part.match(/^\{\{(\d+)\}\}$/);
            if (!match) return escapePattern(part);
            tokens.push(Number(match[1]));
            return "(.+?)";
          })
          .join("");
        return { regex: new RegExp(`^${pattern}$`, "u"), target, tokens };
      });
    templateCache.set(lang, compiled);
    return compiled;
  }

  function translateCore(source, lang) {
    if (!source || lang === sourceLang) return source;
    const translations = packs[lang] || {};
    if (Object.prototype.hasOwnProperty.call(translations, source)) return translations[source];
    for (const template of compiledTemplates(lang)) {
      const match = source.match(template.regex);
      if (!match) continue;
      const values = {};
      template.tokens.forEach((token, index) => {
        values[token] = translateCore(match[index + 1], lang);
      });
      return template.target.replace(/\{\{(\d+)\}\}/g, (_, token) => values[token] ?? "");
    }
    const translatedTokens = source.replace(/[\p{L}\p{Script=Han}]+/gu, (token) =>
      Object.prototype.hasOwnProperty.call(translations, token) ? translations[token] : token,
    );
    if (translatedTokens !== source) return translatedTokens;
    return source;
  }

  function translateValue(value, lang) {
    const leading = value.match(/^\s*/u)?.[0] || "";
    const trailing = value.match(/\s*$/u)?.[0] || "";
    const end = Math.max(leading.length, value.length - trailing.length);
    const core = value.slice(leading.length, end);
    return `${leading}${translateCore(core, lang)}${trailing}`;
  }

  function translateTextNode(node) {
    if (!node.nodeValue || node.parentElement?.closest("script, style, textarea, [data-i18n-ignore]")) return;
    let state = textState.get(node);
    if (!state || node.nodeValue !== state.rendered) {
      state = { original: node.nodeValue, rendered: node.nodeValue };
    }
    const rendered = translateValue(state.original, currentLang);
    if (node.nodeValue !== rendered) node.nodeValue = rendered;
    state.rendered = rendered;
    textState.set(node, state);
  }

  function translateElementAttributes(element) {
    let states = attributeState.get(element);
    if (!states) states = {};
    for (const attribute of translatableAttributes) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute);
      let state = states[attribute];
      if (!state || value !== state.rendered) state = { original: value, rendered: value };
      const rendered = translateValue(state.original, currentLang);
      if (value !== rendered) element.setAttribute(attribute, rendered);
      state.rendered = rendered;
      states[attribute] = state;
    }
    attributeState.set(element, states);
  }

  function translateTree(root = document.documentElement) {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (!(root instanceof Element || root instanceof Document)) return;
    if (root instanceof Element) translateElementAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateElementAttributes(node);
    }
  }

  function scheduleTranslation() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      translateTree(document.documentElement);
    });
  }

  function ensureStyles() {
    if (document.getElementById("game-i18n-style")) return;
    const style = document.createElement("style");
    style.id = "game-i18n-style";
    style.textContent = `
      .game-language-switcher {
        position: relative;
        z-index: 10020;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-width: max-content;
        padding: 6px 8px;
        border: 1px solid rgba(255,255,255,.2);
        border-radius: 10px;
        background: rgba(15,17,28,.84);
        color: #fff;
        box-shadow: 0 8px 24px rgba(0,0,0,.18);
        backdrop-filter: blur(10px);
        font: 600 12px/1.2 system-ui, sans-serif;
      }
      .game-language-switcher--floating {
        position: fixed;
        top: max(12px, env(safe-area-inset-top));
        right: max(12px, env(safe-area-inset-right));
      }
      .game-language-switcher select {
        min-width: 108px;
        margin: 0;
        padding: 6px 28px 6px 8px;
        border: 1px solid rgba(255,255,255,.22);
        border-radius: 7px;
        background: #26293b;
        color: #fff;
        font: inherit;
        cursor: pointer;
      }
      @media (max-width: 640px) {
        .game-language-switcher { padding: 4px; }
        .game-language-switcher select { min-width: 94px; font-size: 11px; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureSwitcher() {
    let switcher = document.querySelector(".game-language-switcher");
    if (switcher) return switcher;
    const host = document.querySelector("[data-language-switcher]");
    switcher = document.createElement("label");
    switcher.className = `game-language-switcher${host ? "" : " game-language-switcher--floating"}`;
    switcher.setAttribute("data-i18n-ignore", "");
    switcher.innerHTML = `
      <span aria-hidden="true">🌐</span>
      <select aria-label="Language">
        ${LANGS.map((lang) => `<option value="${lang}">${LABELS[lang]}</option>`).join("")}
      </select>
    `;
    (host || document.body).appendChild(switcher);
    switcher.querySelector("select").addEventListener("change", (event) => {
      setLanguage(event.target.value);
    });
    return switcher;
  }

  function setLanguage(lang) {
    if (!LANGS.includes(lang)) lang = sourceLang;
    currentLang = lang;
    safeSaveLanguage(lang);
    document.documentElement.lang = HTML_LANG[lang];
    document.documentElement.dataset.language = lang;
    const switcher = ensureSwitcher();
    switcher.querySelector("select").value = lang;
    translateTree();
    window.dispatchEvent(new CustomEvent("game-language-changed", { detail: { lang } }));
  }

  function init() {
    ensureStyles();
    ensureSwitcher();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") scheduleTranslation(record.target);
        for (const node of record.addedNodes || []) scheduleTranslation(node);
        if (record.type === "attributes") scheduleTranslation(record.target);
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatableAttributes,
    });
    setLanguage(safeGetLanguage());
  }

  window.GameI18n = {
    get language() {
      return currentLang;
    },
    languages: [...LANGS],
    setLanguage,
    translate: (value, lang = currentLang) => translateCore(value, lang),
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
