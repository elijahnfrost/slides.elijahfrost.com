/*
 * ef-scope — vanilla scope guard.
 *
 * Mirrors @elijahfrost/design-system/scope (v0.2.x) as a single drop-in
 * script for static apps. Reads the ef_scope cookie (set by the auth gate),
 * locks any element with data-requires-scope="read|write|admin" when the
 * visitor's scope is insufficient, and shows an upgrade prompt on click.
 *
 * Also exposes:
 *   window.efScope.getScope()        -> "none" | "read" | "write" | "admin"
 *   window.efScope.isAtLeast(min)    -> boolean
 *   window.efScope.onScopeChange(fn) -> unsubscribe()
 *   window.efScope.showUpgradePrompt(required)
 *
 * If you change either copy and want them to converge, the canonical source
 * lives at github.com/elijahnfrost/design-system src/scope/*.
 */

(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.efScope) return;

  var SCOPE_COOKIE_NAME = "ef_scope";
  var AUTH_ORIGIN = "https://auth.elijahfrost.com";
  var POLL_INTERVAL_MS = 5000;
  var ATTR = "data-requires-scope";
  var LOCKED_CLASS = "ef-scope-locked";
  var INTERCEPT_FLAG = "__efScopeIntercept";
  var SCOPE_RANK = { none: 0, read: 1, write: 2, admin: 3 };

  function scopeFromString(s) {
    return s === "read" || s === "write" || s === "admin" ? s : "none";
  }

  function getScope() {
    var parts = document.cookie ? document.cookie.split(";") : [];
    for (var i = 0; i < parts.length; i++) {
      var trimmed = parts[i].trim();
      if (trimmed.indexOf(SCOPE_COOKIE_NAME + "=") === 0) {
        try {
          return scopeFromString(
            decodeURIComponent(trimmed.slice(SCOPE_COOKIE_NAME.length + 1)),
          );
        } catch (e) {
          return "none";
        }
      }
    }
    return "none";
  }

  function isAtLeast(min) {
    return SCOPE_RANK[getScope()] >= SCOPE_RANK[min];
  }

  // -------- Scope-change subscription --------
  var subscribers = [];
  var pollTimer = null;
  var lastScope = "none";

  function startPolling() {
    if (pollTimer !== null) return;
    lastScope = getScope();
    pollTimer = setInterval(checkAndBroadcast, POLL_INTERVAL_MS);
  }
  function stopPollingIfIdle() {
    if (subscribers.length > 0) return;
    if (pollTimer === null) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }
  function checkAndBroadcast() {
    var next = getScope();
    if (next === lastScope) return;
    lastScope = next;
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](next); } catch (e) { /* swallow */ }
    }
  }
  function onScopeChange(handler) {
    subscribers.push(handler);
    startPolling();
    return function () {
      var idx = subscribers.indexOf(handler);
      if (idx >= 0) subscribers.splice(idx, 1);
      stopPollingIfIdle();
    };
  }

  // -------- Upgrade prompt --------
  var activeRoot = null;

  function buildDialog(required, current) {
    var sub = current !== "none"
      ? '<p class="ef-scope-dialog__sub">You are signed in as <strong>' + current + '</strong>.</p>'
      : "";
    return '<div class="ef-scope-dialog__backdrop" data-ef-action="cancel"></div>'
      + '<div role="dialog" aria-modal="true" aria-labelledby="ef-scope-dialog-title" class="ef-scope-dialog">'
      + '<h2 id="ef-scope-dialog-title" class="ef-scope-dialog__title">This action requires <strong>'
      + required + '</strong> access.</h2>'
      + sub
      + '<div class="ef-scope-dialog__actions">'
      + '<button type="button" data-ef-action="signin" class="ef-scope-dialog__primary">Sign in with a '
      + required + ' code</button>'
      + '<button type="button" data-ef-action="cancel" class="ef-scope-dialog__secondary">Cancel</button>'
      + '</div></div>';
  }

  function dismissUpgradePrompt() {
    if (!activeRoot) return;
    activeRoot.parentNode && activeRoot.parentNode.removeChild(activeRoot);
    activeRoot = null;
    document.removeEventListener("keydown", onPromptKeyDown, true);
  }

  function onPromptKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      dismissUpgradePrompt();
    }
  }

  function showUpgradePrompt(required) {
    if (activeRoot) return;
    var current = getScope();
    var root = document.createElement("div");
    root.className = "ef-scope-dialog-root";
    root.innerHTML = buildDialog(required, current);
    root.addEventListener("click", function (e) {
      var target = e.target;
      if (!target || !target.getAttribute) return;
      var action = target.getAttribute("data-ef-action");
      if (action === "cancel") {
        e.preventDefault();
        dismissUpgradePrompt();
      } else if (action === "signin") {
        e.preventDefault();
        var here = typeof location !== "undefined" ? location.href : "";
        location.href = AUTH_ORIGIN + "/?next=" + encodeURIComponent(here);
      }
    });
    document.body.appendChild(root);
    document.addEventListener("keydown", onPromptKeyDown, true);
    activeRoot = root;
    var primary = root.querySelector('[data-ef-action="signin"]');
    if (primary && primary.focus) primary.focus();
  }

  // -------- DOM enforcement --------
  function readRequired(el) {
    var raw = el.getAttribute(ATTR);
    return raw === "read" || raw === "write" || raw === "admin" ? raw : null;
  }

  function clickInterceptor(ev) {
    var el = this;
    var required = readRequired(el);
    if (!required) return;
    if (SCOPE_RANK[getScope()] >= SCOPE_RANK[required]) return;
    ev.preventDefault();
    ev.stopPropagation();
    showUpgradePrompt(required);
  }

  function lock(el, required) {
    if (typeof el.disabled === "boolean") el.disabled = true;
    el.setAttribute("aria-disabled", "true");
    el.classList.add(LOCKED_CLASS);
    if (!el[INTERCEPT_FLAG]) {
      el.addEventListener("click", clickInterceptor, true);
      el[INTERCEPT_FLAG] = true;
    }
    if (!el.title) el.title = "Requires " + required + " access";
  }

  function unlock(el) {
    if (typeof el.disabled === "boolean") el.disabled = false;
    el.removeAttribute("aria-disabled");
    el.classList.remove(LOCKED_CLASS);
    if (el[INTERCEPT_FLAG]) {
      el.removeEventListener("click", clickInterceptor, true);
      el[INTERCEPT_FLAG] = false;
    }
  }

  function walkAndApply(root, scope) {
    var nodes = root.querySelectorAll("[" + ATTR + "]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var required = readRequired(el);
      if (!required) continue;
      if (SCOPE_RANK[scope] >= SCOPE_RANK[required]) {
        unlock(el);
      } else {
        lock(el, required);
      }
    }
  }

  function applyAll() {
    walkAndApply(document, getScope());
  }

  function onMutations(mutations) {
    var scope = getScope();
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === "attributes" && m.target && m.target.nodeType === 1) {
        var el = m.target;
        var required = readRequired(el);
        if (!required) {
          unlock(el);
        } else if (SCOPE_RANK[scope] >= SCOPE_RANK[required]) {
          unlock(el);
        } else {
          lock(el, required);
        }
        continue;
      }
      if (m.addedNodes && m.addedNodes.length) {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node && node.nodeType === 1 && node.querySelectorAll) {
            walkAndApply(node, scope);
          }
        }
      }
    }
  }

  var observer = null;
  var mounted = false;

  function mount() {
    if (mounted) return;
    mounted = true;
    var start = function () {
      applyAll();
      observer = new MutationObserver(onMutations);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [ATTR],
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
    onScopeChange(applyAll);
  }

  window.efScope = {
    getScope: getScope,
    isAtLeast: isAtLeast,
    onScopeChange: onScopeChange,
    showUpgradePrompt: showUpgradePrompt,
    dismissUpgradePrompt: dismissUpgradePrompt,
    mount: mount,
  };

  mount();
})();
