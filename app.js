// ====== 基本設定 ======
const TILE_OSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTR_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';

const els = {
  instanceSel: document.getElementById("instanceSel"),
  originSel: document.getElementById("originSel"),
  destSel: document.getElementById("destSel"),
  showBtn: document.getElementById("showBtn"),
  routeInfo: document.getElementById("routeInfo"),
  instMeta: document.getElementById("instMeta"),
  log: document.getElementById("log"),
  showMatrixBtn: document.getElementById("showMatrixBtn"),

  // matrix modal
  matrixModal: document.getElementById("matrixModal"),
  matrixViewport: document.getElementById("matrixViewport"),
  matrixTitle: document.getElementById("matrixTitle"),
  matrixSubtitle: document.getElementById("matrixSubtitle"),
  btnClose: document.getElementById("btnClose"),
  btnZoomIn: document.getElementById("btnZoomIn"),
  btnZoomOut: document.getElementById("btnZoomOut"),
  btnFit: document.getElementById("btnFit"),
};

// === [DRAWER + I18N] ===
const I18N = {
  "zh-Hant": {
    title: "Yunlin Instance 可視化",
    hint: "選一個 Instance；任兩個節點按「顯示」；或開啟「矩陣」看所有節點對。",
    instance: "Instance",
    nodeA: "節點 A",
    nodeB: "節點 B",
    show: "顯示",
    legendOrigin: "Origin",
    legendDest: "Dest",
    allPairs: "所有節點間最短時間",
    openMatrix: "開啟矩陣（全螢幕）",
    status: "狀態",
    pleaseSelect: "-- 請選擇 --",
    selectNode: "--選擇節點--",
    matrixTitle: "所有節點間最短行車時間",
    fit: "適", zoomIn: "＋", zoomOut: "−", close: "關閉",
    // Zones 面板
    zonesTitle: "區域顯示（Zones）",
    zPolygons: "分區面",
    zLabels: "分區標籤",
    zHighlight: "高亮",
    zPick: "選擇需特別標示的分區",
    zAll: "全選", zNone: "清空", zApply: "套用高亮"
  },
  "en": {
    title: "Yunlin Instance Viewer",
    hint: "Pick an instance; choose any two nodes and click “Show”; or open the matrix to see all pairs.",
    instance: "Instance",
    nodeA: "Node A",
    nodeB: "Node B",
    show: "Show",
    legendOrigin: "Origin",
    legendDest: "Dest",
    allPairs: "Shortest time for all pairs",
    openMatrix: "Open matrix (full screen)",
    status: "Status",
    pleaseSelect: "-- Select --",
    selectNode: "-- Select node --",
    matrixTitle: "Shortest driving time between all nodes",
    fit: "Fit", zoomIn: "+", zoomOut: "−", close: "Close",
    // Zones panel
    zonesTitle: "Zones",
    zPolygons: "Polygons",
    zLabels: "Labels",
    zHighlight: "Highlight",
    zPick: "Select zones to highlight",
    zAll: "Select all", zNone: "Clear", zApply: "Apply"
  }
};
let LANG = localStorage.getItem("lang") || "zh-Hant";
const iidPath = iid => String(iid).split('/').map(encodeURIComponent).join('/');

// 後端 (/ui 或 /ui/ 開頭) → /api/；靜態 (非 /ui) → ./api/
const isBackendUI = /^\/ui(?:$|\/)/.test(location.pathname);
const API_BASE = isBackendUI ? '/api/' : './api/';
const apiUrl = (p) => `${API_BASE}${p}`;

// 通用 API 取用（先用目前 base，失敗再自動嘗試另一個 base）
async function fetchApi(path, opts){
  let r = await fetch(apiUrl(path), opts);
  if (r.ok) return r;
  const alt = API_BASE === './api/' ? '/api/' : './api/';
  r = await fetch(`${alt}${path}`, opts);
  return r;
}
async function fetchApiJson(path, opts){
  const r = await fetchApi(path, opts);
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}


