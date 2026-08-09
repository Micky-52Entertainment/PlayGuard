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

  const [recordedActions, setRecordedActions] = useState(() => getCached('audit_scenario', []));
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordStartTime, setRecordStartTime] = useState(0);

  const [isInspectorMode, setIsInspectorMode] = useState(false);
  const [selectedElements, setSelectedElements] = useState([]);
  const [inspectorInfo, setInspectorInfo] = useState(null);

  const overlayRef = useRef(null);
  const iframeRefs = useRef({});

  const activeDevices = useMemo(() => devices.filter(d => selectedIds.includes(d.id)), [devices, selectedIds]);

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
    const elementPickerCode = `(function(){let pickerActive=false,selectedElements=new Map(),highlightedElement=null;function getElementSelector(el){if(!el||el.nodeType!==1)return null;const id=el.id;if(id)return'#'+id;const classList=el.className;if(classList&&typeof classList==='string'){const classes=classList.trim().split(/\\s+/).slice(0,3).join('.');if(classes)return el.tagName.toLowerCase()+'.'+classes}let path=[];while(el.parentElement){let index=1,sibling=el.previousElementSibling;while(sibling){if(sibling.tagName.toLowerCase()===el.tagName.toLowerCase())index++;sibling=sibling.previousElementSibling}const tagSelector=el.tagName.toLowerCase()+(index>1?':nth-of-type('+index+')':'');path.unshift(tagSelector);el=el.parentElement}return path.join(' > ')}function getElementInfo(el){const rect=el.getBoundingClientRect(),selector=getElementSelector(el);return{tag:el.tagName.toLowerCase(),selector:selector,id:el.id||'',classes:el.className||'',width:Math.round(rect.width),height:Math.round(rect.height),top:Math.round(rect.top),left:Math.round(rect.left),x:Math.round(rect.x),y:Math.round(rect.y),scrollY:window.scrollY||0,scrollX:window.scrollX||0}}function highlightElement(el,color){color=color||'#3b82f6';if(highlightedElement){highlightedElement.style.outline='';highlightedElement.style.outlineOffset=''}if(el){el.style.outline='3px solid '+color;el.style.outlineOffset='2px';highlightedElement=el}else{highlightedElement=null}}function sendToParent(type,data){window.parent.postMessage({type:type,data:data},'*')}window.addEventListener('message',function(e){if(e.data.type==='INSPECTOR_MODE_TOGGLE'){pickerActive=e.data.active;document.body.style.cursor=pickerActive?'crosshair':'auto';if(!pickerActive){highlightElement(null)}}});document.addEventListener('mouseover',function(e){if(!pickerActive)return;const el=e.target;if(el&&el.nodeType===1&&el!==document.body&&el!==document.html){highlightElement(el,'#3b82f6');const info=getElementInfo(el);sendToParent('ELEMENT_HOVER',{element:info})}},true);document.addEventListener('click',function(e){if(!pickerActive)return;e.preventDefault();e.stopPropagation();const el=e.target;if(el&&el.nodeType===1&&el!==document.body&&el!==document.html){const info=getElementInfo(el);if(selectedElements.has(info.selector)){selectedElements.delete(info.selector);highlightElement(el,'#3b82f6')}else{selectedElements.set(info.selector,info);highlightElement(el,'#8b5cf6')}sendToParent('ELEMENT_CLICK',{element:info})}},true);window.__AuditProInspector={getSelectedElements:function(){return Array.from(selectedElements.values())},activate:function(active){pickerActive=active;document.body.style.cursor=active?'crosshair':'auto'},clearSelected:function(){selectedElements.clear();highlightElement(null)}};sendToParent('INSPECTOR_READY',{version:'1.0'})})();`;
    setFinalSrcDoc('<script>'+elementPickerCode+'<\/script>'+htmlRaw);
  }, [htmlRaw, refreshKey]);

  useEffect(() => {
    const handleMirror = (e) => {
      if (e.data.type === 'FROM_MASTER') {
        if (e.data.name === 'hover') {
          setMousePos({ x: e.data.absX, y: e.data.absY });
        } else if (e.data.type === 'ELEMENT_CLICK') {
          const elem = e.data.element;
          if (isModifierPressed) {
            setSelectedElements(prev => {
              const exists = prev.find(el => el.selector === elem.selector);
              return exists ? prev.filter(el => el.selector !== elem.selector) : [...prev, elem];
            });
          } else {
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

  useEffect(() => {
    activeDevices.forEach((dev) => {
      iframeRefs.current[dev.id]?.contentWindow?.postMessage({ type: 'INSPECTOR_MODE_TOGGLE', active: isInspectorMode }, '*');
    });
  }, [isInspectorMode, activeDevices]);

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
    setTimeout(() => setIsPlaying(false), (recordedActions[recordedActions.length - 1]?.timestamp || 0) + 100);
  };

  const getIframePixels = async (iframeEl, x, y, w, h) => {
    try {
      const doc = iframeEl.contentWindow.document;
      const canvas = doc.getElementById('application-canvas') || doc.querySelector('canvas');
      if (!canvas) return null;
      const off = document.createElement('canvas');
      off.width = Math.floor(w);
      off.height = Math.floor(h);
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
    let diff = 0;
    const tolerance = 50;
    const totalPixels = p1.length / 4;
    for (let i = 0; i < p1.length; i += 4) {
      if (p1[i+3] < 10) continue;
      if (Math.abs(p1[i]-p2[i]) > tolerance || Math.abs(p1[i+1]-p2[i+1]) > tolerance || Math.abs(p1[i+2]-p2[i+2]) > tolerance) diff++;
    }
    return (diff / totalPixels) < 0.25;
  };

  const getElementDimensions = async (iframeEl, selector) => {
    try {
      const doc = iframeEl.contentWindow.document;
      const el = doc.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        area: Math.round(rect.width * rect.height),
        aspectRatio: parseFloat((rect.width / rect.height).toFixed(2))
      };
    } catch (e) { return null; }
  };

  const compareElementDimensions = (masterDims, slaveDims, tolerancePercent = 5) => {
    if (!masterDims || !slaveDims) return { pass: false };
    
    // Calculate differences as percentages
    const widthDiff = Math.abs(masterDims.width - slaveDims.width) / masterDims.width * 100;
    const heightDiff = Math.abs(masterDims.height - slaveDims.height) / masterDims.height * 100;
    const areaDiff = Math.abs(masterDims.area - slaveDims.area) / masterDims.area * 100;
    const aspectDiff = Math.abs(masterDims.aspectRatio - slaveDims.aspectRatio);
    
    // Calculate aspect ratio tolerance based on device sizes
    const masterAspect = masterDims.width / masterDims.height;
    const slaveAspect = slaveDims.width / slaveDims.height;
    const aspectTolerancePercent = Math.abs((masterAspect - slaveAspect) / masterAspect) * 100;
    
    // PASS logic:
    // 1. Width/Height must be within tolerance (scaled by aspect ratio differences)
    // 2. Area should be consistent (with more lenient tolerance due to rounding)
    // 3. Aspect ratio should be close (allows up to 2% deviation due to screen scaling)
    const isWidthHeightAcceptable = widthDiff <= tolerancePercent && heightDiff <= tolerancePercent;
    const isAreaAcceptable = areaDiff <= tolerancePercent * 1.5;
    const isAspectAcceptable = aspectTolerancePercent <= 2; // 2% aspect ratio tolerance
    
    return {
      pass: isWidthHeightAcceptable && isAreaAcceptable && isAspectAcceptable,
      widthDiff: parseFloat(widthDiff.toFixed(2)),
      heightDiff: parseFloat(heightDiff.toFixed(2)),
      areaDiff: parseFloat(areaDiff.toFixed(2)),
      aspectDiff: parseFloat(aspectDiff.toFixed(3)),
      aspectTolerancePercent: parseFloat(aspectTolerancePercent.toFixed(2)),
      isWidthHeightAcceptable,
      isAreaAcceptable,
      isAspectAcceptable
    };
  };

  const runVisualAudit = async () => {
    if (!selectedElements || selectedElements.length === 0) {
      alert('Please select elements to validate');
      return;
    }
    
    setIsLoadingAudit(true);
    const report = {};
    const masterDev = activeDevices[0];
    
    try {
      for (const elem of selectedElements) {
        const masterDims = await getElementDimensions(iframeRefs.current[masterDev.id], elem.selector);
        
        if (!masterDims) {
          report[`${elem.selector}_all`] = { status: 'error', message: 'Element not found on primary device' };
          continue;
        }

        const elementReport = { [masterDev.id]: 'PASS' };
        
        for (const dev of activeDevices) {
          if (dev.id === masterDev.id) continue;
          
          const slaveDims = await getElementDimensions(iframeRefs.current[dev.id], elem.selector);
          const comparison = compareElementDimensions(masterDims, slaveDims);
          
          elementReport[dev.id] = {
            status: comparison.pass ? 'PASS' : 'FAIL',
            widthDiff: comparison.widthDiff,
            heightDiff: comparison.heightDiff,
            areaDiff: comparison.areaDiff,
            aspectDiff: comparison.aspectDiff,
            masterDims,
            slaveDims
          };
        }
        
        report[elem.selector] = elementReport;
      }
      
      setResults(report);
    } catch (err) {
      console.error('Audit error:', err);
      alert('Error during validation');
    } finally {
      setIsLoadingAudit(false);
    }
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
        w: wPx / mw,
        h: hPx / mh
      });
    }
    setDragData(null);
  };

  return React.createElement('div', { className: `flex h-screen w-screen transition-colors ${isDark ? 'dark-mode' : 'bg-slate-200'}` },
    React.createElement('div', { className: 'w-80 sidebar bg-white shadow-2xl flex flex-col p-6 z-600 border-r' },
      React.createElement('h1', { className: 'text-2xl font-black text-blue-600 mb-1' }, 'Audit Pro'),
      React.createElement('p', { className: 'text-[10px] text-slate-400 mb-6' }, 'Element Inspector'),
      React.createElement('button', {
        onClick: () => setIsInspectorMode(!isInspectorMode),
        className: `px-3 py-1.5 text-[9px] font-black rounded ${isInspectorMode ? 'bg-purple-600 text-white' : 'bg-slate-200'}`
      }, isInspectorMode ? 'PICKING' : 'PICK'),
      React.createElement('button', {
        onClick: runVisualAudit,
        disabled: selectedElements.length === 0 || isLoadingAudit,
        className: `w-full mt-3 px-3 py-2 text-[9px] font-black rounded ${selectedElements.length === 0 ? 'bg-slate-300 text-slate-500' : 'bg-blue-600 text-white'} disabled:opacity-50`
      }, isLoadingAudit ? 'VALIDATING...' : 'VALIDATE'),
      selectedElements.length > 0 && React.createElement('div', { className: 'mt-4 bg-slate-100 p-3 rounded' },
        React.createElement('p', { className: 'text-[8px] font-bold mb-2' }, `Selected: ${selectedElements.length}`),
        selectedElements.map((elem, i) =>
          React.createElement('div', { key: i, className: 'text-[9px] mb-2 p-2 bg-white rounded border border-purple-300' },
            React.createElement('div', { className: 'font-bold' }, elem.tag),
            React.createElement('div', { className: 'text-[8px]' }, elem.selector),
            React.createElement('div', { className: 'text-[8px]' }, `${elem.width}x${elem.height}px`),
            React.createElement('button', {
              onClick: () => setSelectedElements(prev => prev.filter((_, idx) => idx !== i)),
              className: 'text-[8px] text-red-500 mt-1'
            }, 'Remove')
          )
        )
      ),
      inspectorInfo && React.createElement('div', { className: 'mt-4 bg-slate-100 p-3 rounded text-[8px]' },
        React.createElement('p', { className: 'font-bold mb-2' }, 'Element Info'),
        React.createElement('div', null, 'Tag: ', inspectorInfo.tag),
        React.createElement('div', null, 'Width: ', inspectorInfo.width, 'px'),
        React.createElement('div', null, 'Height: ', inspectorInfo.height, 'px'),
        React.createElement('div', { className: 'mt-2 font-mono text-[7px] break-words' }, inspectorInfo.selector)
      )
    ),
    React.createElement('div', { className: `flex-1 overflow-auto p-12 ${isDark ? 'bg-slate-950' : 'bg-slate-100'}` },
      !htmlRaw ? React.createElement('div', { className: 'h-full flex flex-col items-center justify-center text-slate-400' },
        React.createElement('span', { className: 'text-8xl mb-5' }, '📂'),
        React.createElement('h2', { className: 'text-2xl font-black' }, 'Drop HTML file here')
      ) : React.createElement('div', { className: 'flex flex-col gap-12' },
        React.createElement('div', { className: 'flex flex-wrap gap-14 items-start justify-center' },
          activeDevices.map((dev) => {
            const cw = isLandscape ? dev.h : dev.w, ch = isLandscape ? dev.w : dev.h;
            return React.createElement('div', { key: dev.id, className: 'flex flex-col gap-4' },
              React.createElement('span', { className: 'text-[11px] font-black' }, dev.name),
              React.createElement('div', { style: { width: cw * zoom, height: ch * zoom } },
                React.createElement('iframe', {
                  ref: el => iframeRefs.current[dev.id] = el,
                  srcDoc: finalSrcDoc,
                  name: `frame_${dev.id}`,
                  style: { width: cw, height: ch, transform: `scale(${zoom})` }
                })
              )
            );
          })
        ),
        Object.keys(results).length > 0 && React.createElement('div', { className: 'bg-slate-900 text-white rounded-lg p-6 max-w-full overflow-auto' },
          React.createElement('h3', { className: 'text-xl font-black mb-4' }, 'Validation Results'),
          Object.entries(results).map(([selector, elementReport]) =>
            React.createElement('div', { key: selector, className: 'mb-6 p-4 bg-slate-800 rounded-lg border border-slate-700' },
              React.createElement('div', { className: 'font-bold text-purple-400 mb-3 text-[13px] break-words' }, selector),
              React.createElement('div', { className: 'space-y-2' },
                Object.entries(elementReport).map(([deviceId, result]) => {
                  const isPass = result === 'PASS' || (result && result.status === 'PASS');
                  return React.createElement('div', { key: deviceId, className: `flex items-start gap-3 p-2 rounded ${isPass ? 'bg-green-900/30 border-l-4 border-green-500' : 'bg-red-900/30 border-l-4 border-red-500'}` },
                    React.createElement('span', { className: `font-bold text-[12px] mt-0.5 ${isPass ? 'text-green-400' : 'text-red-400'}` }, isPass ? '✓' : '✗'),
                    React.createElement('div', { className: 'text-[12px]' },
                      React.createElement('div', { className: 'font-bold mb-1' }, activeDevices.find(d => d.id === deviceId)?.name || deviceId),
                      typeof result === 'object' && result.status ? (
                        React.createElement('div', { className: 'text-[11px] text-slate-300 space-y-0.5' },
                          React.createElement('div', null, `Status: ${result.status}`),
                          result.message ? React.createElement('div', null, `Message: ${result.message}`) : null,
                          result.widthDiff !== undefined && React.createElement('div', { className: result.isWidthHeightAcceptable ? 'text-green-300' : 'text-red-300' }, `Width diff: ${result.widthDiff}% ${result.isWidthHeightAcceptable ? '✓' : '✗'}`),
                          result.heightDiff !== undefined && React.createElement('div', { className: result.isWidthHeightAcceptable ? 'text-green-300' : 'text-red-300' }, `Height diff: ${result.heightDiff}% ${result.isWidthHeightAcceptable ? '✓' : '✗'}`),
                          result.areaDiff !== undefined && React.createElement('div', { className: result.isAreaAcceptable ? 'text-green-300' : 'text-red-300' }, `Area diff: ${result.areaDiff}% ${result.isAreaAcceptable ? '✓' : '✗'}`),
                          result.aspectTolerancePercent !== undefined && React.createElement('div', { className: result.isAspectAcceptable ? 'text-green-300' : 'text-red-300' }, `Aspect ratio diff: ${result.aspectTolerancePercent}% ${result.isAspectAcceptable ? '✓' : '✗'}`),
                          result.masterDims && React.createElement('div', { className: 'text-[10px] text-slate-400 mt-1' },
                            `Primary: ${result.masterDims.width}×${result.masterDims.height}px (AR: ${result.masterDims.aspectRatio})`
                          ),
                          result.slaveDims && React.createElement('div', { className: 'text-[10px] text-slate-400' },
                            `Device: ${result.slaveDims.width}×${result.slaveDims.height}px (AR: ${result.slaveDims.aspectRatio})`
                          )
                        )
                      ) : null
                    )
                  );
                })
              )
            )
          )
        )
      )
    )
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
