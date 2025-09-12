const iidPath = (iid) => iid.split('/').map(encodeURIComponent).join('/');
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

function log(msg) {
  const t = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  els.log.textContent = `[${t}] ${msg}\n` + els.log.textContent;
}

const ZONES_FILL_OPACITY = 0.60;

// ====== Leaflet 地圖初始化 ======
let map = L.map(document.getElementById("map"));
L.tileLayer(TILE_OSM, { attribution: ATTR_OSM }).addTo(map);
map.setView([23.71, 120.43], 10);

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
async function installZoneLayersOnSameMap(map, opts = {}) {
  const query = opts.highlight ? `?highlight=${encodeURIComponent(opts.highlight)}` : "";
  const data = await fetchJSON(`./api/zones.json`);

  // 保留原始資料供動態篩選
  const zonesData  = data.zones;
  const labelsData = data.labels;

  // 1) 分區面
  const zonesLayer = L.geoJSON(zonesData, {
    style: (feat) => ({
      fillColor: colorForZone(feat.properties.zone_id),
      color: "#555",
      weight: 1,
      fillOpacity: ZONES_FILL_OPACITY
    }),
    onEachFeature: (feat, layer) => layer.bindTooltip(`Zone ${feat.properties.zone_id}`, { sticky: false })
  });

  // 2) 一般分區標籤
  const labelLayer = L.geoJSON(labelsData, {
    pointToLayer: (feat, latlng) =>
      L.marker(latlng, {
        interactive: false,
        icon: L.divIcon({
          className: "zone-label",
          html: `<div class="zone-label-inner">Z${feat.properties.zone_id}</div>`,
          iconSize: [30, 14],
          iconAnchor: [15, 7],
        }),
      }),
  });

  // 3) 高亮（面）
  let highlightLayer = L.geoJSON(data.highlight, {
    style: {
      color: "#ff2222",
      weight: 5,
      dashArray: "6,4",
      fillColor: "#ff6b6b",
      fillOpacity: 0.45,
    },
    onEachFeature: (_, layer) => layer.on("add", () => layer.bringToFront()),
  });

  // 4) 高亮（紅色粗體標籤）
  let highlightLabelLayer = L.geoJSON(labelsData, {
    filter: (f) => (data.highlight_ids || []).includes(f.properties.zone_id),
    pointToLayer: (feat, latlng) =>
      L.marker(latlng, {
        interactive: false,
        icon: L.divIcon({
          className: "zone-label-hl",
          html: `<div class="zone-label-hl-inner">Z${feat.properties.zone_id}</div>`,
          iconSize: [34, 18],
          iconAnchor: [17, 9],
        }),
      }),
  });

  // 加到圖層控制器（保留原有 overlays 機制）
  layerControl.addOverlay(zonesLayer, "Zones — Polygons");
  layerControl.addOverlay(labelLayer, "Zones — Labels");
  layerControl.addOverlay(highlightLayer, "Zones — Highlighted");
  layerControl.addOverlay(highlightLabelLayer, "Zones — Highlighted Labels");

  // 預設顯示：開啟高亮（面+標籤）；其餘關閉，交由 sidebar 面板控制
  highlightLayer.addTo(map);
  highlightLabelLayer.addTo(map);

  // API：動態設定高亮 ID（同步更新面與紅色粗體標籤）
  function setHighlightFromIds(ids) {
    const idset = new Set(ids.map((x) => parseInt(x, 10)));

    // 更新高亮面
    if (map.hasLayer(highlightLayer)) map.removeLayer(highlightLayer);
    layerControl.removeLayer(highlightLayer);
    highlightLayer = L.geoJSON(zonesData, {
      filter: (f) => idset.has(parseInt(f.properties.zone_id, 10)),
      style: {
        color: "#ff2222",
        weight: 5,
        dashArray: "6,4",
        fillColor: "#ff6b6b",
        fillOpacity: 0.45,
      },
      onEachFeature: (_, layer) => layer.on("add", () => layer.bringToFront()),
    });
    layerControl.addOverlay(highlightLayer, "Zones — Highlighted");
    highlightLayer.addTo(map);

    // 更新高亮標籤
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
            iconSize: [34, 18],
            iconAnchor: [17, 9],
          }),
        }),
    });
    layerControl.addOverlay(highlightLabelLayer, "Zones — Highlighted Labels");
    highlightLabelLayer.addTo(map);
  }

  // 暴露引用供面板使用
  window._zoneLayers = {
    zonesLayer,
    labelLayer,
    highlightLayer,
    highlightLabelLayer,
  };
  window._zoneLayersApi = { setHighlightFromIds };

  // 在 sidebar 內安裝整合面板（會自動帶入預設 highlight_ids）
  mountZonePanel({
    defaultIds: data.highlight_ids || [],
    map,
  });

  return window._zoneLayersApi;
}

