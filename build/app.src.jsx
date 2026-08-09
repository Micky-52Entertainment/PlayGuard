const { useState, useEffect, useRef, useMemo } = React;

const DEVICE_DATABASE = [
  { id: '1a', name: 'iPhone 16 Pro Max', w: 440, h: 956, island: true, os: 'ios', group: 'Modern iOS' },
  { id: '1b', name: 'iPhone 16 Pro', w: 402, h: 874, island: true, os: 'ios', group: 'Modern iOS' },
  { id: '1c', name: 'iPhone 15 Pro Max', w: 430, h: 932, island: true, os: 'ios', group: 'Modern iOS' },
  { id: '1d', name: 'iPhone 15 Pro', w: 393, h: 852, island: true, os: 'ios', group: 'Modern iOS' },
  { id: '2a', name: 'iPhone 14', w: 390, h: 844, notch: {w: 160, h: 32}, os: 'ios', group: 'Classic iOS' },
  { id: '3a', name: 'Samsung S24 Ultra', w: 412, h: 915, hole: true, os: 'android', group: 'Android Flagships' },
  { id: '3c', name: 'Google Pixel 9 Pro XL', w: 412, h: 910, hole: true, os: 'android', group: 'Android Flagships' },
  { id: '4a', name: 'Galaxy Z Fold 6 (Inside)', w: 648, h: 790, fold: 'v', os: 'android', group: 'Foldables' },
  { id: '5a', name: 'iPad Pro 13 (M4)', w: 1024, h: 1366, os: 'ios', group: 'Tablets' }
];

