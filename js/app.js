(function (namespace) {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const elements = {
    message: $("message-area"),
    draftBanner: $("draft-banner"),
    restoreDraft: $("restore-draft-button"),
    discardDraft: $("discard-draft-button"),
    newTask: $("new-task-button"),
    videoFile: $("video-file"),
    videoFileName: $("video-file-name"),
    videoStage: document.querySelector(".video-stage"),
    video: $("video-player"),
    playbackRate: $("playback-rate"),
    currentTime: $("current-time"),
    durationTime: $("duration-time"),
    videoRootSelect: $("video-root-select"),
    videoRootName: $("video-root-name"),
    videoRootPath: $("video-root-path"),
    addRoot: $("add-root-button"),
    updateRoot: $("update-root-button"),
    deleteRoot: $("delete-root-button"),
    videoPath: $("video-path"),
    videoPathHistory: $("video-path-history"),
    queryText: $("query-text"),
    annotationText: $("annotation-text"),
    startInput: $("start-input"),
    endInput: $("end-input"),
    windowDuration: $("window-duration"),
    setStart: $("set-start-button"),
    setEnd: $("set-end-button"),
    clearWindow: $("clear-window-button"),
    playRange: $("play-range-button"),
    saveAnnotation: $("save-annotation-button"),
    cancelEdit: $("cancel-edit-button"),
    annotationList: $("annotation-list"),
    annotationsTitle: $("annotations-title"),
    jsonPreview: $("json-preview"),
    jsonFilename: $("json-filename"),
    downloadJson: $("download-json-button"),
    timelineViewport: $("timeline-viewport"),
    timelineContent: $("timeline-content"),
    timelineTicks: $("timeline-ticks"),
    timelineTrack: $("timeline-track"),
    timelineSelection: $("timeline-selection"),
    timelineProgress: $("timeline-progress"),
    startHandle: $("start-handle"),
    endHandle: $("end-handle"),
    playhead: $("playhead"),
    timelineEndLabel: $("timeline-end-label"),
    modeAnnotate: $("mode-annotate"),
    modeSeek: $("mode-seek"),
    timelineModeStatus: $("timeline-mode-status"),
    zoomLevels: Array.from(document.querySelectorAll("#zoom-levels [data-zoom]")),
    zoomIn: $("zoom-in"),
    zoomOut: $("zoom-out")
  };

  let messageTimer = null;
  let draftTimer = null;
  let dirty = false;
  let suppressDraft = false;
  let currentFileName = "";
  let activeMode = "offline";
  let onlineDirtyHandler = null;

  function showMessage(message, type, sticky) {
    window.clearTimeout(messageTimer);
    elements.message.textContent = message;
    elements.message.className = "message " + (type || "info");
    if (!sticky) {
      messageTimer = window.setTimeout(() => elements.message.classList.add("hidden"), 5000);
    }
  }

  function clearMessage() {
    window.clearTimeout(messageTimer);
    elements.message.className = "message hidden";
    elements.message.textContent = "";
  }

  const storage = new namespace.StorageService((message) => showMessage(message, "error", true));
  const queryPresets = new namespace.PresetCollection(
    storage, namespace.STORAGE_KEYS.queryPresets, namespace.PRESET_DEFAULTS.queryPresets, "query"
  );
  const textPresets = new namespace.PresetCollection(
    storage, namespace.STORAGE_KEYS.textPresets, namespace.PRESET_DEFAULTS.textPresets, "text"
  );
  const videoRoots = new namespace.PresetCollection(
    storage, namespace.STORAGE_KEYS.videoRoots, namespace.PRESET_DEFAULTS.videoRoots, "root"
  );
  let settings = storage.read(namespace.STORAGE_KEYS.settings, {
    version: 1,
    lastVideoRootId: "",
    timelineZoom: 1,
    playbackRate: 1
  });
  let videoPathHistory = storage.read(namespace.STORAGE_KEYS.videoPathHistory, []);
  if (!Array.isArray(videoPathHistory)) videoPathHistory = [];

  function saveSettings() {
    storage.write(namespace.STORAGE_KEYS.settings, settings);
  }

  function formatSeconds(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    const parts = number.toFixed(2).split(".");
    parts[0] = parts[0].padStart(2, "0");
    return parts.join(".");
  }

  function baseName(filename) {
    const lastDot = filename.lastIndexOf(".");
    return lastDot > 0 ? filename.slice(0, lastDot) : filename;
  }

  function joinPath(root, filename) {
    const cleanRoot = String(root || "").trim();
    if (!cleanRoot) return filename;
    const separator = cleanRoot.includes("\\") ? "\\" : "/";
    return cleanRoot.replace(/[\\/]+$/, "") + separator + filename;
  }

  function addVideoPathHistory(path) {
    const cleanPath = String(path || "").trim();
    if (!cleanPath) return;
    videoPathHistory = [cleanPath].concat(videoPathHistory.filter((item) => item !== cleanPath)).slice(0, 30);
    storage.write(namespace.STORAGE_KEYS.videoPathHistory, videoPathHistory);
    renderVideoPathHistory();
  }

  function renderVideoPathHistory() {
    elements.videoPathHistory.textContent = "";
    videoPathHistory.forEach((path) => {
      const option = document.createElement("option");
      option.value = path;
      elements.videoPathHistory.appendChild(option);
    });
  }

  const timeline = new namespace.TimelineController({
    viewport: elements.timelineViewport,
    content: elements.timelineContent,
    ticks: elements.timelineTicks,
    track: elements.timelineTrack,
    selection: elements.timelineSelection,
    progress: elements.timelineProgress,
    startHandle: elements.startHandle,
    endHandle: elements.endHandle,
    playhead: elements.playhead,
    endLabel: elements.timelineEndLabel,
    annotateButton: elements.modeAnnotate,
    seekButton: elements.modeSeek,
    modeStatus: elements.timelineModeStatus,
    zoomButtons: elements.zoomLevels
  }, {
    onSeek: (time) => {
      if (!video.seek(time)) showMessage("请先选择并加载本地视频。", "error");
    },
    onSelection: (selection) => updateWindowInputs(selection),
    onError: (message) => showMessage(message, "error")
  });

  const video = new namespace.VideoController(elements.video, {
    onFile: (file) => {
      currentFileName = file.name;
      elements.videoFileName.textContent = file.name;
      elements.videoStage.classList.add("has-video");
      elements.jsonFilename.value = baseName(file.name) + ".json";
      const selectedRoot = videoRoots.find(elements.videoRootSelect.value);
      elements.videoPath.value = selectedRoot ? joinPath(selectedRoot.value, file.name) : file.name;
      addVideoPathHistory(elements.videoPath.value);
      timeline.setDuration(0);
      updatePreview();
      markDirty();
      showMessage("已在浏览器本地加载视频：" + file.name, "success");
    },
    onDuration: (duration) => {
      elements.durationTime.textContent = formatSeconds(duration) + " s";
      elements.endInput.max = String(duration);
      elements.startInput.max = String(duration);
      timeline.setDuration(duration);
    },
    onTime: (time) => {
      elements.currentTime.textContent = formatSeconds(time) + " s";
      timeline.setCurrentTime(time);
    },
    onError: (message) => showMessage(message, "error", true)
  });

  const annotations = new namespace.AnnotationManager({
    list: elements.annotationList,
    title: elements.annotationsTitle
  }, {
    onPlay: (annotation) => playAnnotation(annotation),
    onEdit: (annotation) => {
      timeline.setSelection(annotation.time_window_sec.start, annotation.time_window_sec.end);
      elements.annotationText.value = annotation.text;
      elements.saveAnnotation.textContent = "更新 Annotation";
      elements.cancelEdit.classList.remove("hidden");
      elements.annotationText.focus();
    },
    onEditState: (annotation) => {
      if (!annotation) {
        elements.saveAnnotation.textContent = "+ 添加 Annotation";
        elements.cancelEdit.classList.add("hidden");
      }
    },
    onChange: () => {
      updatePreview();
      markDirty();
    }
  });

  function updateWindowInputs(selection) {
    elements.startInput.value = selection.start === null ? "" : namespace.roundTime(selection.start).toFixed(2);
    elements.endInput.value = selection.end === null ? "" : namespace.roundTime(selection.end).toFixed(2);
    if (selection.start !== null && selection.end !== null && selection.end > selection.start) {
      elements.windowDuration.textContent = formatSeconds(selection.end - selection.start) + " s";
    } else {
      elements.windowDuration.textContent = "-- s";
    }
  }

  function currentData() {
    return namespace.buildAnnotationData(elements.videoPath.value, elements.queryText.value, annotations.getAll());
  }

  function updatePreview() {
    elements.jsonPreview.textContent = JSON.stringify(currentData(), null, 2);
  }

  function markDirty() {
    if (suppressDraft) return;
    dirty = true;
    if (activeMode === "online") {
      if (typeof onlineDirtyHandler === "function") onlineDirtyHandler();
      return;
    }
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(saveDraft, 250);
  }

  function saveDraft() {
    if (suppressDraft || activeMode !== "offline") return;
    const data = currentData();
    const hasContent = Boolean(data.video_path || data.query || data.annotation.length);
    if (!hasContent) {
      storage.remove(namespace.STORAGE_KEYS.draft);
      return;
    }
    storage.write(namespace.STORAGE_KEYS.draft, {
      version: 1,
      savedAt: new Date().toISOString(),
      videoFileName: currentFileName,
      jsonFilename: elements.jsonFilename.value,
      data: data
    });
  }

  function loadDraftPrompt() {
    if (activeMode !== "offline") return;
    const draft = storage.read(namespace.STORAGE_KEYS.draft, null);
    if (!draft || !draft.data || typeof draft.data !== "object") return;
    elements.draftBanner.classList.remove("hidden");
    elements.restoreDraft.onclick = () => {
      suppressDraft = true;
      elements.videoPath.value = String(draft.data.video_path || "");
      elements.queryText.value = String(draft.data.query || "");
      annotations.replaceAll(draft.data.annotation || []);
      elements.jsonFilename.value = draft.jsonFilename || "fitinteract_annotation.json";
      if (draft.videoFileName) {
        elements.videoFileName.textContent = "需重新选择：" + draft.videoFileName;
        currentFileName = draft.videoFileName;
      }
      suppressDraft = false;
      dirty = true;
      updatePreview();
      elements.draftBanner.classList.add("hidden");
      showMessage("草稿已恢复。出于浏览器安全限制，请重新选择本地视频文件。", "info", true);
    };
    elements.discardDraft.onclick = () => {
      storage.remove(namespace.STORAGE_KEYS.draft);
      elements.draftBanner.classList.add("hidden");
      showMessage("已放弃上次草稿。", "info");
    };
  }

  function renderRoots(selectedId) {
    namespace.populatePresetSelect(elements.videoRootSelect, videoRoots.all(), "不使用 Video Root");
    const target = selectedId || settings.lastVideoRootId;
    if (target && videoRoots.find(target)) elements.videoRootSelect.value = target;
    loadSelectedRoot();
  }

  function loadSelectedRoot() {
    const root = videoRoots.find(elements.videoRootSelect.value);
    elements.videoRootName.value = root ? root.name : "";
    elements.videoRootPath.value = root ? root.value : "";
    settings.lastVideoRootId = root ? root.id : "";
    saveSettings();
    if (root && currentFileName && video.hasVideo()) {
      elements.videoPath.value = joinPath(root.value, currentFileName);
      addVideoPathHistory(elements.videoPath.value);
      updatePreview();
      markDirty();
    }
  }

  function rootAction(action) {
    try {
      if (action === "add") {
        const item = videoRoots.add(elements.videoRootName.value, elements.videoRootPath.value);
        renderRoots(item.id);
        showMessage("Video Root 模板已新增。", "success");
      } else if (action === "update") {
        const item = videoRoots.update(elements.videoRootSelect.value, elements.videoRootName.value, elements.videoRootPath.value);
        renderRoots(item.id);
        showMessage("Video Root 模板已更新。", "success");
      } else {
        const root = videoRoots.find(elements.videoRootSelect.value);
        if (!root) throw new Error("请先选择要删除的 Video Root 模板。");
        if (!window.confirm("确定删除 Video Root 模板“" + root.name + "”吗？")) return;
        videoRoots.delete(root.id);
        settings.lastVideoRootId = "";
        renderRoots("");
        showMessage("Video Root 模板已删除。", "success");
      }
    } catch (error) {
      showMessage(error.message, "error");
    }
  }

  function wireTextPreset(config) {
    const render = (selectedId) => {
      namespace.populatePresetSelect(config.select, config.collection.all(), config.placeholder);
      if (selectedId && config.collection.find(selectedId)) config.select.value = selectedId;
    };
    config.select.addEventListener("change", () => {
      const item = config.collection.find(config.select.value);
      config.nameInput.value = item ? item.name : "";
      if (item) config.valueInput.value = item.value;
      if (config.affectsData && item) {
        updatePreview();
        markDirty();
      }
    });
    config.addButton.addEventListener("click", () => {
      try {
        const item = config.collection.add(config.nameInput.value, config.valueInput.value);
        render(item.id);
        showMessage(config.label + "模板已保存。", "success");
      } catch (error) { showMessage(error.message, "error"); }
    });
    config.updateButton.addEventListener("click", () => {
      try {
        const item = config.collection.update(config.select.value, config.nameInput.value, config.valueInput.value);
        render(item.id);
        showMessage(config.label + "模板已更新。", "success");
      } catch (error) { showMessage(error.message, "error"); }
    });
    config.deleteButton.addEventListener("click", () => {
      try {
        const item = config.collection.find(config.select.value);
        if (!item) throw new Error("请先选择要删除的模板。");
        if (!window.confirm("确定删除模板“" + item.name + "”吗？")) return;
        config.collection.delete(item.id);
        config.nameInput.value = "";
        config.select.value = "";
        render();
        showMessage(config.label + "模板已删除。", "success");
      } catch (error) { showMessage(error.message, "error"); }
    });
    render();
    return render;
  }

  function setInitialExamples() {
    const firstQuery = queryPresets.all()[0];
    const firstText = textPresets.all()[0];
    if (firstQuery) {
      $("query-preset-select").value = firstQuery.id;
      $("query-preset-name").value = firstQuery.name;
      elements.queryText.value = firstQuery.value;
    }
    if (firstText) {
      $("text-preset-select").value = firstText.id;
      $("text-preset-name").value = firstText.name;
      elements.annotationText.value = firstText.value;
    }
  }

  function updateTimelineZoom(zoom) {
    const allowed = [1, 2, 4, 8];
    const value = allowed.includes(Number(zoom)) ? Number(zoom) : 1;
    timeline.setZoom(value);
    settings.timelineZoom = value;
    saveSettings();
  }

  function playAnnotation(annotation) {
    video.playRange(annotation.time_window_sec.start, annotation.time_window_sec.end)
      .catch((error) => showMessage(error.message || "无法播放所选区间。", "error"));
  }

  function saveCurrentAnnotation() {
    const selection = timeline.getSelection();
    if (selection.start === null || selection.end === null) {
      showMessage("请先设置有效的 Start 和 End。", "error");
      return;
    }
    const wasEditing = annotations.isEditing();
    const result = annotations.save(
      selection.start,
      selection.end,
      elements.annotationText.value,
      video.duration
    );
    if (!result.ok) {
      showMessage(result.errors.join("\n"), "error", true);
      return;
    }
    timeline.clearSelection();
    elements.annotationText.value = "";
    showMessage(wasEditing ? "Annotation 已更新。" : "Annotation 已保存。", "success");
  }

  function downloadCurrentJson() {
    clearMessage();
    const data = currentData();
    const errors = namespace.validateAnnotationData(data);
    if (errors.length) {
      showMessage("下载前校验未通过：\n" + errors.map((item) => "• " + item).join("\n"), "error", true);
      return false;
    }
    try {
      const filename = namespace.normalizeJsonFilename(elements.jsonFilename.value);
      elements.jsonFilename.value = filename;
      namespace.downloadJson(data, filename);
      addVideoPathHistory(data.video_path);
      if (activeMode === "offline") {
        dirty = false;
        storage.remove(namespace.STORAGE_KEYS.draft);
      }
      showMessage("JSON 已生成并交给浏览器下载。", "success");
      return true;
    } catch (error) {
      showMessage("JSON 下载失败：" + (error.message || "浏览器阻止了下载。"), "error", true);
      return false;
    }
  }

  function resetTask() {
    if (dirty && !window.confirm("当前标注可能尚未下载。确定新建标注并清空当前内容吗？")) return;
    suppressDraft = true;
    video.clearSource();
    currentFileName = "";
    elements.videoFile.value = "";
    elements.videoFileName.textContent = "尚未选择";
    elements.videoStage.classList.remove("has-video");
    elements.videoPath.value = "";
    elements.queryText.value = "";
    elements.annotationText.value = "";
    elements.jsonFilename.value = "fitinteract_annotation.json";
    elements.currentTime.textContent = "00.00 s";
    elements.durationTime.textContent = "00.00 s";
    annotations.clear();
    timeline.setDuration(0);
    storage.remove(namespace.STORAGE_KEYS.draft);
    suppressDraft = false;
    dirty = false;
    updatePreview();
    showMessage("已新建空白标注任务，模板设置已保留。", "info");
  }

  function handleFileSelection() {
    const file = elements.videoFile.files && elements.videoFile.files[0];
    if (!file) return;
    if ((video.hasVideo() || annotations.getAll().length) && dirty) {
      const proceed = window.confirm("切换视频会清空当前时间窗口和 annotation 列表，是否继续？");
      if (!proceed) {
        elements.videoFile.value = "";
        return;
      }
      suppressDraft = true;
      annotations.clear();
      timeline.clearSelection();
      elements.annotationText.value = "";
      suppressDraft = false;
    }
    video.loadFile(file);
  }

  function bindEvents() {
    elements.videoFile.addEventListener("change", handleFileSelection);
    elements.videoRootSelect.addEventListener("change", loadSelectedRoot);
    elements.addRoot.addEventListener("click", () => rootAction("add"));
    elements.updateRoot.addEventListener("click", () => rootAction("update"));
    elements.deleteRoot.addEventListener("click", () => rootAction("delete"));

    elements.videoPath.addEventListener("input", () => { updatePreview(); markDirty(); });
    elements.videoPath.addEventListener("change", () => addVideoPathHistory(elements.videoPath.value));
    elements.queryText.addEventListener("input", () => { updatePreview(); markDirty(); });

    elements.playbackRate.addEventListener("change", () => {
      video.setPlaybackRate(elements.playbackRate.value);
      settings.playbackRate = Number(elements.playbackRate.value);
      saveSettings();
    });

    elements.modeAnnotate.addEventListener("click", () => timeline.setMode("annotate"));
    elements.modeSeek.addEventListener("click", () => timeline.setMode("seek"));
    elements.zoomLevels.forEach((button) => button.addEventListener("click", () => updateTimelineZoom(button.dataset.zoom)));
    elements.zoomIn.addEventListener("click", () => {
      const levels = [1, 2, 4, 8];
      updateTimelineZoom(levels[Math.min(levels.length - 1, levels.indexOf(timeline.zoom) + 1)]);
    });
    elements.zoomOut.addEventListener("click", () => {
      const levels = [1, 2, 4, 8];
      updateTimelineZoom(levels[Math.max(0, levels.indexOf(timeline.zoom) - 1)]);
    });

    elements.setStart.addEventListener("click", () => {
      if (!timeline.setStart(video.getCurrentTime())) showMessage("请先选择本地视频。", "error");
    });
    elements.setEnd.addEventListener("click", () => {
      if (!timeline.setEnd(video.getCurrentTime())) showMessage("请先选择本地视频。", "error");
    });
    elements.clearWindow.addEventListener("click", () => timeline.clearSelection());
    elements.playRange.addEventListener("click", () => {
      const selection = timeline.getSelection();
      video.playRange(selection.start, selection.end)
        .catch((error) => showMessage(error.message || "无法播放所选区间。", "error"));
    });

    elements.startInput.addEventListener("change", () => {
      if (!elements.startInput.value) {
        timeline.setSelection(null, timeline.getSelection().end);
        return;
      }
      if (!timeline.setStart(Number(elements.startInput.value))) showMessage("请先选择本地视频。", "error");
    });
    elements.endInput.addEventListener("change", () => {
      if (!elements.endInput.value) {
        timeline.setSelection(timeline.getSelection().start, null);
        return;
      }
      if (!timeline.setEnd(Number(elements.endInput.value))) showMessage("请先选择本地视频。", "error");
    });

    document.querySelectorAll("[data-nudge]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!video.nudge(Number(button.dataset.nudge))) showMessage("请先选择本地视频。", "error");
      });
    });

    elements.saveAnnotation.addEventListener("click", saveCurrentAnnotation);
    elements.cancelEdit.addEventListener("click", () => {
      annotations.cancelEdit();
      timeline.clearSelection();
      elements.annotationText.value = "";
    });
    elements.downloadJson.addEventListener("click", downloadCurrentJson);
    elements.newTask.addEventListener("click", resetTask);

    window.addEventListener("beforeunload", () => {
      window.clearTimeout(draftTimer);
      if (dirty && activeMode === "offline") saveDraft();
      video.stopClock();
      if (video.objectUrl) URL.revokeObjectURL(video.objectUrl);
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const editing = target && (target.matches("input, textarea, select, button") || target.isContentEditable);
      if (editing) return;
      const key = event.key.toLowerCase();
      if (key === " " || key === "spacebar") {
        event.preventDefault();
        video.togglePlayback().catch((error) => showMessage(error.message, "error"));
      } else if (key === "s" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        elements.setStart.click();
      } else if (key === "e") {
        event.preventDefault();
        elements.setEnd.click();
      } else if (key === "a") {
        event.preventDefault();
        saveCurrentAnnotation();
      } else if (key === "r") {
        event.preventDefault();
        elements.playRange.click();
      } else if (key === "delete") {
        event.preventDefault();
        annotations.deleteSelected();
      } else if (key === "arrowleft" || key === "arrowright") {
        event.preventDefault();
        const direction = key === "arrowleft" ? -1 : 1;
        const amount = event.shiftKey ? 0.1 : 0.01;
        if (!video.nudge(direction * amount)) showMessage("请先选择本地视频。", "error");
      } else if ((event.ctrlKey || event.metaKey) && key === "s") {
        event.preventDefault();
        downloadCurrentJson();
      }
    });
  }

  function enterOnlineMode() {
    activeMode = "online";
    suppressDraft = true;
    document.body.classList.add("online-mode");
    elements.draftBanner.classList.add("hidden");
    elements.videoPath.readOnly = true;
    $("mode-badge").textContent = "Online Collaborative Mode";
    $("online-task-panel").classList.remove("hidden");
    $("online-profile").classList.remove("hidden");
    $("offline-mode-link").classList.remove("hidden");
    $("logout-button").classList.remove("hidden");
    $("online-save-draft").classList.remove("hidden");
    $("online-submit").classList.remove("hidden");
    $("online-next-incomplete").classList.remove("hidden");
    $("online-save-state").classList.remove("hidden");
    $("setup-title").textContent = "在线任务与标注信息";
    $("setup-description").textContent = "Video Path 自动来自 videos.storage_path，统一模板来自 Supabase。";
    $("app-footer").textContent = "Online Collaborative Mode · 私有 Storage 视频 · 标注保存到项目数据库 · 不发送到其他第三方服务";
    annotations.clear();
    timeline.setDuration(0);
    elements.queryText.value = "";
    elements.annotationText.value = "";
    elements.videoPath.value = "";
    updatePreview();
    suppressDraft = false;

    const logout = $("logout-button");
    if (!logout.dataset.bound) {
      logout.dataset.bound = "true";
      logout.addEventListener("click", async () => {
        logout.disabled = true;
        try {
          await namespace.Auth.signOut();
          window.location.replace("./login.html");
        } catch (error) {
          showMessage("退出登录失败：" + error.message, "error", true);
          logout.disabled = false;
        }
      });
    }
  }

  function setOnlineProfile(profile) {
    if (profile && profile.role === "admin") $("admin-link").classList.remove("hidden");
  }

  function loadOnlineTask(task, signedUrl, payload) {
    const videoRecord = task.video;
    suppressDraft = true;
    currentFileName = videoRecord.original_filename;
    elements.videoFileName.textContent = videoRecord.original_filename;
    elements.videoStage.classList.add("has-video");
    elements.videoPath.value = videoRecord.storage_path;
    elements.queryText.value = payload && typeof payload.query === "string" ? payload.query : "";
    annotations.replaceAll(payload && Array.isArray(payload.annotation) ? payload.annotation : []);
    elements.annotationText.value = "";
    elements.jsonFilename.value = baseName(videoRecord.original_filename) + "_" + task.id.slice(0, 8) + ".json";
    timeline.setDuration(0);
    video.loadUrl(signedUrl);
    updatePreview();
    dirty = false;
    suppressDraft = false;
  }

  function refreshOnlineVideoUrl(signedUrl) {
    const previousTime = video.getCurrentTime();
    const restorePosition = () => {
      window.clearTimeout(cleanupTimer);
      video.seek(previousTime);
    };
    elements.video.addEventListener("loadedmetadata", restorePosition, { once: true });
    const cleanupTimer = window.setTimeout(() => elements.video.removeEventListener("loadedmetadata", restorePosition), 15000);
    video.loadUrl(signedUrl);
  }

  namespace.AnnotatorApp = Object.freeze({
    enterOnlineMode: enterOnlineMode,
    setOnlineProfile: setOnlineProfile,
    loadOnlineTask: loadOnlineTask,
    refreshOnlineVideoUrl: refreshOnlineVideoUrl,
    getCurrentData: currentData,
    showMessage: showMessage,
    setOnlineDirtyHandler: (handler) => { onlineDirtyHandler = handler; },
    markOnlineSaved: () => { dirty = false; },
    isDirty: () => dirty
  });

  function initialize() {
    wireTextPreset({
      collection: queryPresets,
      select: $("query-preset-select"),
      nameInput: $("query-preset-name"),
      valueInput: elements.queryText,
      addButton: $("save-query-preset"),
      updateButton: $("update-query-preset"),
      deleteButton: $("delete-query-preset"),
      placeholder: "选择 Query 模板",
      label: "Query ",
      affectsData: true
    });
    wireTextPreset({
      collection: textPresets,
      select: $("text-preset-select"),
      nameInput: $("text-preset-name"),
      valueInput: elements.annotationText,
      addButton: $("save-text-preset"),
      updateButton: $("update-text-preset"),
      deleteButton: $("delete-text-preset"),
      placeholder: "选择 Text 模板",
      label: "Text ",
      affectsData: false
    });
    renderRoots();
    renderVideoPathHistory();
    setInitialExamples();
    updateTimelineZoom(settings.timelineZoom);
    const playbackRate = [0.5, 0.75, 1, 1.25, 1.5, 2].includes(Number(settings.playbackRate))
      ? Number(settings.playbackRate) : 1;
    elements.playbackRate.value = String(playbackRate);
    video.setPlaybackRate(playbackRate);
    bindEvents();
    updatePreview();
    dirty = false;
    const onlineRequested = namespace.Cloud && namespace.Cloud.wantsOnlineMode();
    if (onlineRequested && namespace.Cloud.isConfigured()) {
      const controller = new namespace.OnlineTaskController(namespace.AnnotatorApp);
      controller.initialize().catch((error) => {
        showMessage(error.message || "Online Mode 初始化失败。", "error", true);
      });
    } else {
      loadDraftPrompt();
      if (onlineRequested && namespace.Cloud && !namespace.Cloud.isConfigured()) {
        showMessage("Supabase 尚未配置，当前保持 Offline Mode。请填写 js/supabase-config.js 后使用在线协作功能。", "info", true);
      }
    }
  }

  initialize();
})(window.FitInteract = window.FitInteract || {});