// 把「Zone 選擇與顯示」整合到左側 sidebar 的一個可收折面板
function mountZonePanel({ defaultIds = [], map }) {
  const host = document.querySelector(".sidebar");
  if (!host) return;

  // 若已存在就先移除（避免重複掛載）
  const old = host.querySelector(".zonepanel");
  if (old) old.remove();

  // 讀取使用者偏好（勾選與收折狀態）
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem("zonePanelState") || "{}"); } catch { return {}; }
  })();
  const state = {
    collapsed: !!saved.collapsed,
    showPolygons: saved.showPolygons ?? false,
    showLabels: saved.showLabels ?? false,
    showHighlight: saved.showHighlight ?? true,
    ids: Array.isArray(saved.ids) ? saved.ids : defaultIds.slice(),
  };

  // 建立面板 DOM
  const wrap = document.createElement("div");
  wrap.className = `group zonepanel${state.collapsed ? " collapsed" : ""}`;
  wrap.innerHTML = `
    <div class="zp-head" role="button" tabindex="0" aria-expanded="${!state.collapsed}">
      <div class="zp-head-left">
        <span class="chev" aria-hidden="true"></span>
        <span class="title">區域顯示（Zones）</span>
      </div>
    </div>
    <div class="zp-body">
      <div class="row" style="grid-template-columns: 1fr 1fr 1fr; gap:8px;">
        <label class="switch">
          <input type="checkbox" id="zshow-polygons" ${state.showPolygons ? "checked" : ""}>
          <span class="slider"></span><span class="slabel">分區面</span>
        </label>
        <label class="switch">
          <input type="checkbox" id="zshow-labels" ${state.showLabels ? "checked" : ""}>
          <span class="slider"></span><span class="slabel">分區標籤</span>
        </label>
        <label class="switch">
          <input type="checkbox" id="zshow-highlight" ${state.showHighlight ? "checked" : ""}>
          <span class="slider"></span><span class="slabel">高亮</span>
        </label>
      </div>
      <label style="margin-top:10px;">選擇需特別標示的分區</label>
      <div class="zp-grid" id="zgrid"></div>
      <div class="zp-actions" style="margin-top:8px; display:flex; gap:8px;">
        <button type="button" class="secondary" id="z-all">全選</button>
        <button type="button" class="secondary" id="z-none">清空</button>
        <button type="button" class="" id="z-apply">套用高亮</button>
      </div>
    </div>
  `;
  host.appendChild(wrap);

  // 產生 1~11 勾選
  const grid = wrap.querySelector("#zgrid");
  for (let i = 1; i <= 11; i++) {
    const item = document.createElement("label");
    item.className = "zp-item";
    item.innerHTML = `
      <input type="checkbox" value="${i}" ${state.ids.includes(i) ? "checked" : ""}>
      <span>Z${i}</span>
    `;
    grid.appendChild(item);
  }

  // UI 快捷
  const $ = (sel) => wrap.querySelector(sel);
  const chkPolygons  = $("#zshow-polygons");
  const chkLabels    = $("#zshow-labels");
  const chkHighlight = $("#zshow-highlight");

  // 封裝圖層顯示切換
  function setLayerVisible(layer, on) {
    if (!layer) return;
    const isOnMap = map.hasLayer(layer);
    if (on && !isOnMap) layer.addTo(map);
    if (!on && isOnMap) map.removeLayer(layer);
  }

  // 初始顯示狀態 → 對應操作
  const layers = window._zoneLayers || {};
  setLayerVisible(layers.zonesLayer, state.showPolygons);
  setLayerVisible(layers.labelLayer, state.showLabels);
  setLayerVisible(layers.highlightLayer, state.showHighlight);
  setLayerVisible(layers.highlightLabelLayer, state.showHighlight);

  // 綁定切換事件
  chkPolygons.addEventListener("change", () => {
    setLayerVisible(window._zoneLayers.zonesLayer, chkPolygons.checked);
    persist();
  });
  chkLabels.addEventListener("change", () => {
    setLayerVisible(window._zoneLayers.labelLayer, chkLabels.checked);
    persist();
  });
  chkHighlight.addEventListener("change", () => {
    setLayerVisible(window._zoneLayers.highlightLayer, chkHighlight.checked);
    setLayerVisible(window._zoneLayers.highlightLabelLayer, chkHighlight.checked);
    persist();
  });

  // 套用高亮：用現有 API
  $("#z-apply").addEventListener("click", () => {
    const ids = [];
    grid.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.checked && ids.push(parseInt(cb.value, 10)));
    if (window._zoneLayersApi && typeof window._zoneLayersApi.setHighlightFromIds === "function") {
      window._zoneLayersApi.setHighlightFromIds(ids);
      // 若高亮開關目前是關閉，幫忙打開
      if (!chkHighlight.checked) {
        chkHighlight.checked = true;
        setLayerVisible(window._zoneLayers.highlightLayer, true);
        setLayerVisible(window._zoneLayers.highlightLabelLayer, true);
      }
    }
    state.ids = ids; persist();
  });

  // 全選 / 清空
  $("#z-all").addEventListener("click", () => {
    grid.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = true));
  });
  $("#z-none").addEventListener("click", () => {
    grid.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = false));
  });

  // 收折
  const head = wrap.querySelector(".zp-head");
  head.addEventListener("click", toggleCollapse);
  head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCollapse(); }
  });
  function toggleCollapse() {
    wrap.classList.toggle("collapsed");
    head.setAttribute("aria-expanded", String(!wrap.classList.contains("collapsed")));
    state.collapsed = wrap.classList.contains("collapsed");
    persist();
  }

  // 持久化偏好
  function persist() {
    const ids = [];
    grid.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.checked && ids.push(parseInt(cb.value, 10)));
    const payload = {
      collapsed: wrap.classList.contains("collapsed"),
      showPolygons:  chkPolygons.checked,
      showLabels:    chkLabels.checked,
      showHighlight: chkHighlight.checked,
      ids,
    };
    try { localStorage.setItem("zonePanelState", JSON.stringify(payload)); } catch {}
  }
}