function t(k){ return (I18N[LANG] && I18N[LANG][k]) || I18N["zh-Hant"][k] || k; }

function applyI18n(){
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key = el.getAttribute("data-i18n");
    if (key && I18N["zh-Hant"][key] !== undefined) el.textContent = t(key);
  });
  const sBtn = document.getElementById("showBtn"); if (sBtn) sBtn.textContent = t("show");
  const mt = document.getElementById("matrixTitle"); if (mt) mt.textContent = t("matrixTitle");
  const f = document.getElementById("btnFit"); if (f){ f.title=t("fit"); f.textContent=t("fit"); }
  const zi = document.getElementById("btnZoomIn"); if (zi){ zi.title=t("zoomIn"); zi.textContent=t("zoomIn"); }
  const zo = document.getElementById("btnZoomOut"); if (zo){ zo.title=t("zoomOut"); zo.textContent=t("zoomOut"); }
  const c = document.getElementById("btnClose"); if (c){ c.title=t("close"); c.textContent=t("close"); }
  const sel0 = els.instanceSel?.querySelector("option[value='']");
  if (sel0) sel0.textContent = t("pleaseSelect");
}

function setupDrawerAndLang(){
  const drawer   = document.getElementById("sidebar");
  const btnIn    = document.getElementById("drawerToggleInside"); // 標題列內按鈕
  const btnEdge  = document.getElementById("edgeOpen");            // 邊緣啟動鍵

  // 統一開關函式
  const setOpen = (on) => {
    drawer.classList.toggle("open", on);                 // 舊相容
    document.body.classList.toggle("drawer-open", on);   // 新首選
    localStorage.setItem("drawerOpen", on ? "1" : "0");
    btnIn?.setAttribute("aria-expanded", String(on));
    btnIn?.setAttribute("title", on ? "收合面板" : "展開面板");
    btnEdge?.setAttribute("aria-expanded", String(!on));
    btnEdge?.setAttribute("title", on ? "（隱藏）" : "展開面板");
    setTimeout(()=> map.invalidateSize(), 250);
  };

  // 初始狀態（預設打開）
  const open = localStorage.getItem("drawerOpen") !== "0";
  setOpen(open);

  // 點擊動作：在面板內的圓鈕「收合」；邊緣啟動鍵「展開」
  btnIn?.addEventListener("click", ()=> setOpen(false));
  btnEdge?.addEventListener("click", ()=> setOpen(true));

  // 語言切換（保留你原本的）
  const langSel = document.getElementById("langSel");
  if (langSel) {
    langSel.value = LANG;
    langSel.addEventListener("change", (e)=>{
      LANG = e.target.value; localStorage.setItem("lang", LANG);
      applyI18n(); guardSame();
      document.querySelector(".zonepanel")?.remove();
      mountZonePanel({ defaultIds: [], map });
    });
  }
  applyI18n();
  setTimeout(()=> map.invalidateSize(), 250);
}

// === [/DRAWER + I18N] ===

// === [/SIDEBAR COLLAPSE + I18N] ===


function log(msg) {
  const t = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  els.log.textContent = `[${t}] ${msg}\n` + els.log.textContent;
}

const ZONES_FILL_OPACITY = 0.6;

// ====== Leaflet 地圖初始化 ======
// 關閉預設左上縮放控制，改用右上
let map = L.map(document.getElementById("map"), { zoomControl: false });
L.tileLayer(TILE_OSM, { attribution: ATTR_OSM }).addTo(map);
L.control.zoom({ position: "topright" }).addTo(map);
map.setView([23.71, 120.43], 10);
requestAnimationFrame(() => map.invalidateSize());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    try { map.invalidateSize(); } catch(e){}
  }
});

const layerControl = {
  addOverlay: () => {},
  removeLayer: () => {}
};

