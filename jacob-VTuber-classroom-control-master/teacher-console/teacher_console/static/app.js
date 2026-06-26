const grid = document.querySelector("#device-grid");
const deviceForm = document.querySelector("#device-form");
const discoverForm = document.querySelector("#discover-form");
const discoverResults = document.querySelector("#discover-results");
const discoverCount = document.querySelector("#discover-count");
const message = document.querySelector("#message");
const template = document.querySelector("#device-card-template");
const selectAll = document.querySelector("#select-all");
const autoRefresh = document.querySelector("#auto-refresh");
const fileInput = document.querySelector("#distribution-file");
const fileName = document.querySelector("#file-name");
const distributeButton = document.querySelector("#distribute-file");
const restoreWorkspaceButton = document.querySelector("#restore-workspace");
const selectionSummary = document.querySelector("#selection-summary");
const lastRefresh = document.querySelector("#last-refresh");

const stats = {
  total: document.querySelector("#stat-total"),
  online: document.querySelector("#stat-online"),
  offline: document.querySelector("#stat-offline"),
  dirty: document.querySelector("#stat-dirty"),
  selected: document.querySelector("#stat-selected"),
};

const AUTO_REFRESH_MS = 5000;
let devices = [];
let statusByDevice = new Map();
let selectedDeviceIds = new Set();
let discoveredDevices = [];
let refreshPromise = null;
let autoRefreshTimer = null;

function setMessage(text, isError = false) {
  message.textContent = text || "";
  message.classList.toggle("error-message", Boolean(text) && isError);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error || "操作失败");
}

async function requestJson(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  // 注入教师登录 token（PRD T-2）
  const token = localStorage.getItem("teacher_token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    // 会话过期，清 token 显示登录页
    localStorage.removeItem("teacher_token");
    showLogin();
    throw new Error("未登录或会话过期");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `请求失败（${response.status}）`);
  }
  return payload;
}

function currentStatus(device) {
  const refreshed = statusByDevice.get(device.id);
  if (refreshed) return refreshed;
  if (device.status_cache || device.last_error || device.last_seen) {
    return {
      device,
      online: Boolean(device.last_seen) && !device.last_error,
      status: device.status_cache,
      latency_ms: device.latency_ms,
      last_seen: device.last_seen,
      error: device.last_error,
    };
  }
  return null;
}

function formatDateTime(value, fallback = "从未") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatLatency(value) {
  const latency = Number(value);
  return Number.isFinite(latency) ? `${Math.round(latency)} ms` : "-";
}

function summaryText(summary, action) {
  const total = Number(summary?.total || 0);
  const succeeded = Number(summary?.succeeded || 0);
  const failed = Number(summary?.failed || 0);
  return `${action}完成：共 ${total} 台，成功 ${succeeded} 台，失败 ${failed} 台`;
}

function selectedIds() {
  return devices.filter((device) => selectedDeviceIds.has(device.id)).map((device) => device.id);
}

function selectedPayload(extra = {}) {
  const deviceIds = selectedIds();
  if (deviceIds.length === 0) {
    throw new Error("请先选择至少一台设备");
  }
  return { device_ids: deviceIds, ...extra };
}

function syncSelectionControls() {
  const availableIds = new Set(devices.map((device) => device.id));
  selectedDeviceIds = new Set([...selectedDeviceIds].filter((id) => availableIds.has(id)));
  const selectedCount = selectedDeviceIds.size;
  const hasDevices = devices.length > 0;
  selectAll.checked = hasDevices && selectedCount === devices.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < devices.length;
  selectAll.disabled = !hasDevices;
  selectionSummary.textContent = `已选 ${selectedCount} 台`;
  stats.selected.textContent = String(selectedCount);
  distributeButton.disabled = selectedCount === 0 || !fileInput.files?.length;
  restoreWorkspaceButton.disabled = selectedCount === 0 || !fileInput.files?.length || !fileInput.files?.[0]?.name?.toLowerCase().endsWith(".zip");
  document.querySelectorAll("#batch-lock, #batch-unlock, #batch-collect").forEach((button) => {
    button.disabled = selectedCount === 0;
  });
}

