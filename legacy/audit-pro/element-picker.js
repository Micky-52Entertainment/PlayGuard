// Element Picker Script - Injected into iframe
// Handles element inspection, highlighting, and messaging back to parent

(function() {
  let pickerActive = false;
  let selectedElements = new Map();
  let highlightedElement = null;

  // Create unique selector for element
  function getElementSelector(el) {
    if (!el || el.nodeType !== 1) return null;
    
    const id = el.id;
    if (id) return `#${id}`;
    
    const classList = el.className;
    if (classList && typeof classList === 'string') {
      const classes = classList.trim().split(/\s+/).slice(0, 3).join('.');
      if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
    }
    
    let path = [];
    while (el.parentElement) {
      let index = 1;
      let sibling = el.previousElementSibling;
      while (sibling) {
        if (sibling.tagName.toLowerCase() === el.tagName.toLowerCase()) index++;
        sibling = sibling.previousElementSibling;
      }
      const tagSelector = el.tagName.toLowerCase() + (index > 1 ? `:nth-of-type(${index})` : '');
      path.unshift(tagSelector);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  // Get element info
  function getElementInfo(el) {
    const rect = el.getBoundingClientRect();
    const selector = getElementSelector(el);
    
    return {
      tag: el.tagName.toLowerCase(),
      selector: selector,
      id: el.id || '',
      classes: el.className || '',
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      scrollY: window.scrollY || 0,
      scrollX: window.scrollX || 0
    };
  }

  // Highlight element on page
  function highlightElement(el, color = '#3b82f6') {
    if (highlightedElement) {
      highlightedElement.style.outline = '';
      highlightedElement.style.outlineOffset = '';
    }
    
    if (el) {
      el.style.outline = `3px solid ${color}`;
      el.style.outlineOffset = '2px';
      highlightedElement = el;
    } else {
      highlightedElement = null;
    }
  }

  // Send message to parent
  function sendToParent(type, data) {
    window.parent.postMessage({ type, data }, '*');
  }

  // Listen for picker activation from parent
  window.addEventListener('message', (e) => {
    if (e.data.type === 'INSPECTOR_MODE_TOGGLE') {
      pickerActive = e.data.active;
      document.body.style.cursor = pickerActive ? 'crosshair' : 'auto';
      if (!pickerActive) {
        highlightElement(null);
      }
    }
  });

  // Hover handler
  document.addEventListener('mouseover', (e) => {
    if (!pickerActive) return;
    
    const el = e.target;
    if (el && el.nodeType === 1 && el !== document.body && el !== document.html) {
      highlightElement(el, '#3b82f6');
      const info = getElementInfo(el);
      sendToParent('ELEMENT_HOVER', { element: info });
    }
  }, true);

  // Click handler
  document.addEventListener('click', (e) => {
    if (!pickerActive) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const el = e.target;
    if (el && el.nodeType === 1 && el !== document.body && el !== document.html) {
      const info = getElementInfo(el);
      
      // Toggle selection
      if (selectedElements.has(info.selector)) {
        selectedElements.delete(info.selector);
        highlightElement(el, '#3b82f6');
      } else {
        selectedElements.set(info.selector, info);
        highlightElement(el, '#8b5cf6');
      }
      
      sendToParent('ELEMENT_CLICK', { element: info });
    }
  }, true);

  // Expose global API
  window.__AuditProInspector = {
    getSelectedElements: () => Array.from(selectedElements.values()),
    activate: (active) => {
      pickerActive = active;
      document.body.style.cursor = active ? 'crosshair' : 'auto';
    },
    clearSelected: () => {
      selectedElements.clear();
      highlightElement(null);
    }
  };

  // Ready signal
  sendToParent('INSPECTOR_READY', { version: '1.0' });
})();