// 目前狀態
let current = {
  iid: null,
  labels: [],
  pointsLayer: null,
  routeLayer: null,
  zoneLayer: null,
  matrix: null,     // { labels:[], minutes:[[]] }, 快取
};

// ====== 共用 ======
function fillSelect(sel, options, placeholder) {
  sel.innerHTML = "";
  if (placeholder) {
    const p = document.createElement("option");
    p.value = ""; p.textContent = placeholder; sel.appendChild(p);
  }
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value; o.textContent = opt.label ?? opt.value; sel.appendChild(o);
  }
}
function guardSame() {
  const o = els.originSel.value, d = els.destSel.value;
  els.showBtn.disabled = !o || !d || (o === d);
}


// === [ZONE OUTLINE & HIGHLIGHT SUPPORT] ===
// 從 instance id 擷取 Zxx → 數字（例如 Z04_N30_xxx → 4）
function extractZoneId(iid) {
  const m = String(iid || '').match(/Z(\d{1,2})[_-]/i);
  return m ? parseInt(m[1], 10) : null;
}

// 只保留必要的全域變數；實際描邊由較下方的 async outlineInstanceZone(iid) 處理
let __zonesData = null;
let __selectedZoneLayer = null;
// === [/ZONE OUTLINE & HIGHLIGHT SUPPORT] ===



// ===== NEW: 11 分區圖層（面 / 標籤 / 高亮）安裝，含互動控制 =====
const ZONE_PALETTE = [
  "#8dd3c7","#ffffb3","#bebada","#fb8072","#80b1d3",
  "#fdb462","#b3de69","#fccde5","#d9d9d9","#bc80bd","#ccebc5"
];
function colorForZone(id){
  const idx = (parseInt(id,10) - 1) % ZONE_PALETTE.length;
  return ZONE_PALETTE[idx];
}
async function fetchJSON(url){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return await r.json();
}

/**
 * 在同一張地圖上安裝 3 個可切換圖層，並放上一個可互動的分區選擇器
 * @param {L.Map} map
 * @param {Object} opts
 * @param {string|null} opts.highlight  例如 "3,4,5,6"，不給就用後端預設
 * @returns {Promise<{ setHighlightFromIds: (ids:number[])=>void }>}
 */