function renderStats() {
  const states = devices.map(currentStatus);
  const online = states.filter((item) => item?.online).length;
  const offline = devices.length - online;
  const dirty = states.filter((item) => item?.status?.dirty).length;
  stats.total.textContent = String(devices.length);
  stats.online.textContent = String(online);
  stats.offline.textContent = String(offline);
  stats.dirty.textContent = String(dirty);
  syncSelectionControls();
}

function setStateTag(element, text, className = "") {
  element.textContent = text;
  element.classList.remove("warning-state", "success-state", "locked-state");
  if (className) element.classList.add(className);
}

function bindCardAction(button, action) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      setMessage(formatError(error), true);
    } finally {
      button.disabled = false;
    }
  });
}

function render() {
  grid.replaceChildren();
  if (devices.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂无设备，请从左侧添加或扫描导入。";
    grid.appendChild(empty);
    renderStats();
    return;
  }

  devices.forEach((device) => {
    const item = currentStatus(device);
    const status = item?.status || {};
    const card = template.content.firstElementChild.cloneNode(true);
    const online = Boolean(item?.online);
    card.dataset.deviceId = device.id;
    card.classList.add(online ? "online" : "offline");
    card.classList.toggle("selected", selectedDeviceIds.has(device.id));
    card.classList.toggle("disabled-device", device.enabled === false);

    const checkbox = card.querySelector(".device-select");
    checkbox.checked = selectedDeviceIds.has(device.id);
    checkbox.setAttribute("aria-label", `选择 ${device.name || device.id}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedDeviceIds.add(device.id);
      else selectedDeviceIds.delete(device.id);
      card.classList.toggle("selected", checkbox.checked);
      syncSelectionControls();
    });

    card.querySelector(".device-name").textContent = device.name || device.id;
    card.querySelector(".device-id").textContent = device.id;
    card.querySelector(".connection-state").textContent = device.enabled === false
      ? "已停用"
      : online
        ? "在线"
        : "离线";
    card.querySelector(".student").textContent = status.current_username
      ? `${status.class_name || "未分班"} / ${status.current_username}`
      : "未载入档案";
    card.querySelector(".character").textContent = status.character_name || "-";
    card.querySelector(".latency").textContent = formatLatency(item?.latency_ms ?? device.latency_ms);
    card.querySelector(".last-seen").textContent = formatDateTime(item?.last_seen ?? device.last_seen);
    card.querySelector(".device-url").textContent = device.base_url;
    card.querySelector(".device-url").title = device.base_url;

    setStateTag(
      card.querySelector(".save-state"),
      status.current_username ? (status.dirty ? "有未保存修改" : "已保存") : "保存状态未知",
      status.current_username ? (status.dirty ? "warning-state" : "success-state") : "",
    );
    setStateTag(
      card.querySelector(".submit-state"),
      status.current_username ? (status.submitted ? "已提交" : "未提交") : "提交状态未知",
      status.current_username && status.submitted ? "success-state" : "",
    );
    setStateTag(
      card.querySelector(".lock-state"),
      item?.status ? (status.locked ? "已锁定" : "未锁定") : "锁定状态未知",
      status.locked ? "locked-state" : "",
    );

    const snapshotWrap = card.querySelector(".snapshot-wrap");
    const snapshot = card.querySelector(".snapshot");
    const snapshotUpdatedAt = status.snapshot_updated_at;
    const cacheStamp = snapshotUpdatedAt || item?.last_seen || Date.now();
    snapshot.src = `/api/devices/${encodeURIComponent(device.id)}/thumbnail?t=${encodeURIComponent(cacheStamp)}`;
    snapshot.alt = `${device.name || device.id} 的学生端快照`;
    snapshot.addEventListener("load", () => snapshotWrap.classList.remove("no-snapshot"));
    snapshot.addEventListener("error", () => snapshotWrap.classList.add("no-snapshot"));
    snapshotWrap.classList.toggle("no-snapshot", !online && !snapshotUpdatedAt);
    card.querySelector(".snapshot-time").textContent = snapshotUpdatedAt
      ? `快照 ${formatDateTime(snapshotUpdatedAt, "")}`
      : "等待快照";

    const errorElement = card.querySelector(".error");
    const errorText = item?.error || device.last_error || "";
    errorElement.textContent = errorText;
    errorElement.hidden = !errorText;

    const lockButton = card.querySelector(".lock-button");
    lockButton.textContent = status.locked ? "解锁" : "锁定";
    card.querySelector(".refresh-button").disabled = device.enabled === false;
    lockButton.disabled = device.enabled === false;
    card.querySelector(".collect-button").disabled = device.enabled === false;
    bindCardAction(card.querySelector(".refresh-button"), () => refreshDevice(device.id));
    bindCardAction(lockButton, () => lockDevice(device.id, !status.locked));
    bindCardAction(card.querySelector(".collect-button"), () => collectDevice(device.id));
    bindCardAction(card.querySelector(".edit-button"), () => editDevice(device));
    bindCardAction(card.querySelector(".delete-button"), () => deleteDevice(device.id));
    grid.appendChild(card);
  });
  renderStats();
}

async function loadDevices() {
  const payload = await requestJson("/api/devices");
  devices = payload.devices || [];
  render();
}

async function refreshAll({ quiet = false } = {}) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshButton = document.querySelector("#refresh-all");
    refreshButton.disabled = true;
    if (!quiet) setMessage("正在刷新全部设备...");
    try {
      const payload = await requestJson("/api/refresh", { method: "POST" });
      statusByDevice = new Map((payload.devices || []).map((item) => [item.device.id, item]));
      devices = (payload.devices || []).map((item) => item.device);
      lastRefresh.textContent = `最近刷新：${formatDateTime(new Date().toISOString(), "刚刚")}`;
      if (!quiet) setMessage(`刷新完成：${devices.length} 台设备`);
      render();
    } finally {
      refreshButton.disabled = false;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function refreshDevice(deviceId) {
  setMessage(`正在刷新 ${deviceId}...`);
  const payload = await requestJson(`/api/devices/${encodeURIComponent(deviceId)}/refresh`, { method: "POST" });
  statusByDevice.set(deviceId, payload);
  const index = devices.findIndex((device) => device.id === deviceId);
  if (index >= 0 && payload.device) devices[index] = payload.device;
  lastRefresh.textContent = `最近刷新：${formatDateTime(new Date().toISOString(), "刚刚")}`;
  setMessage(`${deviceId} 刷新完成`);
  render();
}

async function lockDevice(deviceId, locked) {
  setMessage(`正在${locked ? "锁定" : "解锁"} ${deviceId}...`);
  await requestJson(`/api/devices/${encodeURIComponent(deviceId)}/lock`, {
    method: "POST",
    body: JSON.stringify({ locked }),
  });
  await refreshDevice(deviceId);
}

async function collectDevice(deviceId) {
  setMessage(`正在收集 ${deviceId} 的作品...`);
  const payload = await requestJson(`/api/devices/${encodeURIComponent(deviceId)}/collect`, { method: "POST" });
  setMessage(`收集完成：${payload.path || deviceId}`);
}

function editDevice(device) {
  deviceForm.elements.id.value = device.id;
  deviceForm.elements.name.value = device.name || "";
  deviceForm.elements.base_url.value = device.base_url || "";
  deviceForm.elements.group.value = device.group || "";
  deviceForm.elements.token.value = "";
  deviceForm.elements.enabled.checked = device.enabled !== false;
  deviceForm.elements.id.focus();
  deviceForm.scrollIntoView({ behavior: "smooth", block: "start" });
  setMessage(`正在编辑 ${device.name || device.id}，令牌留空将保留原值`);
}

async function deleteDevice(deviceId) {
  if (!window.confirm(`确认删除设备 ${deviceId}？`)) return;
  await requestJson(`/api/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
  selectedDeviceIds.delete(deviceId);
  statusByDevice.delete(deviceId);
  await loadDevices();
  setMessage(`已删除设备 ${deviceId}`);
}

async function runBatch(endpoint, payload, action) {
  setMessage(`正在批量${action}...`);
  const result = await requestJson(endpoint, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setMessage(summaryText(result.summary, action), Number(result.summary?.failed) > 0);
  return result;
}

async function batchLock(locked) {
  const payload = selectedPayload({ locked });
  await runBatch("/api/batch/lock", payload, locked ? "锁定" : "解锁");
  await refreshAll({ quiet: true });
}

async function batchCollect() {
  await runBatch("/api/batch/collect", selectedPayload(), "收集");
}

async function distributeFile() {
  const file = fileInput.files?.[0];
  if (!file) throw new Error("请先选择要分发的文件");
  const payload = selectedPayload();
  const body = new FormData();
  body.append("file", file);
  body.append("device_ids", JSON.stringify(payload.device_ids));
  setMessage(`正在分发 ${file.name}...`);
  const result = await requestJson("/api/batch/files/upload", { method: "POST", body });
  setMessage(summaryText(result.summary, `文件“${result.filename || file.name}”分发`), Number(result.summary?.failed) > 0);
}

async function restoreWorkspacePackage() {
  const file = fileInput.files?.[0];
  if (!file) throw new Error("请先选择作品包 ZIP");
  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new Error("作品包必须是 .zip 文件");
  }
  const payload = selectedPayload();
  const body = new FormData();
  body.append("file", file);
  body.append("device_ids", JSON.stringify(payload.device_ids));
  setMessage(`正在下发并应用作品包 ${file.name}...`);
  const result = await requestJson("/api/batch/workspace/restore", { method: "POST", body });
  setMessage(summaryText(result.summary, `作品包“${result.filename || file.name}”应用`), Number(result.summary?.failed) > 0);
}

function discoveryIdentity(item) {
  const status = item.status || {};
  const device = item.device || {};
  const id = String(status.device_id || device.id || "").trim();
  const name = String(status.device_name || device.name || id).trim();
  return { id, name };
}

function renderDiscoveryResults(scanned = 0) {
  discoverResults.replaceChildren();
  discoverCount.textContent = scanned ? `扫描 ${scanned} 个地址` : "";
  if (discoveredDevices.length === 0) {
    const empty = document.createElement("p");
    empty.className = "section-note";
    empty.textContent = scanned ? "未发现可连接的设备" : "";
    discoverResults.appendChild(empty);
    return;
  }

  const importAll = document.createElement("button");
  importAll.type = "button";
  importAll.className = "import-all-button";
  importAll.textContent = `导入全部 ${discoveredDevices.length} 台`;
  importAll.addEventListener("click", () => importDiscovered(discoveredDevices).catch((error) => setMessage(formatError(error), true)));
  discoverResults.appendChild(importAll);

  discoveredDevices.forEach((item) => {
    const identity = discoveryIdentity(item);
    const row = document.createElement("div");
    row.className = "discover-result";
    const textWrap = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    title.textContent = identity.name || identity.id;
    detail.textContent = `${item.device?.base_url || "地址未知"} · ${formatLatency(item.latency_ms)}`;
    textWrap.append(title, detail);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "导入";
    button.addEventListener("click", () => importDiscovered([item]).catch((error) => setMessage(formatError(error), true)));
    row.append(textWrap, button);
    discoverResults.appendChild(row);
  });
}

async function importDiscovered(items) {
  if (items.length === 0) return;
  const token = discoverForm.elements.token.value.trim();
  const group = discoverForm.elements.group.value.trim();
  setMessage(`正在导入 ${items.length} 台设备...`);
  const results = await Promise.allSettled(items.map((item) => {
    const identity = discoveryIdentity(item);
    if (!identity.id || !item.device?.base_url) {
      return Promise.reject(new Error("发现结果缺少设备编号或地址"));
    }
    const devicePayload = {
      id: identity.id,
      name: identity.name || identity.id,
      base_url: item.device.base_url,
      group: group || item.device.group || "",
      enabled: true,
    };
    if (token) devicePayload.token = token;
    return requestJson("/api/devices", {
      method: "POST",
      body: JSON.stringify(devicePayload),
    });
  }));
  const succeeded = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - succeeded;
  await loadDevices();
  setMessage(`导入完成：成功 ${succeeded} 台，失败 ${failed} 台`, failed > 0);
}

function startAutoRefresh() {
  window.clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  if (!autoRefresh.checked) return;
  autoRefreshTimer = window.setInterval(() => {
    refreshAll({ quiet: true }).catch((error) => setMessage(formatError(error), true));
  }, AUTO_REFRESH_MS);
}

deviceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(deviceForm);
  const payload = {
    id: String(formData.get("id") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    base_url: String(formData.get("base_url") || "").trim(),
    group: String(formData.get("group") || "").trim(),
    enabled: deviceForm.elements.enabled.checked,
  };
  const token = String(formData.get("token") || "").trim();
  if (token) payload.token = token;
  try {
    await requestJson("/api/devices", { method: "POST", body: JSON.stringify(payload) });
    deviceForm.reset();
    deviceForm.elements.enabled.checked = true;
    await loadDevices();
    setMessage(`设备 ${payload.name || payload.id} 已保存`);
  } catch (error) {
    setMessage(formatError(error), true);
  }
});

discoverForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#discover-button");
  button.disabled = true;
  discoveredDevices = [];
  renderDiscoveryResults();
  setMessage("正在扫描局域网，请稍候...");
  try {
    const payload = await requestJson("/api/discover", {
      method: "POST",
      body: JSON.stringify({
        cidr: discoverForm.elements.cidr.value.trim(),
        port: Number(discoverForm.elements.port.value),
        token: discoverForm.elements.token.value.trim(),
      }),
    });
    discoveredDevices = payload.devices || [];
    renderDiscoveryResults(payload.scanned || 0);
    setMessage(`扫描完成：发现 ${discoveredDevices.length} 台设备`);
  } catch (error) {
    setMessage(formatError(error), true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#clear-device-form").addEventListener("click", () => {
  deviceForm.reset();
  deviceForm.elements.enabled.checked = true;
});

selectAll.addEventListener("change", () => {
  selectedDeviceIds = selectAll.checked
    ? new Set(devices.map((device) => device.id))
    : new Set();
  render();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileName.textContent = file?.name || "未选择文件";
  fileName.title = file?.name || "未选择文件";
  syncSelectionControls();
});

document.querySelector("#refresh-all").addEventListener("click", () => {
  refreshAll().catch((error) => setMessage(formatError(error), true));
});
document.querySelector("#batch-lock").addEventListener("click", () => {
  batchLock(true).catch((error) => setMessage(formatError(error), true));
});
document.querySelector("#batch-unlock").addEventListener("click", () => {
  batchLock(false).catch((error) => setMessage(formatError(error), true));
});
document.querySelector("#batch-collect").addEventListener("click", () => {
  batchCollect().catch((error) => setMessage(formatError(error), true));
});
distributeButton.addEventListener("click", () => {
  distributeFile().catch((error) => setMessage(formatError(error), true));
});
restoreWorkspaceButton.addEventListener("click", () => {
  if (!confirm("确定要将该作品包应用到选中的学生机吗？这会覆盖学生端当前工作区。")) return;
  restoreWorkspacePackage().catch((error) => setMessage(formatError(error), true));
});
autoRefresh.addEventListener("change", startAutoRefresh);

// --- 教师登录（PRD T-2）---
const loginOverlay = document.querySelector("#login-overlay");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");

function showLogin() {
  if (loginOverlay) loginOverlay.style.display = "flex";
}
function hideLogin() {
  if (loginOverlay) loginOverlay.style.display = "none";
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = document.querySelector("#login-username").value.trim();
  const password = document.querySelector("#login-password").value;
  if (loginError) loginError.textContent = "";
  try {
    const resp = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (loginError) loginError.textContent = payload.detail || "登录失败";
      return;
    }
    localStorage.setItem("teacher_token", payload.token);
    hideLogin();
    loadDevices().then(() => refreshAll()).then(startAutoRefresh).catch((err) => setMessage(formatError(err), true));
  } catch (err) {
    if (loginError) loginError.textContent = formatError(err);
  }
}

if (loginForm) loginForm.addEventListener("submit", handleLoginSubmit);

// 启动：有 token 则直接进主界面，否则显示登录页
async function bootstrap() {
  const token = localStorage.getItem("teacher_token");
  if (!token) {
    showLogin();
    return;
  }
  // 校验 token 有效性
  try {
    await requestJson("/api/auth/me");
    hideLogin();
    await loadDevices();
    await refreshAll();
    startAutoRefresh();
  } catch (err) {
    // token 失效，显示登录页
    showLogin();
  }
}
bootstrap();