function App() {
  const getCached = (k, d) => { const v = localStorage.getItem(k); try { return v ? JSON.parse(v) : d; } catch { return d; } };

  const [devices] = useState(() => getCached('audit_dev_v3', DEVICE_DATABASE));
  const [htmlRaw, setHtmlRaw] = useState("");
  const [finalSrcDoc, setFinalSrcDoc] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => getCached('audit_sel_v3', ['1a', '3a', '1d']));
  const [activePreset, setActivePreset] = useState('all');
  const [zoom, setZoom] = useState(0.18);
  const [isLandscape, setIsLandscape] = useState(() => getCached('vibe_landscape', false));
  const [isDark, setIsDark] = useState(() => getCached('vibe_dark', false));
  const [results, setResults] = useState({});
  const [dragData, setDragData] = useState(null);
  const [relativeZonePerc, setRelativeZonePerc] = useState(null);
  const [isModifierPressed, setIsModifierPressed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  // Recording States
  const [recordedActions, setRecordedActions] = useState(() => getCached('audit_scenario', []));
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordStartTime, setRecordStartTime] = useState(0);

  // Element Inspector States
  const [isInspectorMode, setIsInspectorMode] = useState(false);
  const [hoveredElement, setHoveredElement] = useState(null);
  const [selectedElements, setSelectedElements] = useState([]);
  const [inspectorInfo, setInspectorInfo] = useState(null);

  const overlayRef = useRef(null);
  const iframeRefs = useRef({});

  const activeDevices = useMemo(() => devices.filter(d => selectedIds.includes(d.id)), [devices, selectedIds]);
  const deviceGroups = useMemo(() => {
    const groups = {};
    devices.forEach(d => { if(!groups[d.group]) groups[d.group] = []; groups[d.group].push(d); });
    return groups;
  }, [devices]);

  useEffect(() => {
    const handleKeyDown = (e) => { if (e.altKey || e.metaKey) setIsModifierPressed(true); };
    const handleKeyUp = (e) => { if (!e.altKey && !e.metaKey) setIsModifierPressed(false); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, []);

  useEffect(() => {
    if (!isRecording && recordedActions.length > 0) {
      localStorage.setItem('audit_scenario', JSON.stringify(recordedActions));
    }
  }, [isRecording, recordedActions]);

  useEffect(() => {
    if (!htmlRaw) { setFinalSrcDoc(""); return; }
    
    // Inject Element Picker script into iframe
    const elementPickerCode = `
(function() {
  let pickerActive = false;
  let selectedElements = new Map();
  let highlightedElement = null;

  function getElementSelector(el) {
    if (!el || el.nodeType !== 1) return null;
    const id = el.id;
    if (id) return '#' + id;
    const classList = el.className;
    if (classList && typeof classList === 'string') {
      const classes = classList.trim().split(/\\s+/).slice(0, 3).join('.');
      if (classes) return el.tagName.toLowerCase() + '.' + classes;
    }
    let path = [];
    while (el.parentElement) {
      let index = 1;
      let sibling = el.previousElementSibling;
      while (sibling) {
        if (sibling.tagName.toLowerCase() === el.tagName.toLowerCase()) index++;
        sibling = sibling.previousElementSibling;
      }
      const tagSelector = el.tagName.toLowerCase() + (index > 1 ? ':nth-of-type(' + index + ')' : '');
      path.unshift(tagSelector);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

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

  function highlightElement(el, color = '#3b82f6') {
    if (highlightedElement) {
      highlightedElement.style.outline = '';
      highlightedElement.style.outlineOffset = '';
    }
    if (el) {
      el.style.outline = '3px solid ' + color;
      el.style.outlineOffset = '2px';
      highlightedElement = el;
    } else {
      highlightedElement = null;
    }
  }

  function sendToParent(type, data) {
    window.parent.postMessage({ type: type, data: data }, '*');
  }

  window.addEventListener('message', function(e) {
    if (e.data.type === 'INSPECTOR_MODE_TOGGLE') {
      pickerActive = e.data.active;
      document.body.style.cursor = pickerActive ? 'crosshair' : 'auto';
      if (!pickerActive) {
        highlightElement(null);
      }
    }
  });

  document.addEventListener('mouseover', function(e) {
    if (!pickerActive) return;
    const el = e.target;
    if (el && el.nodeType === 1 && el !== document.body && el !== document.html) {
      highlightElement(el, '#3b82f6');
      const info = getElementInfo(el);
      sendToParent('ELEMENT_HOVER', { element: info });
    }
  }, true);

  document.addEventListener('click', function(e) {
    if (!pickerActive) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    if (el && el.nodeType === 1 && el !== document.body && el !== document.html) {
      const info = getElementInfo(el);
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

  window.__AuditProInspector = {
    getSelectedElements: function() { return Array.from(selectedElements.values()); },
    activate: function(active) { 
      pickerActive = active; 
      document.body.style.cursor = active ? 'crosshair' : 'auto'; 
    },
    clearSelected: function() { 
      selectedElements.clear(); 
      highlightElement(null); 
    }
  };

  sendToParent('INSPECTOR_READY', { version: '1.0' });
})();
    `;
    
    const webglHack = "";
    setFinalSrcDoc(webglHack + '<script>' + elementPickerCode + '</script>' + htmlRaw);
  }, [htmlRaw, refreshKey]);

  useEffect(() => {
    const handleMirror = (e) => {
      if (e.data.type === 'FROM_MASTER') {
        if (e.data.name === 'hover') {
          setMousePos({ x: e.data.absX, y: e.data.absY });
        } else if (e.data.type === 'ELEMENT_HOVER') {
          setHoveredElement(e.data.element);
        } else if (e.data.type === 'ELEMENT_CLICK') {
          const elem = e.data.element;
          if (isModifierPressed) {
            // Multi-select: Ctrl/Cmd+Click
            setSelectedElements(prev => {
              const exists = prev.find(el => el.selector === elem.selector);
              return exists ? prev.filter(el => el.selector !== elem.selector) : [...prev, elem];
            });
          } else {
            // Single select
            setSelectedElements([elem]);
          }
          setInspectorInfo(elem);
        } else if (!isInspectorMode) {
          if (isRecording) {
            const timestamp = Date.now() - recordStartTime;
            setRecordedActions(prev => [...prev, { ...e.data, timestamp }]);
          }
          activeDevices.forEach((dev, idx) => {
            if (idx !== 0) iframeRefs.current[dev.id]?.contentWindow?.postMessage({ type: 'MIRROR_ACTION', ...e.data }, '*');
          });
        }
      }
    };
    window.addEventListener('message', handleMirror);
    return () => window.removeEventListener('message', handleMirror);
  }, [activeDevices, isRecording, recordStartTime, isInspectorMode, isModifierPressed]);

  const playScenario = () => {
    if (recordedActions.length === 0) return;
    setIsPlaying(true);
    recordedActions.forEach((action) => {
      setTimeout(() => {
        activeDevices.forEach((dev) => {
          iframeRefs.current[dev.id]?.contentWindow?.postMessage({ type: 'MIRROR_ACTION', ...action }, '*');
        });
      }, action.timestamp);
    });
    const lastAction = recordedActions[recordedActions.length - 1];
    setTimeout(() => setIsPlaying(false), lastAction.timestamp + 100);
  };

  const applyPreset = (type) => {
    setActivePreset(type);
    if (type === 'ios') setSelectedIds(devices.filter(d => d.os === 'ios').map(d => d.id));
    else if (type === 'android') setSelectedIds(devices.filter(d => d.os === 'android').map(d => d.id));
    else if (type === 'all') setSelectedIds(devices.map(d => d.id));
  };

  const getIframePixels = async (iframeEl, x, y, w, h) => {
    try {
      const doc = iframeEl.contentWindow.document;
      const canvas = doc.getElementById('application-canvas') || doc.querySelector('canvas');
      if (!canvas) return null;
      const off = document.createElement('canvas');
      off.width = Math.floor(w); off.height = Math.floor(h);
      const ctx = off.getContext('2d', { willReadFrequently: true });
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, x * sx, y * sy, w * sx, h * sy, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    } catch (e) { return null; }
  };

  const compareSmart = (p1, p2) => {
    if (!p1 || !p2 || p1.length !== p2.length) return false;
    let diff = 0; const tolerance = 50; const totalPixels = p1.length / 4;
    for (let i = 0; i < p1.length; i += 4) {
      if (p1[i+3] < 10) continue;
      if (Math.abs(p1[i]-p2[i]) > tolerance || Math.abs(p1[i+1]-p2[i+1]) > tolerance || Math.abs(p1[i+2]-p2[i+2]) > tolerance) diff++;
    }
    return (diff / totalPixels) < 0.25;
  };

  const runVisualAudit = async () => {
    if (!relativeZonePerc || !htmlRaw) return;
    setIsLoadingAudit(true);
    const report = {};
    const masterDev = activeDevices[0];
    const mw = isLandscape ? masterDev.h : masterDev.w, mh = isLandscape ? masterDev.w : masterDev.h;
    const masterPixels = await getIframePixels(iframeRefs.current[masterDev.id], Math.floor(relativeZonePerc.x * mw), Math.floor(relativeZonePerc.y * mh), Math.floor(relativeZonePerc.w * mw), Math.floor(relativeZonePerc.h * mh));

    for (const dev of activeDevices) {
      if (dev.id === masterDev.id) { report[dev.id] = 'pass'; continue; }
      const dw = isLandscape ? dev.h : dev.w, dh = isLandscape ? dev.w : dev.h;
      const tx = Math.floor(relativeZonePerc.x * dw), ty = Math.floor(relativeZonePerc.y * dh);
      const tw = Math.floor(relativeZonePerc.w * mw), th = Math.floor(relativeZonePerc.h * mh);
      let found = false;
      for (let ox = -15; ox <= 15; ox += 3) {
        for (let oy = -15; oy <= 15; oy += 3) {
          const slavePixels = await getIframePixels(iframeRefs.current[dev.id], tx + ox, ty + oy, tw, th);
          if (slavePixels && compareSmart(masterPixels, slavePixels)) { found = true; break; }
        }
        if (found) break;
      }
      report[dev.id] = found ? 'pass' : 'fail';
    }
    setResults(report); setIsLoadingAudit(false);
  };

  const handleMouseDown = (e) => {
    if (!isModifierPressed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setDragData({ startX: e.clientX - rect.left, startY: e.clientY - rect.top, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top });
  };

  const handleMouseMove = (e) => {
    if (!dragData) return;
    const rect = overlayRef.current.getBoundingClientRect();
    setDragData(prev => ({ ...prev, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top }));
  };

  const handleMouseUp = () => {
    if (!dragData) return;
    const master = activeDevices[0];
    const mw = isLandscape ? master.h : master.w, mh = isLandscape ? master.w : master.h;
    const wPx = Math.abs(dragData.currentX - dragData.startX) / zoom;
    const hPx = Math.abs(dragData.currentY - dragData.startY) / zoom;
    if (wPx > 10) {
      setRelativeZonePerc({
        x: (Math.min(dragData.startX, dragData.currentX) / zoom) / mw,
        y: (Math.min(dragData.startY, dragData.currentY) / zoom) / mh,
        w: wPx / mw, h: hPx / mh
      });
    }
    setDragData(null);
  };

  // Handle Inspector Mode Toggle - notify iframes
  useEffect(() => {
    activeDevices.forEach((dev) => {
      iframeRefs.current[dev.id]?.contentWindow?.postMessage({
        type: 'INSPECTOR_MODE_TOGGLE',
        active: isInspectorMode
      }, '*');
    });
  }, [isInspectorMode, activeDevices]);

  return (
          <div className={`flex h-screen w-screen transition-colors duration-300 ${isDark ? 'dark-mode' : 'bg-slate-200'}`}>
            <div className="w-80 sidebar bg-white shadow-2xl flex flex-col p-6 z-[600] border-r flex-shrink-0 transition-colors">
              <div className="flex justify-between items-center mb-1">
                <h1 className="text-2xl font-black text-blue-600 italic uppercase tracking-tighter leading-none">Audit Pro</h1>
                <button onClick={() => setIsDark(!isDark)} className="p-2 rounded-full hover:bg-slate-100">{isDark ? '☀️' : '🌙'}</button>
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">Action Sync Engine</p>

              <div className="mb-4">
                <div className="grid grid-cols-3 gap-1">
                  {['ios', 'android', 'all'].map(p => (
                          <button key={p} onClick={() => applyPreset(p)} className={`text-[8px] font-bold py-1.5 rounded-lg transition-all uppercase border ${activePreset === p ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-transparent hover:bg-slate-200'}`}>{p}</button>
                  ))}
                </div>
              </div>

              <div className={`flex p-1 rounded-xl mb-4 ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                <button onClick={() => setIsLandscape(false)} className={`flex-1 py-2 rounded-lg text-xs font-bold ${!isLandscape ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>PORTRAIT</button>
                <button onClick={() => setIsLandscape(true)} className={`flex-1 py-2 rounded-lg text-xs font-bold ${isLandscape ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>LANDSCAPE</button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-1.5 mb-4 scroll-smooth">
                {Object.keys(deviceGroups).map(groupName => (
                        <div key={groupName}>
                          <p className="text-[9px] font-black text-slate-400 uppercase mb-2 px-2 tracking-widest">{groupName}</p>
                          <div className="space-y-1">
                            {deviceGroups[groupName].map(d => (
                                    <label key={d.id} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all cursor-pointer card ${selectedIds.includes(d.id) ? 'border-blue-500 bg-blue-50/10' : 'border-slate-200 opacity-60'}`}>
                                      <input type="checkbox" checked={selectedIds.includes(d.id)} onChange={e => setSelectedIds(e.target.checked ? [...selectedIds, d.id] : selectedIds.filter(id => id !== d.id))} className="w-4 h-4 accent-blue-600" />
                                      <div className="flex flex-col min-w-0 pr-4">
                                        <span className="text-[11px] font-bold truncate dark:text-slate-300">{d.name}</span>
                                        <span className="text-[9px] text-slate-400 font-bold uppercase">{isLandscape ? `${d.h}x${d.w}` : `${d.w}x${d.h}`}</span>
                                      </div>
                                    </label>
                            ))}
                          </div>
                        </div>
                ))}
              </div>

              {/* Scenario Manager Section */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                <p className="text-[10px] font-black text-slate-400 uppercase mb-2 px-1 tracking-widest">Scenario Manager</p>
                <div className="bg-slate-100 dark:bg-slate-800/50 rounded-2xl p-3 mb-4 space-y-3">
                  <div className="flex items-center justify-between">
               <span className="text-[10px] font-bold uppercase flex items-center">
                  {isRecording ? (
                    <span><span className="status-dot" style={{ background: '#ef4444' }}></span> REC: {recordedActions.length}</span>
                  ) : isPlaying ? (
                    <span><span className="status-dot" style={{ background: '#2563eb' }}></span> PLAYING...</span>
                  ) : (
                    <span><span className="status-dot" style={{ background: '#94a3b8' }}></span> IDLE: {recordedActions.length}</span>
                  )}
               </span>
                    {recordedActions.length > 0 && !isRecording && (
                            <button onClick={() => { setRecordedActions([]); localStorage.removeItem('audit_scenario'); }} className="text-[9px] text-red-500 font-bold">CLEAR</button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {!isRecording ? (
                            <button onClick={() => { setRecordedActions([]); setRecordStartTime(Date.now()); setIsRecording(true); }} className="py-2.5 bg-red-500/10 text-red-500 rounded-xl text-[10px] font-black border border-red-500/20 hover:bg-red-500 hover:text-white transition-all">⏺ RECORD</button>
                    ) : (
                            <button onClick={() => setIsRecording(false)} className="py-2.5 bg-slate-800 text-white rounded-xl text-[10px] font-black">⏹ STOP</button>
                    )}

                    <button onClick={playScenario} disabled={isRecording || isPlaying || recordedActions.length === 0} className="py-2.5 bg-blue-600 text-white rounded-xl text-[10px] font-black shadow-lg shadow-blue-500/30 disabled:opacity-20">▶ PLAY</button>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex justify-between items-center px-1"><span className="text-[10px] font-bold text-slate-400 uppercase">Zoom</span><span className="text-[11px] font-black text-blue-600">{Math.round(zoom * 100)}%</span></div>
                <input type="range" min="0.1" max="1" step="0.01" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} className="w-full h-1.5 accent-blue-600 cursor-pointer rounded-lg bg-slate-200 dark:bg-slate-700" />
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setRefreshKey(k => k+1)} className="py-3 bg-slate-800 text-white rounded-xl font-bold text-[10px] uppercase">Reset</button>
                  <button onClick={runVisualAudit} disabled={!relativeZonePerc || isLoadingAudit} className="py-3 bg-blue-600 text-white rounded-xl font-black shadow-lg disabled:opacity-30 uppercase text-[10px]">
                    {isLoadingAudit ? '...' : 'Validate'}
                  </button>
                </div>
              </div>

              {/* Element Inspector Section */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Element Inspector</p>
                  <button 
                    onClick={() => setIsInspectorMode(!isInspectorMode)}
                    className={`px-3 py-1.5 text-[9px] font-black rounded-lg transition-all ${isInspectorMode ? 'bg-purple-600 text-white shadow-lg' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
                  >
                    {isInspectorMode ? '✓ PICKING' : '🔍 PICK'}
                  </button>
                </div>

                {/* Selected Elements List */}
                {selectedElements.length > 0 && (
                  <div className="bg-slate-100 dark:bg-slate-800/50 rounded-lg p-3 mb-3 max-h-40 overflow-y-auto">
                    <p className="text-[8px] font-bold text-slate-400 uppercase mb-2">Selected ({selectedElements.length})</p>
                    <div className="space-y-2">
                      {selectedElements.map((elem, i) => (
                        <div key={i} className="bg-white dark:bg-slate-700 rounded px-2 py-1.5 border border-purple-300 dark:border-purple-600 text-[9px]">
                          <div className="font-bold text-purple-600 dark:text-purple-400 truncate">{elem.tag}</div>
                          <div className="text-[8px] text-slate-500 dark:text-slate-400 truncate">{elem.selector}</div>
                          <div className="text-[8px] text-slate-500 dark:text-slate-400">{elem.width}×{elem.height}px</div>
                          <button 
                            onClick={() => setSelectedElements(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-[8px] text-red-500 font-bold mt-1"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inspector Info */}
                {inspectorInfo && (
                  <div className="bg-slate-100 dark:bg-slate-800/50 rounded-lg p-3 text-[9px]">
                    <p className="font-bold text-slate-700 dark:text-slate-300 mb-2">Element Info</p>
                    <div className="space-y-1 text-[8px] text-slate-600 dark:text-slate-400">
                      <div><span className="font-bold">Tag:</span> {inspectorInfo.tag}</div>
                      <div><span className="font-bold">ID:</span> {inspectorInfo.id || 'N/A'}</div>
                      <div><span className="font-bold">Classes:</span> {inspectorInfo.classes || 'N/A'}</div>
                      <div><span className="font-bold">Width:</span> {inspectorInfo.width}px</div>
                      <div><span className="font-bold">Height:</span> {inspectorInfo.height}px</div>
                      <div><span className="font-bold">Top:</span> {inspectorInfo.top}px</div>
                      <div><span className="font-bold">Left:</span> {inspectorInfo.left}px</div>
                      <div className="mt-2 p-2 bg-slate-200 dark:bg-slate-900 rounded font-mono break-words">
                        {inspectorInfo.selector}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => { setSelectedElements([]); setInspectorInfo(null); }}
                    disabled={selectedElements.length === 0}
                    className="py-2 bg-slate-800 text-white rounded-lg text-[9px] font-black disabled:opacity-30 transition-all"
                  >
                    CLEAR
                  </button>
                  <button 
                    onClick={() => { localStorage.setItem('audit_selected_elements', JSON.stringify(selectedElements)); }}
                    disabled={selectedElements.length === 0}
                    className="py-2 bg-purple-600 text-white rounded-lg text-[9px] font-black disabled:opacity-30 shadow-lg transition-all"
                  >
                    SAVE
                  </button>
                </div>
              </div>
            </div>

            <div className={`flex-1 overflow-auto p-12 relative transition-all ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}
                 onDragOver={e => e.preventDefault()}
                 onDrop={e => {
                   e.preventDefault();
                   const file = e.dataTransfer.files[0];
                   if(file?.name.endsWith('.html')){
                     const reader = new FileReader();
                     reader.onload = (ev) => { setHtmlRaw(ev.target.result); setRelativeZonePerc(null); setResults({}); };
                     reader.readAsText(file);
                   }
                 }}>
              {!htmlRaw ? (
                      <div className="h-full w-full flex flex-col items-center justify-center border-4 border-dashed border-slate-400/30 rounded-[40px] text-slate-400">
                        <span className="text-8xl mb-5">📂</span>
                        <h2 className="text-2xl font-black uppercase tracking-widest text-center">Drop Build Here<br/><span className="text-xs opacity-50 block font-normal mt-2 tracking-normal">Hold Alt/Option + Drag to select zone</span></h2>
                      </div>
              ) : (
                      <div className="flex flex-wrap gap-14 items-start justify-center pb-24 relative">
                        {activeDevices.map((dev, idx) => {
                          const isMaster = idx === 0;
                          const cw = isLandscape ? dev.h : dev.w, ch = isLandscape ? dev.w : dev.h;
                          return (
                            <div key={dev.id} className="flex flex-col gap-4 group relative">
                              <div className="flex justify-between items-end px-1">
                                <span className="text-[11px] font-black uppercase text-slate-500 flex items-center">
                                  <span className="status-dot" style={{background: dev.os === 'ios' ? '#10b981' : '#f59e0b'}}></span>
                                  {isMaster ? 'PRIMARY' : dev.name}
                                </span>
                                {results[dev.id] ? <span className="text-[9px] font-black px-2.5 py-1 rounded-full text-white bg-green-500">{results[dev.id].toUpperCase()}</span> : null}
                              </div>
                              <div className={`iframe-wrapper ${isMaster ? 'master-ring' : ''}`} style={{ width: cw * zoom, height: ch * zoom }}>
                                {isMaster && (
                                  <div ref={overlayRef} className={`selection-overlay ${isModifierPressed ? 'active' : ''}`} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
                                    {dragData && <div className="selection-marquee" style={{ left: Math.min(dragData.startX, dragData.currentX), top: Math.min(dragData.startY, dragData.currentY), width: Math.abs(dragData.currentX - dragData.startX), height: Math.abs(dragData.currentY - dragData.startY) }} />}
                                  </div>
                                )}
                                {mousePos.x > 0 && isMaster && React.createElement(React.Fragment, null, React.createElement('div', { className: 'guideline-h', style: { top: mousePos.y * zoom } }), React.createElement('div', { className: 'guideline-v', style: { left: mousePos.x * zoom } }))}
                                {relativeZonePerc && <div className={`target-zone-visual ${results[dev.id] || ''}`} style={{ left: (relativeZonePerc.x * cw) * zoom, top: (relativeZonePerc.y * ch) * zoom, width: (relativeZonePerc.w * cw) * zoom, height: (relativeZonePerc.h * ch) * zoom }} />}
                                <iframe ref={el => iframeRefs.current[dev.id] = el} key={refreshKey} srcDoc={finalSrcDoc} name={isMaster ? 'master_frame' : `slave_${dev.id}`} style={{ width: cw, height: ch, transform: `scale(${zoom})`, pointerEvents: isMaster ? 'auto' : 'none' }} />
                              </div>
                            </div>
                          );
                        })}

                        {/* fixed control panel */}
                        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-black/80 backdrop-blur-md text-white px-8 py-3 rounded-2xl flex items-center gap-12 border border-white/10 shadow-2xl">
                          <div className="flex flex-col"><span className="text-[8px] text-slate-400 uppercase font-black">Coords</span><span className="text-xs font-mono">{Math.round(mousePos.x)} : {Math.round(mousePos.y)}</span></div>
                          {relativeZonePerc && <div className="flex flex-col border-l border-white/20 pl-12"><span className="text-[8px] text-slate-400 uppercase font-black">Area</span><span className="text-xs font-mono">{Math.round(relativeZonePerc.w * 100)}% : {Math.round(relativeZonePerc.h * 100)}%</span></div>}
                          <div className="flex flex-col border-l border-white/20 pl-12">
                            <span className="text-[8px] text-blue-400 uppercase font-black">Recording</span>
                            <span className={`text-xs font-bold uppercase ${isRecording ? 'text-red-500' : 'text-blue-400'}`}>{isRecording ? 'Capturing' : 'Standby'}</span>
                          </div>
                        </div>
                )}
              </div>
            </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
