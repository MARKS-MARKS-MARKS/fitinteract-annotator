(function (namespace) {
  "use strict";

  const PAGE_SIZE = 50;
  const state = {
    client: null,
    profile: null,
    videos: [],
    videosPage: 0,
    videosTotal: 0,
    annotations: [],
    annotationsPage: 0,
    annotationsTotal: 0,
    selectedVideos: new Set(),
    annotators: [],
    templates: { query: [], text: [] }
  };

  const $ = (id) => document.getElementById(id);

  function one(value) {
    return Array.isArray(value) ? value[0] || null : value || null;
  }

  function showMessage(text, type, sticky) {
    const element = $("admin-message");
    element.textContent = text;
    element.className = "message " + (type || "info");
    window.clearTimeout(showMessage.timer);
    if (!sticky) showMessage.timer = window.setTimeout(() => element.classList.add("hidden"), 5000);
  }

  function formatDate(value) {
    return value ? new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    }).format(new Date(value)) : "--";
  }

  function textCell(row, value, className) {
    const cell = row.insertCell();
    cell.textContent = value === null || value === undefined || value === "" ? "--" : String(value);
    if (className) cell.className = className;
    return cell;
  }

  function actionButton(label, action, id, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className || "button small secondary";
    button.dataset.action = action;
    button.dataset.id = id;
    button.textContent = label;
    return button;
  }

  async function runButtonAction(button, action) {
    if (button.disabled) return;
    button.disabled = true;
    try { await action(); }
    catch (error) { showMessage(error.message || String(error), "error", true); }
    finally { button.disabled = false; }
  }

  async function loadMetrics() {
    const response = await state.client.rpc("get_admin_dashboard_metrics");
    if (response.error) throw new Error("Dashboard metrics 加载失败：" + response.error.message);
    const metrics = response.data || {};
    $("metric-total-videos").textContent = metrics.total_videos || 0;
    $("metric-assigned-videos").textContent = metrics.assigned_videos || 0;
    $("metric-total-tasks").textContent = metrics.total_tasks || 0;
    $("metric-completed-tasks").textContent = metrics.completed_tasks || 0;
    $("metric-in-progress").textContent = metrics.in_progress_tasks || 0;
    $("metric-unassigned-videos").textContent = metrics.unassigned_videos || 0;
    $("metric-submitted").textContent = metrics.submitted_annotations || 0;
  }

  async function loadProgressAndAnnotators() {
    const [progress, profiles] = await Promise.all([
      state.client.from("admin_annotator_progress").select("*").order("annotator_code"),
      state.client.from("profiles").select("id,annotator_code,display_name,role").eq("role", "annotator").order("annotator_code")
    ]);
    if (progress.error) throw new Error("标注进度加载失败：" + progress.error.message);
    if (profiles.error) throw new Error("标注员加载失败：" + profiles.error.message);
    state.annotators = profiles.data || [];
    const body = $("progress-body");
    body.textContent = "";
    (progress.data || []).forEach((item) => {
      const row = body.insertRow();
      textCell(row, item.annotator_code);
      textCell(row, item.display_name);
      textCell(row, item.assigned_count);
      textCell(row, item.in_progress_count);
      textCell(row, item.completed_count);
      const assigned = Number(item.assigned_count) || 0;
      const rate = assigned ? ((Number(item.completed_count) || 0) / assigned * 100).toFixed(1) + "%" : "0.0%";
      textCell(row, rate);
    });
    if (!(progress.data || []).length) body.innerHTML = '<tr><td colspan="6">暂无标注员</td></tr>';

    const select = $("assign-annotator");
    select.innerHTML = '<option value="">选择标注员</option>';
    state.annotators.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.annotator_code + " " + (profile.display_name || "");
      select.appendChild(option);
    });
  }

  async function loadVideos() {
    const body = $("videos-body");
    body.innerHTML = '<tr><td colspan="12">Loading videos…</td></tr>';
    let query = state.client.from("admin_video_overview").select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(state.videosPage * PAGE_SIZE, state.videosPage * PAGE_SIZE + PAGE_SIZE - 1);
    const dataset = $("video-dataset-filter").value.trim();
    const category = $("video-category-filter").value.trim();
    const search = $("video-search").value.trim();
    const assignment = $("video-assigned-filter").value;
    if (dataset) query = query.eq("dataset", dataset);
    if (category) query = query.eq("category", category);
    if (search) query = query.ilike("original_filename", "%" + search.replace(/[%_]/g, "\\$&") + "%");
    if (assignment === "assigned") query = query.gt("assigned_count", 0);
    if (assignment === "unassigned") query = query.eq("assigned_count", 0);
    const response = await query;
    if (response.error) throw new Error("视频列表加载失败：" + response.error.message);
    state.videos = response.data || [];
    state.videosTotal = response.count || 0;
    state.selectedVideos.clear();
    renderVideos();
  }

  function renderVideos() {
    const body = $("videos-body");
    body.textContent = "";
    state.videos.forEach((video) => {
      const row = body.insertRow();
      const checkboxCell = row.insertCell();
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.videoId = video.id;
      checkbox.disabled = video.status === "archived";
      checkbox.checked = state.selectedVideos.has(video.id);
      checkboxCell.appendChild(checkbox);
      textCell(row, video.id.slice(0, 8), "mono").title = video.id;
      textCell(row, video.dataset);
      textCell(row, video.category);
      textCell(row, video.original_filename);
      textCell(row, video.storage_path, "mono");
      textCell(row, video.duration_seconds === null ? "--" : Number(video.duration_seconds).toFixed(2) + " s");
      textCell(row, video.assigned_count);
      textCell(row, video.completed_count);
      const statusCell = row.insertCell();
      const status = document.createElement("span");
      status.className = "status-pill " + video.status;
      status.textContent = video.status;
      statusCell.appendChild(status);
      textCell(row, formatDate(video.created_at));
      const actions = row.insertCell();
      actions.appendChild(actionButton("归档", "archive", video.id));
      actions.appendChild(document.createTextNode(" "));
      actions.appendChild(actionButton("删除", "delete", video.id, "button small danger-ghost"));
    });
    if (!state.videos.length) body.innerHTML = '<tr><td colspan="12">暂无视频</td></tr>';
    const first = state.videosTotal ? state.videosPage * PAGE_SIZE + 1 : 0;
    const last = Math.min((state.videosPage + 1) * PAGE_SIZE, state.videosTotal);
    $("videos-page").textContent = first + "–" + last + " / " + state.videosTotal;
    $("videos-previous").disabled = state.videosPage === 0;
    $("videos-next").disabled = (state.videosPage + 1) * PAGE_SIZE >= state.videosTotal;
    $("select-all-videos").checked = false;
    updateSelectedCount();
  }

  function updateSelectedCount() {
    $("selected-video-count").textContent = "已选择 " + state.selectedVideos.size + " 个";
  }

  async function assignSelected() {
    const annotatorId = $("assign-annotator").value;
    if (!annotatorId) return showMessage("请选择标注员。", "error");
    if (!state.selectedVideos.size) return showMessage("请至少选择一个视频。", "error");
    const button = $("assign-selected");
    button.disabled = true;
    button.textContent = "分配中…";
    let created = 0;
    let duplicates = 0;
    const errors = [];
    for (const videoId of state.selectedVideos) {
      const response = await state.client.from("annotation_tasks").insert({
        video_id: videoId,
        annotator_id: annotatorId,
        assigned_by: state.profile.id
      });
      if (!response.error) created += 1;
      else if (response.error.code === "23505") duplicates += 1;
      else errors.push(response.error.message);
    }
    button.disabled = false;
    button.textContent = "分配选中视频";
    showMessage("分配完成：新增 " + created + "，已重复 " + duplicates + (errors.length ? "，失败 " + errors.length + "：" + errors.join("；") : ""), errors.length ? "error" : "success", errors.length > 0);
    await refreshDashboard();
  }

  async function archiveVideo(videoId) {
    const response = await state.client.from("videos").update({ status: "archived" }).eq("id", videoId);
    if (response.error) throw new Error("视频归档失败：" + response.error.message);
    showMessage("视频已归档；Storage 对象和历史任务均保留。", "success");
    await loadVideos();
  }

  async function deleteVideo(videoId) {
    const video = state.videos.find((item) => item.id === videoId);
    if (!video) return;
    if (Number(video.assigned_count) > 0) {
      showMessage("该视频存在 annotation tasks，请先归档。", "error", true);
      return;
    }
    if (!window.confirm("确定永久删除未分配视频“" + video.original_filename + "”及其 Storage 对象吗？")) return;
    const databaseResponse = await state.client.rpc("delete_unassigned_video", { p_video_id: video.id });
    if (databaseResponse.error) throw new Error("数据库拒绝删除（视频可能刚被分配）：" + databaseResponse.error.message);
    const storagePath = databaseResponse.data || video.storage_path;
    const storageResponse = await state.client.storage.from(namespace.Cloud.getVideoBucket()).remove([storagePath]);
    if (storageResponse.error) {
      throw new Error("数据库记录已安全删除，但 Storage 对象清理失败；请在 Storage 中手动删除：" + storagePath + "。" + storageResponse.error.message);
    }
    showMessage("未分配视频已永久删除。", "success");
    await refreshDashboard();
  }

  function templateFields(type) {
    return {
      id: $(type + "-template-id"), code: $(type + "-template-code"), category: $(type + "-template-category"),
      name: $(type + "-template-name"), text: $(type + "-template-text"), sort: $(type + "-template-sort"),
      enabled: $(type + "-template-enabled"), form: $(type + "-template-form"), list: $(type + "-template-list")
    };
  }

  function tableForTemplate(type) {
    return type === "query" ? "query_templates" : "text_templates";
  }

  async function loadTemplates(type) {
    const response = await state.client.from(tableForTemplate(type)).select("*").order("sort_order").order("name");
    if (response.error) throw new Error(type + " 模板加载失败：" + response.error.message);
    state.templates[type] = response.data || [];
    renderTemplates(type);
  }

  function renderTemplates(type) {
    const fields = templateFields(type);
    fields.list.textContent = "";
    state.templates[type].forEach((template) => {
      const item = document.createElement("article");
      item.className = "template-item" + (template.enabled ? "" : " disabled");
      const heading = document.createElement("h3");
      heading.textContent = (template.code ? "[" + template.code + "] " : "") + template.name;
      const category = document.createElement("span");
      category.className = "field-help";
      category.textContent = (template.category || "未分类") + " · sort " + template.sort_order + " · " + (template.enabled ? "Enabled" : "Disabled");
      const text = document.createElement("p");
      text.textContent = template.text;
      const actions = document.createElement("div");
      actions.className = "button-row";
      actions.append(
        actionButton("编辑", "edit-template", template.id),
        actionButton(template.enabled ? "禁用" : "启用", "toggle-template", template.id),
        actionButton("删除", "delete-template", template.id, "button small danger-ghost")
      );
      item.append(heading, category, text, actions);
      fields.list.appendChild(item);
    });
    if (!state.templates[type].length) fields.list.innerHTML = '<div class="empty-state">暂无模板</div>';
  }

  function clearTemplateForm(type) {
    const fields = templateFields(type);
    fields.form.reset();
    fields.id.value = "";
    fields.sort.value = "0";
    fields.enabled.checked = true;
  }

  function editTemplate(type, id) {
    const template = state.templates[type].find((item) => item.id === id);
    if (!template) return;
    const fields = templateFields(type);
    fields.id.value = template.id;
    fields.code.value = template.code || "";
    fields.category.value = template.category || "";
    fields.name.value = template.name;
    fields.text.value = template.text;
    fields.sort.value = template.sort_order;
    fields.enabled.checked = template.enabled;
    fields.name.focus();
  }

  async function saveTemplate(type) {
    const fields = templateFields(type);
    const payload = {
      code: fields.code.value.trim() || null,
      category: fields.category.value.trim() || null,
      name: fields.name.value.trim(),
      text: fields.text.value.trim(),
      sort_order: Number(fields.sort.value) || 0,
      enabled: fields.enabled.checked
    };
    if (!payload.name || !payload.text) throw new Error("模板 Name 和 Text 不能为空。");
    let response;
    if (fields.id.value) response = await state.client.from(tableForTemplate(type)).update(payload).eq("id", fields.id.value);
    else response = await state.client.from(tableForTemplate(type)).insert({ ...payload, created_by: state.profile.id });
    if (response.error) throw new Error("模板保存失败：" + response.error.message);
    clearTemplateForm(type);
    await loadTemplates(type);
    showMessage("统一模板已保存，标注员刷新后可见。", "success");
  }

  async function templateAction(type, action, id) {
    const template = state.templates[type].find((item) => item.id === id);
    if (!template) return;
    if (action === "edit-template") return editTemplate(type, id);
    if (action === "toggle-template") {
      const response = await state.client.from(tableForTemplate(type)).update({ enabled: !template.enabled }).eq("id", id);
      if (response.error) throw new Error("模板状态更新失败：" + response.error.message);
    } else {
      if (!window.confirm("确定删除统一模板“" + template.name + "”吗？")) return;
      const response = await state.client.from(tableForTemplate(type)).delete().eq("id", id);
      if (response.error) throw new Error("模板删除失败：" + response.error.message);
    }
    await loadTemplates(type);
  }

  async function loadAnnotations() {
    const body = $("annotations-body");
    body.innerHTML = '<tr><td colspan="7">Loading annotations…</td></tr>';
    const response = await state.client.from("annotations").select(
      "id,task_id,payload,status,updated_at," +
      "task:annotation_tasks!inner(id,status,video:videos!inner(id,dataset,category,original_filename,storage_path))," +
      "annotator:profiles!annotations_annotator_id_fkey(annotator_code,display_name)",
      { count: "exact" }
    ).in("status", ["submitted", "reviewed"]).order("updated_at", { ascending: false })
      .range(state.annotationsPage * PAGE_SIZE, state.annotationsPage * PAGE_SIZE + PAGE_SIZE - 1);
    if (response.error) throw new Error("标注结果加载失败：" + response.error.message);
    state.annotations = (response.data || []).map((item) => ({
      ...item, task: one(item.task) || {}, annotator: one(item.annotator) || {}
    }));
    state.annotationsTotal = response.count || 0;
    renderAnnotations();
  }

  function renderAnnotations() {
    const body = $("annotations-body");
    body.textContent = "";
    state.annotations.forEach((annotation) => {
      const video = one(annotation.task.video) || {};
      const row = body.insertRow();
      textCell(row, annotation.task_id.slice(0, 8), "mono").title = annotation.task_id;
      textCell(row, (annotation.annotator.annotator_code || "--") + " " + (annotation.annotator.display_name || ""));
      textCell(row, video.original_filename);
      textCell(row, video.dataset);
      const statusCell = row.insertCell();
      const pill = document.createElement("span");
      pill.className = "status-pill " + annotation.status;
      pill.textContent = annotation.status;
      statusCell.appendChild(pill);
      textCell(row, formatDate(annotation.updated_at));
      const actions = row.insertCell();
      actions.append(actionButton("查看", "view-annotation", annotation.id));
      actions.append(document.createTextNode(" "));
      actions.append(actionButton("Reset Task", "reset-task", annotation.task_id));
    });
    if (!state.annotations.length) body.innerHTML = '<tr><td colspan="7">暂无已提交标注</td></tr>';
    const first = state.annotationsTotal ? state.annotationsPage * PAGE_SIZE + 1 : 0;
    const last = Math.min((state.annotationsPage + 1) * PAGE_SIZE, state.annotationsTotal);
    $("annotations-page").textContent = first + "–" + last + " / " + state.annotationsTotal;
    $("annotations-previous").disabled = state.annotationsPage === 0;
    $("annotations-next").disabled = (state.annotationsPage + 1) * PAGE_SIZE >= state.annotationsTotal;
  }

  function viewAnnotation(id) {
    const record = state.annotations.find((item) => item.id === id);
    if (!record) return;
    const video = one(record.task.video) || {};
    $("detail-meta").textContent = (record.annotator.annotator_code || "--") + " / " +
      (record.annotator.display_name || "") + " · " + (video.dataset || "--") + " · " + (video.original_filename || "--");
    const list = $("detail-annotations");
    list.textContent = "";
    const query = document.createElement("p");
    query.textContent = "Query: " + record.payload.query;
    list.appendChild(query);
    (record.payload.annotation || []).forEach((item, index) => {
      const box = document.createElement("div");
      box.className = "detail-annotation";
      const heading = document.createElement("strong");
      heading.textContent = "Annotation #" + (index + 1) + " · " +
        Number(item.time_window_sec.start).toFixed(2) + " → " + Number(item.time_window_sec.end).toFixed(2) + " s";
      const text = document.createElement("p");
      text.textContent = item.text;
      box.append(heading, text);
      list.appendChild(box);
    });
    $("detail-json").textContent = JSON.stringify(record.payload, null, 2);
    $("annotation-dialog").showModal();
  }

  async function resetTask(taskId) {
    if (!window.confirm("将该任务重置为 in_progress，并保留现有 annotation 内容？")) return;
    const response = await state.client.rpc("reset_annotation_task", { p_task_id: taskId });
    if (response.error) throw new Error("Reset Task 失败：" + response.error.message);
    showMessage("任务已重置，原 annotation 已保留为 draft。", "success");
    await refreshDashboard();
  }

  async function refreshDashboard() {
    try {
      await Promise.all([loadMetrics(), loadProgressAndAnnotators(), loadVideos(), loadAnnotations()]);
    } catch (error) {
      showMessage(error.message, "error", true);
    }
  }

  function bindEvents() {
    $("admin-logout").addEventListener("click", async () => {
      try { await namespace.Auth.signOut(); window.location.replace("./login.html"); }
      catch (error) { showMessage("退出登录失败：" + error.message, "error", true); }
    });
    $("refresh-dashboard").addEventListener("click", (event) => runButtonAction(event.currentTarget, refreshDashboard));
    $("filter-videos").addEventListener("click", (event) => runButtonAction(event.currentTarget, async () => { state.videosPage = 0; await loadVideos(); }));
    $("videos-previous").addEventListener("click", (event) => runButtonAction(event.currentTarget, async () => { if (state.videosPage > 0) { state.videosPage -= 1; await loadVideos(); } }));
    $("videos-next").addEventListener("click", (event) => runButtonAction(event.currentTarget, async () => { if ((state.videosPage + 1) * PAGE_SIZE < state.videosTotal) { state.videosPage += 1; await loadVideos(); } }));
    $("select-all-videos").addEventListener("change", (event) => {
      state.selectedVideos.clear();
      if (event.target.checked) state.videos.filter((item) => item.status !== "archived").forEach((item) => state.selectedVideos.add(item.id));
      renderVideos();
    });
    $("videos-body").addEventListener("change", (event) => {
      const checkbox = event.target.closest("input[data-video-id]");
      if (!checkbox) return;
      if (checkbox.checked) state.selectedVideos.add(checkbox.dataset.videoId);
      else state.selectedVideos.delete(checkbox.dataset.videoId);
      updateSelectedCount();
    });
    $("videos-body").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      runButtonAction(button, () => button.dataset.action === "archive" ? archiveVideo(button.dataset.id) : deleteVideo(button.dataset.id));
    });
    $("assign-selected").addEventListener("click", () => assignSelected().catch((error) => showMessage(error.message, "error", true)));

    ["query", "text"].forEach((type) => {
      const fields = templateFields(type);
      fields.form.addEventListener("submit", (event) => {
        event.preventDefault();
        runButtonAction(event.submitter || fields.form.querySelector('button[type="submit"]'), () => saveTemplate(type));
      });
      fields.list.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (button) runButtonAction(button, () => templateAction(type, button.dataset.action, button.dataset.id));
      });
      document.querySelector('[data-clear-template="' + type + '"]').addEventListener("click", () => clearTemplateForm(type));
    });

    $("annotations-body").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      if (button.dataset.action === "view-annotation") viewAnnotation(button.dataset.id);
      else runButtonAction(button, () => resetTask(button.dataset.id));
    });
    $("annotations-previous").addEventListener("click", (event) => runButtonAction(event.currentTarget, async () => { if (state.annotationsPage > 0) { state.annotationsPage -= 1; await loadAnnotations(); } }));
    $("annotations-next").addEventListener("click", (event) => runButtonAction(event.currentTarget, async () => { if ((state.annotationsPage + 1) * PAGE_SIZE < state.annotationsTotal) { state.annotationsPage += 1; await loadAnnotations(); } }));
    $("close-detail").addEventListener("click", () => $("annotation-dialog").close());

    const exporter = new namespace.AdminExportService(state.client);
    $("export-all-json").addEventListener("click", async (event) => {
      event.target.disabled = true;
      try { const count = await exporter.exportJson(); showMessage("已导出 " + count + " 条标准 JSON payload。", "success"); }
      catch (error) { showMessage(error.message, "error", true); }
      finally { event.target.disabled = false; }
    });
    $("export-manifest-csv").addEventListener("click", async (event) => {
      event.target.disabled = true;
      try { const count = await exporter.exportManifest(); showMessage("已导出 " + count + " 条 manifest 记录。", "success"); }
      catch (error) { showMessage(error.message, "error", true); }
      finally { event.target.disabled = false; }
    });
  }

  async function initialize() {
    if (!namespace.Cloud.isConfigured()) {
      showMessage("Supabase 尚未配置。请先填写 js/supabase-config.js。", "info", true);
      document.querySelectorAll("button, input, select, textarea").forEach((element) => { element.disabled = true; });
      return;
    }
    state.client = namespace.Cloud.getClient();
    try {
      const identity = await namespace.Auth.requireProfile(["admin"]);
      if (!identity) { window.location.replace("./login.html?next=admin.html"); return; }
      state.profile = identity.profile;
      $("admin-profile").textContent = identity.profile.annotator_code + " / " + (identity.profile.display_name || "Admin");
      bindEvents();
      await Promise.all([loadTemplates("query"), loadTemplates("text"), refreshDashboard()]);
    } catch (error) {
      if (error.code === "FORBIDDEN") {
        showMessage("无权限：该页面仅限管理员。即将返回标注页面。", "error", true);
        window.setTimeout(() => window.location.replace("./index.html?mode=online"), 1800);
      } else showMessage(error.message || "Admin 初始化失败。", "error", true);
    }
  }

  initialize();
})(window.FitInteract = window.FitInteract || {});