// 取代舊版：把 Zone 互動整合到左側 sidebar
async function installZoneLayersOnSameMap(map) {
  let data = null;
  try {
    data = await fetchApiJson("zones.json");         // 靜態模式
  } catch {
    const r = await fetch("/api/zones");             // 後端模式回退
    if (!r.ok) throw new Error(`/api/zones ${r.status}`);
    data = await r.json();
  }


  window.__zonesData = data;
  const zonesData  = data.zones;
  const labelsData = data.labels;

  const zonesLayer = L.geoJSON(zonesData, {
    style: (feat) => ({
      fillColor: colorForZone(feat.properties.zone_id),
      color: "#555", weight: 1, fillOpacity: ZONES_FILL_OPACITY
    }),
    onEachFeature: (feat, layer) => layer.bindTooltip(`Zone ${feat.properties.zone_id}`, { sticky: false })
  });

  const labelLayer = L.geoJSON(labelsData, {
    pointToLayer: (feat, latlng) =>
      L.marker(latlng, {
        interactive: false,
        icon: L.divIcon({
          className: "zone-label",
          html: `<div class="zone-label-inner">Z${feat.properties.zone_id}</div>`,
          iconSize: [30, 14], iconAnchor: [15, 7],
        }),
      }),
  });

  let highlightLayer = L.geoJSON({type:"FeatureCollection",features:[]});
  let highlightLabelLayer = L.geoJSON({type:"FeatureCollection",features:[]});

  layerControl.addOverlay(zonesLayer, "Zones — Polygons");
  layerControl.addOverlay(labelLayer, "Zones — Labels");

  function setHighlightFromIds(ids) {
    const idset = new Set(ids.map((x) => parseInt(x, 10)));

    if (map.hasLayer(highlightLayer)) map.removeLayer(highlightLayer);
    layerControl.removeLayer(highlightLayer);
    highlightLayer = L.geoJSON(zonesData, {
      filter: (f) => idset.has(parseInt(f.properties.zone_id, 10)),
      style: { color: "#ff2222", weight: 5, dashArray: "6,4", fillColor: "#ff6b6b", fillOpacity: 0.45 },
      onEachFeature: (_, layer) => layer.on("add", () => layer.bringToFront()),
    });
    layerControl.addOverlay(highlightLayer, "Zones — Highlighted");

    if (map.hasLayer(highlightLabelLayer)) map.removeLayer(highlightLabelLayer);
    layerControl.removeLayer(highlightLabelLayer);
    highlightLabelLayer = L.geoJSON(labelsData, {
      filter: (f) => idset.has(parseInt(f.properties.zone_id, 10)),
      pointToLayer: (feat, latlng) =>
        L.marker(latlng, {
          interactive: false,
          icon: L.divIcon({
            className: "zone-label-hl",
            html: `<div class="zone-label-hl-inner">Z${feat.properties.zone_id}</div>`,
            iconSize: [34, 18], iconAnchor: [17, 9],
          }),
        }),
    });
    layerControl.addOverlay(highlightLabelLayer, "Zones — Highlighted Labels");

    if (window._zoneLayers) {
      window._zoneLayers.highlightLayer = highlightLayer;
      window._zoneLayers.highlightLabelLayer = highlightLabelLayer;
    }
    const on = !!(document.querySelector(".zonepanel #zshow-highlight")?.checked);
    if (on) { highlightLayer.addTo(map); highlightLabelLayer.addTo(map); }
  }

  window._zoneLayers = { zonesLayer, labelLayer, highlightLayer, highlightLabelLayer };
  window._zoneLayersApi = { setHighlightFromIds };

  mountZonePanel({ defaultIds: [], map }); // 無預設高亮
  return window._zoneLayersApi;
}

