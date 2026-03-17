// Universal DOM analysis script for platform key page inspection.
// Executed by AI Agent via mcp__claude-in-chrome__javascript_tool.
// Outputs JSON report of DOM structure, key elements, and selectors.
(() => {
  const result = {
    url: window.location.href,
    hostname: window.location.hostname,
    timestamp: new Date().toISOString(),
    framework: null,
    elements: [],
    keyLikeTexts: [],
    modals: [],
    copyButtons: [],
    inputFields: [],
    customElements: [],
  };

  // 1. Detect framework
  if (document.querySelector('[data-reactroot], [data-reactid]') ||
      document.querySelector('[class*="css-"]')) {
    result.framework = 'react';
  } else if (document.querySelector('[_nghost], [ng-version]')) {
    result.framework = 'angular';
  } else if (document.querySelector('[data-svelte-h]')) {
    result.framework = 'svelte';
  }

  // 2. Find key-like text elements
  const keyPrefixes = [
    'sk-proj-', 'sk-ant-', 'sk-or-', 'AKIA', 'ASIA', 'AIzaSy',
    'sk_live_', 'sk_test_', 'pk_live_', 'pk_test_',
    'ghp_', 'github_pat_', 'gho_',
    'hf_', 'xoxb-', 'xoxp-', 'SG.', 'glpat-',
    'sk-...', 'hf_...',
  ];

  const walker = document.createTreeWalker(
    document.body, NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
  );
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent.trim();
    for (const prefix of keyPrefixes) {
      if (text.includes(prefix)) {
        const parent = node.parentElement;
        result.keyLikeTexts.push({
          text: text.slice(0, 40) + (text.length > 40 ? '...' : ''),
          tag: parent?.tagName,
          classes: parent?.className?.toString().slice(0, 100),
          id: parent?.id,
          dataAttrs: Object.keys(parent?.dataset || {}),
          path: getElementPath(parent),
        });
        break;
      }
    }
  }

  // 3. Find input fields
  document.querySelectorAll('input, textarea').forEach(el => {
    const input = el;
    if (input.value?.length > 10 || input.type === 'password') {
      result.inputFields.push({
        tag: input.tagName,
        type: input.type,
        name: input.name,
        id: input.id,
        classes: input.className?.toString().slice(0, 100),
        valueLength: input.value?.length || 0,
        readonly: input.readOnly,
        path: getElementPath(input),
      });
    }
  });

  // 4. Find copy buttons and clipboard-copy elements
  document.querySelectorAll('clipboard-copy, [data-clipboard], button').forEach(el => {
    const text = el.textContent?.toLowerCase() || '';
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
    if (el.tagName === 'CLIPBOARD-COPY' || text.includes('copy') || ariaLabel.includes('copy')) {
      result.copyButtons.push({
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 50),
        value: el.getAttribute('value')?.slice(0, 20),
        classes: el.className?.toString().slice(0, 100),
        path: getElementPath(el),
      });
    }
  });

  // 5. Find modal/dialog elements
  document.querySelectorAll('[role="dialog"], [data-state], dialog, .modal, [class*="modal"], [class*="dialog"]').forEach(el => {
    result.modals.push({
      tag: el.tagName,
      role: el.getAttribute('role'),
      dataState: el.getAttribute('data-state'),
      classes: el.className?.toString().slice(0, 100),
      visible: el.offsetParent !== null,
      childCount: el.children.length,
    });
  });

  // 6. Find custom elements (Web Components)
  const customTags = new Set();
  document.body.querySelectorAll('*').forEach(el => {
    if (el.tagName.includes('-')) customTags.add(el.tagName.toLowerCase());
  });
  result.customElements = [...customTags];

  // 7. Classify stable vs dynamic CSS classes
  const stableClasses = [];
  const dynamicClasses = [];
  document.querySelectorAll('[class]').forEach(el => {
    const classes = el.className?.toString().split(/\s+/) || [];
    for (const cls of classes) {
      if (/^css-|^_|^[a-z]{5,7}$/.test(cls)) {
        if (!dynamicClasses.includes(cls) && dynamicClasses.length < 20) dynamicClasses.push(cls);
      } else if (/^[a-z]+-[a-z]+/.test(cls) && cls.length > 5) {
        if (!stableClasses.includes(cls) && stableClasses.length < 20) stableClasses.push(cls);
      }
    }
  });
  result.stableClassSamples = stableClasses;
  result.dynamicClassSamples = dynamicClasses;

  function getElementPath(el, depth = 4) {
    const parts = [];
    let current = el;
    for (let i = 0; i < depth && current && current !== document.body; i++) {
      let part = current.tagName?.toLowerCase() || '?';
      if (current.id) part += '#' + current.id;
      else if (current.className?.toString()) {
        const cls = current.className.toString().split(/\s+/)[0];
        if (cls && !/^css-|^_/.test(cls)) part += '.' + cls;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  return JSON.stringify(result, null, 2);
})()