// ====== 載入 instance 列表 ======
async function loadInstances() {
  try {
    const r = await fetch("./api/instances.json");
    if (!r.ok) throw new Error(`GET /api/instances ${r.status}`);
    const items = await r.json();
    const opts = [{ value: "", label: "-- 請選擇 --" }].concat((items || []).map(id => ({ value: id, label: id })));
    fillSelect(els.instanceSel, opts);
  } catch (e) {
    log(`載入 instances 失敗：${e.message}`);
  }
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
    const r = await fetch(`./api/instances/${iidPath(iid)}/viz`);
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

    if (current.zoneLayer)  { map.removeLayer(current.zoneLayer); }
    if (viz.zoneGeo) current.zoneLayer = L.geoJSON(viz.zoneGeo,{style:{color:"#f21111",weight:2,fill:false}}).addTo(map);

    let b=null; try{b=current.pointsLayer.getBounds();}catch{}; if(current.zoneLayer){try{b=b?b.extend(current.zoneLayer.getBounds()):current.zoneLayer.getBounds();}catch{}}
    if (b && b.isValid()) map.fitBounds(b,{padding:[20,20]}); else if(viz.center) map.setView([viz.center.lat,viz.center.lon],11);

    const labels = viz.labels || []; current.labels = labels.slice(); current.iid = iid; current.matrix = null;
    const opts = labels.map(l=>({value:l}));
    fillSelect(els.originSel, opts, "--選擇節點--"); fillSelect(els.destSel, opts, "--選擇節點--"); guardSame();
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
    const r = await fetch(`./api/instances/${iidPath(current.iid)}/route?o=${encodeURIComponent(o)}&d=${encodeURIComponent(d)}`);
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
  const r = await fetch(`./api/instances/${iidPath(current.iid)}/matrix`);
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

document.addEventListener("mousemove", (e) => {
  if (!isPanning) return;
  const dx = e.clientX - panStartX;
  const dy = e.clientY - panStartY;
  els.matrixViewport.scrollLeft = panScrollLeft - dx;
  els.matrixViewport.scrollTop  = panScrollTop  - dy;
});



document.addEventListener("keydown", (e)=>{ if (e.key==="Escape") closeMatrixModal(); });

// ====== 啟動 ======
(async function bootstrap(){
  await loadInstances();
  try {
    // 不帶 query 就用後端預設的高亮（[3,4,5,6]）
    await installZoneLayersOnSameMap(map);
  } catch (e) {
    log(`載入分區圖層失敗：${e.message}`);
  }
  log("就緒。請先選擇一個 Instance。");
})();