function mountZonePanel({ defaultIds = [], map }) {
  const host = document.querySelector(".sidebar");
  if (!host) return;
  host.querySelector(".zonepanel")?.remove();

  const saved = (() => { try { return JSON.parse(localStorage.getItem("zonePanelState")||"{}"); } catch { return {}; }})();
  const state = {
    collapsed: !!saved.collapsed,
    showPolygons: saved.showPolygons ?? false,
    showLabels: saved.showLabels ?? false,
    showHighlight: saved.showHighlight ?? false,
    ids: Array.isArray(saved.ids) ? saved.ids : defaultIds.slice(),
  };

  const wrap = document.createElement("div");
  wrap.className = `group zonepanel${state.collapsed ? " collapsed" : ""}`;
  wrap.innerHTML = `
    <div class="zp-head" role="button" tabindex="0" aria-expanded="${!state.collapsed}">
      <div class="zp-head-left">
        <span class="chev" aria-hidden="true"></span>
        <span class="title">${t("zonesTitle")}</span>
      </div>
    </div>
    <div class="zp-body">
      <div class="row" style="grid-template-columns: 1fr 1fr 1fr; gap:8px;">
        <label class="switch">
          <input type="checkbox" id="zshow-polygons" ${state.showPolygons ? "checked" : ""}>
          <span class="slider"></span><span class="slabel">${t("zPolygons")}</span>
        </label>
        <label class="switch">
          <input type="checkbox" id="zshow-labels" ${state.showLabels ? "checked" : ""}>
          <span class="slider"></span><span class="slabel">${t("zLabels")}</span>
        </label>
        <label class="switch">
          <input type="checkbox" id="zshow-highlight" ${state.showHighlight ? "checked" : ""}>
          <span class="slider"></span><span class="slabel">${t("zHighlight")}</span>
        </label>
      </div>
      <label style="margin-top:10px;">${t("zPick")}</label>
      <div class="zp-grid" id="zgrid"></div>
      <div class="zp-actions" style="margin-top:8px; display:flex; gap:8px;">
        <button type="button" class="secondary" id="z-all">${t("zAll")}</button>
        <button type="button" class="secondary" id="z-none">${t("zNone")}</button>
        <button type="button" id="z-apply">${t("zApply")}</button>
      </div>
    </div>
  `;
  host.appendChild(wrap);

  const grid = wrap.querySelector("#zgrid");
  for (let i=1;i<=11;i++){
    const item = document.createElement("label");
    item.className="zp-item";
    item.innerHTML = `<input type="checkbox" value="${i}" ${state.ids.includes(i)?"checked":""}><span>Z${i}</span>`;
    grid.appendChild(item);
  }

  const $ = (sel)=>wrap.querySelector(sel);
  const chkPolygons  = $("#zshow-polygons");
  const chkLabels    = $("#zshow-labels");
  const chkHighlight = $("#zshow-highlight");

  function setLayerVisible(layer, on){
    if (!layer) return;
    const has = map.hasLayer(layer);
    if (on && !has) layer.addTo(map);
    if (!on && has) map.removeLayer(layer);
  }

  const layers = window._zoneLayers || {};
  setLayerVisible(layers.zonesLayer, state.showPolygons);
  setLayerVisible(layers.labelLayer, state.showLabels);
  setLayerVisible(layers.highlightLayer, state.showHighlight);
  setLayerVisible(layers.highlightLabelLayer, state.showHighlight);

  chkPolygons.addEventListener("change", ()=>{ setLayerVisible(window._zoneLayers.zonesLayer, chkPolygons.checked); persist(); });
  chkLabels.addEventListener("change",   ()=>{ setLayerVisible(window._zoneLayers.labelLayer, chkLabels.checked);   persist(); });
  chkHighlight.addEventListener("change",()=>{
    setLayerVisible(window._zoneLayers.highlightLayer, chkHighlight.checked);
    setLayerVisible(window._zoneLayers.highlightLabelLayer, chkHighlight.checked);
    persist();
  });

  $("#z-all").addEventListener("click", ()=>{ grid.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked=true); });
  $("#z-none").addEventListener("click", ()=>{ grid.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked=false); });
  $("#z-apply").addEventListener("click", ()=>{
    const ids=[]; grid.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked && ids.push(parseInt(cb.value,10)));
    window._zoneLayersApi?.setHighlightFromIds?.(ids);
    if (!chkHighlight.checked){ chkHighlight.checked = true;
      setLayerVisible(window._zoneLayers.highlightLayer, true);
      setLayerVisible(window._zoneLayers.highlightLabelLayer, true);
    }
    state.ids = ids; persist();
  });

  const head = wrap.querySelector(".zp-head");
  function toggleCollapse(){ wrap.classList.toggle("collapsed"); head.setAttribute("aria-expanded", String(!wrap.classList.contains("collapsed"))); persist(); }
  head.addEventListener("click", toggleCollapse);
  head.addEventListener("keydown", e=>{ if (e.key==="Enter"||e.key===" ") { e.preventDefault(); toggleCollapse(); } });

  function persist(){
    const ids=[]; grid.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked && ids.push(parseInt(cb.value,10)));
    try{ localStorage.setItem("zonePanelState", JSON.stringify({
      collapsed: wrap.classList.contains("collapsed"),
      showPolygons: chkPolygons.checked,
      showLabels: chkLabels.checked,
      showHighlight: chkHighlight.checked,
      ids,
    })); }catch{}
  }
}



