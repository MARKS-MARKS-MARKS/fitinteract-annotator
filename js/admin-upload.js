(function (namespace) {
  "use strict";

  const CHUNK_SIZE = 6 * 1024 * 1024;
  const RETRY_DELAYS = [0, 3000, 5000, 10000, 20000];
  const queue = [];
  let profile = null;
  let isUploading = false;

  const elements = {
    form: document.getElementById("upload-form"),
    dataset: document.getElementById("upload-dataset"),
    category: document.getElementById("upload-category"),
    files: document.getElementById("upload-files"),
    queue: document.getElementById("upload-queue"),
    summary: document.getElementById("upload-summary"),
    message: document.getElementById("upload-message"),
    start: document.getElementById("start-upload"),
    clear: document.getElementById("clear-upload-queue"),
    profile: document.getElementById("upload-profile"),
    logout: document.getElementById("upload-logout")
  };

  function showMessage(message, type) {
    elements.message.textContent = message || "";
    elements.message.className = "message " + (type || "info") + (message ? "" : " hidden");
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "--";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return value.toFixed(unit === 0 ? 0 : 1) + " " + units[unit];
  }

  function formatDuration(seconds) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return seconds === null ? "--" : "读取中…";
    const minutes = Math.floor(seconds / 60);
    return minutes + ":" + (seconds % 60).toFixed(2).padStart(5, "0");
  }

  function statusLabel(item) {
    const labels = {
      queued: "等待上传",
      reading: "读取信息",
      uploading: "上传中",
      ready: "已完成",
      error: "失败，可重试",
      database_error: "文件已上传，数据库更新失败"
    };
    return item.error ? labels[item.status] + "：" + item.error : (labels[item.status] || item.status);
  }

  function renderQueue() {
    if (!queue.length) {
      elements.queue.innerHTML = '<div class="empty-state">选择一个或多个视频后，文件信息会显示在这里。</div>';
      elements.summary.textContent = "尚未选择文件";
      return;
    }
    elements.queue.innerHTML = queue.map(function (item) {
      return '<div class="upload-item" data-upload-id="' + item.id + '">' +
        '<div><div class="upload-name" title="' + escapeHtml(item.file.name) + '">' + escapeHtml(item.file.name) + '</div><div class="help-text">' + escapeHtml(item.storagePath || item.file.type || "video/*") + '</div></div>' +
        '<div class="mono-text">' + formatBytes(item.file.size) + '</div>' +
        '<div class="mono-text">' + formatDuration(item.duration) + '</div>' +
        '<div class="progress-cell"><div class="progress-track" aria-label="上传进度"><div class="progress-bar" style="width:' + item.progress.toFixed(2) + '%"></div></div><div class="help-text upload-status">' + escapeHtml(statusLabel(item)) + '</div></div>' +
        '<strong class="mono-text">' + item.progress.toFixed(1) + '%</strong>' +
      '</div>';
    }).join("");
    const finished = queue.filter(function (item) { return item.status === "ready"; }).length;
    const failed = queue.filter(function (item) { return item.status === "error" || item.status === "database_error"; }).length;
    elements.summary.textContent = queue.length + " 个文件 · " + finished + " 已完成 · " + failed + " 失败";
  }

  function escapeHtml(value) {
    const node = document.createElement("div");
    node.textContent = String(value == null ? "" : value);
    return node.innerHTML;
  }

  function safeSegment(value, label) {
    const normalized = String(value || "").normalize("NFKC").trim();
    if (!normalized) throw new Error(label + " 不能为空。");
    if (normalized.includes("..") || /[\\/\u0000-\u001f\u007f]/.test(normalized)) {
      throw new Error(label + " 不能包含 ..、斜杠、反斜杠或控制字符。");
    }
    const safe = normalized.replace(/\s+/g, "_").replace(/[^A-Za-z0-9._\-\u3400-\u9fff]/g, "_");
    if (!safe || safe === "." || safe === "..") throw new Error(label + " 没有可用字符。");
    return safe;
  }

  function safeFilename(filename) {
    const normalized = String(filename || "video").normalize("NFKC").trim();
    if (!normalized || normalized.includes("..") || /[\\/\u0000-\u001f\u007f]/.test(normalized)) {
      throw new Error("文件名不能包含 ..、斜杠、反斜杠或控制字符。");
    }
    return normalized.replace(/\s+/g, "_").replace(/[^A-Za-z0-9._\-\u3400-\u9fff]/g, "_").slice(-180) || "video";
  }

  function readDuration(item) {
    item.status = "reading";
    renderQueue();
    return new Promise(function (resolve) {
      const video = document.createElement("video");
      const objectUrl = URL.createObjectURL(item.file);
      let settled = false;
      function finish(duration) {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(objectUrl);
        video.removeAttribute("src");
        video.load();
        item.duration = Number.isFinite(duration) ? Number(duration.toFixed(2)) : null;
        item.status = "queued";
        renderQueue();
        resolve();
      }
      video.preload = "metadata";
      video.onloadedmetadata = function () { finish(video.duration); };
      video.onerror = function () { finish(null); };
      window.setTimeout(function () { finish(null); }, 15000);
      video.src = objectUrl;
    });
  }

  async function getAccessToken() {
    const response = await namespace.Cloud.getClient().auth.getSession();
    if (response.error) throw response.error;
    const token = response.data.session && response.data.session.access_token;
    if (!token) throw new Error("登录会话已失效，请重新登录。");
    return token;
  }

  async function registerVideo(item, dataset, category, storagePath) {
    const client = namespace.Cloud.getClient();
    const existing = await client.from("videos").select("id,status").eq("storage_path", storagePath).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      item.videoId = existing.data.id;
      if (existing.data.status !== "ready") {
        const updated = await client.from("videos").update({ status: "ready" }).eq("id", existing.data.id);
        if (updated.error) throw updated.error;
      }
      return;
    }
    const values = {
      dataset: dataset,
      category: category,
      original_filename: item.file.name,
      storage_path: storagePath,
      duration_seconds: item.duration,
      file_size_bytes: item.file.size,
      mime_type: item.file.type || "application/octet-stream",
      status: "ready",
      created_by: profile.id
    };
    const response = await client.from("videos").insert(values).select("id").single();
    if (response.error) throw response.error;
    item.videoId = response.data.id;
  }

  function tusUpload(item, storagePath, accessToken) {
    if (!window.tus || typeof window.tus.Upload !== "function") {
      return Promise.reject(new Error("TUS 浏览器 SDK 未加载。"));
    }
    const configuration = namespace.Cloud.config();
    return new Promise(function (resolve, reject) {
      const upload = new window.tus.Upload(item.file, {
        endpoint: namespace.Cloud.getTusEndpoint(),
        retryDelays: RETRY_DELAYS,
        chunkSize: CHUNK_SIZE,
        removeFingerprintOnSuccess: true,
        headers: {
          authorization: "Bearer " + accessToken,
          apikey: configuration.publishableKey,
          "x-upsert": "false"
        },
        metadata: {
          bucketName: namespace.Cloud.getVideoBucket(),
          objectName: storagePath,
          contentType: item.file.type || "application/octet-stream",
          cacheControl: "3600"
        },
        onError: reject,
        onProgress: function (uploaded, total) {
          item.progress = total ? Math.min(100, uploaded / total * 100) : 0;
          renderQueue();
        },
        onSuccess: function () { item.progress = 100; renderQueue(); resolve(); }
      });
      upload.findPreviousUploads().then(function (previous) {
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      }).catch(reject);
    });
  }

  async function uploadOne(item, dataset, category) {
    if (item.status === "ready") return;
    item.error = "";
    if (!item.storagePath) {
      item.storagePath = dataset + "/" + category + "/" + crypto.randomUUID() + "__" + safeFilename(item.file.name);
    }
    item.status = "uploading";
    renderQueue();
    try {
      if (!item.storageUploaded) {
        const accessToken = await getAccessToken();
        await tusUpload(item, item.storagePath, accessToken);
        item.storageUploaded = true;
      }
      try {
        await registerVideo(item, dataset, category, item.storagePath);
        item.status = "ready";
      } catch (error) {
        item.status = "database_error";
        item.error = error.message || String(error);
      }
    } catch (error) {
      item.status = "error";
      item.error = error.message || String(error);
    }
    renderQueue();
  }

  async function startQueue(event) {
    event.preventDefault();
    if (isUploading) return;
    let dataset;
    let category;
    try {
      dataset = safeSegment(elements.dataset.value, "Dataset");
      category = safeSegment(elements.category.value, "Category");
    } catch (error) {
      showMessage(error.message, "error");
      return;
    }
    if (!queue.length) { showMessage("请先选择视频文件。", "error"); return; }
    isUploading = true;
    elements.start.disabled = true;
    elements.clear.disabled = true;
    showMessage("上传队列运行中。请保持页面打开；失败项可再次点击开始上传进行续传。", "info");
    for (const item of queue) await uploadOne(item, dataset, category);
    isUploading = false;
    elements.start.disabled = false;
    elements.clear.disabled = false;
    const failures = queue.filter(function (item) { return item.status === "error" || item.status === "database_error"; }).length;
    showMessage(failures ? "队列处理完毕，其中 " + failures + " 项需要处理。" : "全部视频已上传并登记为 ready。", failures ? "warning" : "success");
  }

  elements.files.addEventListener("change", function () {
    const files = Array.from(elements.files.files || []);
    files.forEach(function (file) {
      const item = { id: crypto.randomUUID(), file: file, duration: NaN, progress: 0, status: "queued", error: "", videoId: null, storagePath: "", storageUploaded: false };
      queue.push(item);
      readDuration(item);
    });
    elements.files.value = "";
    renderQueue();
  });

  elements.form.addEventListener("submit", startQueue);
  elements.clear.addEventListener("click", function () {
    if (isUploading) return;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (["ready", "error"].includes(queue[index].status)) queue.splice(index, 1);
    }
    renderQueue();
  });
  elements.logout.addEventListener("click", async function () {
    await namespace.Auth.signOut();
    window.location.href = "./login.html";
  });

  async function initialize() {
    if (!namespace.Cloud.isConfigured()) {
      showMessage("Supabase 尚未配置。请先填写 js/supabase-config.js 中的 URL 与 publishable key。", "error");
      document.querySelectorAll("button, input, select, textarea").forEach(function (element) { element.disabled = true; });
      return;
    }
    try {
      const auth = await namespace.Auth.requireProfile(["admin"]);
      if (!auth) { window.location.href = "./login.html?next=admin-upload.html"; return; }
      profile = auth.profile;
      elements.profile.textContent = (profile.display_name || profile.annotator_code) + " · admin";
    } catch (error) {
      if (error.code === "FORBIDDEN") { window.location.href = "./index.html?mode=online"; return; }
      showMessage(error.message || String(error), "error");
      elements.start.disabled = true;
    }
  }

  initialize();
})(window.FitInteract = window.FitInteract || {});