// ====== 載入 instance 列表 ======
async function loadInstances() {
  try {
    // 先嘗試靜態清單；失敗再退回舊 API（相容後端）
    let items = null;
    try {
      items = await fetchJSON(apiUrl("instances.json"));
    } catch {
      const r = await fetch("/api/instances");
      if (!r.ok) throw new Error(`/api/instances ${r.status}`);
      items = await r.json();
    }
    const opts = [{ value: "", label: t("pleaseSelect") }]
      .concat((items || []).map(id => ({ value: id, label: id })));
    fillSelect(els.instanceSel, opts);
  } catch (e) {
    log(`載入 instances 失敗：${e.message}`);
  }
}

async function outlineInstanceZone(iid) {
  if (!iid) return;
  if (!__zonesData) {
    try {
      __zonesData = await fetchApiJson("zones.json");
    } catch {
      const r = await fetch("/api/zones");
      if (r.ok) __zonesData = await r.json();
      else return;
    }
  }
  if (!__selectedZoneLayer) {
    __selectedZoneLayer = L.geoJSON(null, {
      style: { color: 'red', weight: 3, fillOpacity: 0 },
      onEachFeature: (_, layer) => layer.on("add", ()=> layer.bringToFront())
    }).addTo(map);
  }
  __selectedZoneLayer.clearLayers();
  const zid = extractZoneId(iid);
  if (!zid) return;
  const feat = ((__zonesData.zones?.features)||[]).find(ft => (ft.properties||{}).zone_id == zid);
  if (feat?.geometry) __selectedZoneLayer.addData(feat);
}



// ====== 顯示某個 instance（含重複點聚合） ======
async function showInstance(iid) {
  try {
    if (!iid) {
      els.instMeta.textContent = "";
      current.iid = null; current.matrix = null;
      if (current.pointsLayer) { map.removeLayer(current.pointsLayer); current.pointsLayer = null; }
      if (current.routeLayer) { map.removeLayer(current.routeLayer); current.routeLayer = null; }
      if (current.zoneLayer)  { map.removeLayer(current.zoneLayer);  current.zoneLayer  = null; }
      fillSelect(els.originSel, [], "--"); fillSelect(els.destSel, [], "--");
      els.showBtn.disabled = true; els.routeInfo.style.display = "none";
      return;
    }
    const r = await fetchApi(`instances/${iidPath(iid)}/viz`);
    if (!r.ok) throw new Error(`GET /viz ${r.status}`);
    const viz = await r.json();

    // 群組重複座標
    const groups = new Map();
    function push(role, lat, lon, label, name) {
      const key = `${role}:${lat.toFixed(6)},${lon.toFixed(6)}`;
      let g = groups.get(key);
      if (!g) { g = { role, lat, lon, labels: [], nameSet: new Set() }; groups.set(key, g); }
      g.labels.push(label); if (name) g.nameSet.add(name);
    }
    (viz.origins || []).forEach((p, i) => push("origin", p.lat, p.lon, `O${i+1}`));
    (viz.destins || []).forEach((p, i) => push("dest", p.lat, p.lon, `D${i+1}`, (viz.destLabels && viz.destLabels[i]) || null));

    const feats = [];
    for (const g of groups.values()) {
      const nameStr = g.role === "dest" && g.nameSet.size ? ` [${Array.from(g.nameSet).join(" / ")}]` : "";
      feats.push({
        type:"Feature",
        geometry:{type:"Point", coordinates:[g.lon, g.lat]},
        properties:{role:g.role, labels:g.labels.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})), tooltip:`${g.labels.join(", ")}${nameStr}`}
      });
    }

    if (current.pointsLayer) { map.removeLayer(current.pointsLayer); }
    current.pointsLayer = L.geoJSON({type:"FeatureCollection",features:feats},{
      pointToLayer:(f, ll)=>L.circleMarker(ll,{radius:5,color:f.properties.role==="origin"?"#22c55e":"#ff7f0e",fill:true,fillOpacity:.95}).bindTooltip(f.properties.tooltip)
    }).addTo(map);

    if (current.zoneLayer)  { map.removeLayer(current.zoneLayer); current.zoneLayer = null; }
    if (viz.zoneGeo) {
      current.zoneLayer = L.geoJSON(viz.zoneGeo,{ style:{ color:"#f21111", weight:2, fill:false } })
        .on("add", ()=>{ try{ current.zoneLayer.bringToFront(); }catch{} })
        .addTo(map);
    } else {
      await outlineInstanceZone(iid);   // ← 等待紅邊畫好
    }


    let b=null; try{b=current.pointsLayer.getBounds();}catch{}; if(current.zoneLayer){try{b=b?b.extend(current.zoneLayer.getBounds()):current.zoneLayer.getBounds();}catch{}}
    if (b && b.isValid()) map.fitBounds(b,{padding:[20,20]}); else if(viz.center) map.setView([viz.center.lat,viz.center.lon],11);

    const labels = viz.labels || []; current.labels = labels.slice(); current.iid = iid; current.matrix = null;
    const opts = labels.map(l=>({value:l}));
    fillSelect(els.originSel, opts, t("selectNode"));
    fillSelect(els.destSel,   opts, t("selectNode"));
    guardSame();
    if (current.routeLayer) { map.removeLayer(current.routeLayer); current.routeLayer=null; }
    els.routeInfo.style.display="none";
    els.instMeta.textContent = `labels:${labels.length} · origins:${(viz.origins||[]).length} · destins:${(viz.destins||[]).length}` + (viz.zoneGeo?" · zone:✓":" · zone:—");
  } catch (e) { log(`載入 viz 失敗：${e.message}`); }
}

// ====== 單一路徑顯示 ======
async function showRoute() {

  try {
    if (!current.iid) return;
    const o = els.originSel.value, d = els.destSel.value;
    if (!o || !d) return; if (o===d) { log("相同節點不顯示"); return; }
    const r = await fetchApi(`instances/${iidPath(current.iid)}/route?o=${encodeURIComponent(o)}&d=${encodeURIComponent(d)}`);
    if (!r.ok) throw new Error(`GET /route ${r.status}`);
    const feat = await r.json();

    if (!feat.geometry) { if(current.routeLayer){map.removeLayer(current.routeLayer);current.routeLayer=null;}
      els.routeInfo.textContent="不可達"; els.routeInfo.style.display="inline-block"; return; }
    const layer = L.geoJSON(feat,{style:{weight:5,opacity:.95}});
    if (current.routeLayer) map.removeLayer(current.routeLayer);
    current.routeLayer = layer.addTo(map);
    try { map.fitBounds(layer.getBounds(),{padding:[20,20]}); } catch {}
    const mins = feat.properties && typeof feat.properties.minutes==="number" ? `${feat.properties.minutes} min` : "—";
    els.routeInfo.textContent = `${o} → ${d} · ${mins}`; els.routeInfo.style.display="inline-block";
  } catch (e) { log(`顯示路徑失敗：${e.message}`); }
}

// ====== 矩陣（全螢幕） ======
function openMatrixModal() {
  els.matrixModal.classList.remove("hidden");
  els.matrixModal.setAttribute("aria-hidden","false");
}
function closeMatrixModal() {
  els.matrixModal.classList.add("hidden");
  els.matrixModal.setAttribute("aria-hidden","true");
}
let matrixScale = 1;


function applyScale() {
  const table = els.matrixViewport.querySelector("table.matrix");
  if (!table) return;
  table.style.setProperty("--mzoom", String(matrixScale));
}
/* 以寬度自動合適（維持 CSS 變數機制） */
function fitMatrix() {
  const table = els.matrixViewport.querySelector("table.matrix");
  if (!table) return;
  // 先用 1 倍量測原始寬度
  table.style.setProperty("--mzoom", "1");
  const need = table.getBoundingClientRect().width;
  const vw = els.matrixViewport.clientWidth - 24;
  const s = Math.max(0.5, Math.min(3, vw / Math.max(need, 1)));
  matrixScale = s;
  applyScale();
}

function buildMatrixTable(labels, M) {
  const table = document.createElement("table"); table.className="matrix";
  const thead = document.createElement("thead"); const tr0=document.createElement("tr");
  tr0.appendChild(document.createElement("th"));
  labels.forEach(l=>{const th=document.createElement("th"); th.textContent=l; tr0.appendChild(th);});
  thead.appendChild(tr0); table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const frag = document.createDocumentFragment();
  labels.forEach((li,i)=>{
    const tr=document.createElement("tr");
    const th=document.createElement("th"); th.textContent=li; tr.appendChild(th);
    labels.forEach((lj,j)=>{
      const td=document.createElement("td");
      const v=M[i][j];
      if (i===j || v===999 || v==null) { td.className="diag"; td.textContent="—"; }
      else {
        td.textContent=Number(v).toFixed(2);
        td.title=`${li} → ${lj} (${Number(v).toFixed(2)} min)`;
        td.addEventListener("click", ()=>{
          els.originSel.value=li; els.destSel.value=lj; guardSame(); showRoute();
          closeMatrixModal();
        });
        const t=Math.max(0,Math.min(1, Number(v)/60));
        td.style.background=`rgba(59,130,246,${0.15+0.35*t})`;
      }
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag); table.appendChild(tbody);
  return table;
}
async function ensureMatrixLoaded() {
  if (current.matrix) return current.matrix;
  if (!current.iid) throw new Error("尚未選擇 instance");
  const r = await fetchApi(`instances/${iidPath(current.iid)}/matrix`);
  if (!r.ok) throw new Error(`GET /matrix ${r.status}`);
  const data = await r.json();
  current.matrix = { labels: data.labels || [], minutes: data.minutes || [] };
  return current.matrix;
}
async function showMatrix() {
  try {
    const {labels, minutes} = await ensureMatrixLoaded();
    els.matrixSubtitle.textContent = `Instance：${current.iid} · 節點數：${labels.length}`;
    els.matrixViewport.innerHTML = "";
    const table = buildMatrixTable(labels, minutes);
    els.matrixViewport.appendChild(table);
    matrixScale = 1; fitMatrix();
    openMatrixModal();
    /* 初始把卷軸置頂左，避免在放大後卡在某處 */
    els.matrixViewport.scrollTop = 0;
    els.matrixViewport.scrollLeft = 0;
  } catch (e) { log(`載入矩陣失敗：${e.message}`); }
}

// ====== 事件 ======
els.instanceSel.addEventListener("change", e => showInstance(e.target.value));
els.showBtn.addEventListener("click", showRoute);
els.originSel.addEventListener("change", guardSame);
els.destSel.addEventListener("change", guardSame);
if (els.showMatrixBtn) els.showMatrixBtn.addEventListener("click", showMatrix);

// modal 控制
els.btnClose.addEventListener("click", closeMatrixModal);
els.btnZoomIn.addEventListener("click", ()=>{ matrixScale = Math.min(3, matrixScale + 0.12); applyScale(); });
els.btnZoomOut.addEventListener("click", ()=>{ matrixScale = Math.max(0.5, matrixScale - 0.12); applyScale(); });
els.btnFit.addEventListener("click", fitMatrix);



document.addEventListener("keydown", (e)=>{ if (e.key==="Escape") closeMatrixModal(); });

// ====== 啟動 ======
(async function bootstrap(){
  setupDrawerAndLang();     
  await loadInstances();
  try {
    // 不帶 query 就用後端預設的高亮（[3,4,5,6]）
    await installZoneLayersOnSameMap(map);
  } catch (e) {
    log(`載入分區圖層失敗：${e.message}`);
  }
  log("就緒。請先選擇一個 Instance。");
})();

window.addEventListener('resize', () => { map.invalidateSize(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { map.invalidateSize(); }
});