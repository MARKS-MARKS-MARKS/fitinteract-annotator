(function (namespace) {
  "use strict";

  function normalizeQueryArray(query) {
    if (typeof namespace.normalizeQueries === "function") return namespace.normalizeQueries(query).queries;
    if (typeof query === "string") {
      return query.trim() ? [{ start_time_sec: 0, text: query.trim() }] : [];
    }
    return (Array.isArray(query) ? query : []).map((item) => ({
      start_time_sec: namespace.roundTime(item.start_time_sec),
      text: String(item.text || "").trim()
    })).sort((left, right) => left.start_time_sec - right.start_time_sec);
  }

  function buildAnnotationData(videoPath, query, annotations) {
    return {
      video_path: String(videoPath || "").trim(),
      query: normalizeQueryArray(query),
      annotation: (Array.isArray(annotations) ? annotations : []).map((item) => ({
        time_window_sec: {
          start: namespace.roundTime(item.time_window_sec.start),
          end: namespace.roundTime(item.time_window_sec.end)
        },
        action: typeof item.action === "string" ? item.action.trim() : "",
        text: String(item.text || "").trim()
      }))
    };
  }

  function validateAnnotationData(data, videoDuration) {
    const errors = [];
    const duration = Number(videoDuration);
    const hasDuration = Number.isFinite(duration) && duration > 0;
    if (!data.video_path) errors.push("Video Path 不能为空。");
    if (!Array.isArray(data.query) || data.query.length === 0) {
      errors.push("至少需要一条 Query。");
    } else {
      data.query.forEach((item, index) => {
        const prefix = "Query #" + (index + 1) + "：";
        if (!item || typeof item !== "object") {
          errors.push(prefix + "格式无效。");
          return;
        }
        const start = item.start_time_sec;
        if (!Number.isFinite(start) || start < 0) errors.push(prefix + "start_time_sec 必须是大于等于 0 的数字。");
        else if (hasDuration && start > duration + 0.005) errors.push(prefix + "start_time_sec 不能超过视频时长。");
        if (!String(item.text || "").trim()) errors.push(prefix + "Text 不能为空。");
      });
    }
    if (!Array.isArray(data.annotation) || data.annotation.length === 0) {
      errors.push("至少需要一条 annotation。");
    } else {
      data.annotation.forEach((item, index) => {
        const prefix = "Annotation #" + (index + 1) + "：";
        if (!item || !item.time_window_sec) {
          errors.push(prefix + "缺少 time_window_sec。");
          return;
        }
        const start = item.time_window_sec.start;
        const end = item.time_window_sec.end;
        if (!Number.isFinite(start) || !Number.isFinite(end)) errors.push(prefix + "Start / End 无效。");
        else if (start < 0 || end <= start) errors.push(prefix + "必须满足 0 ≤ Start < End。");
        else if (hasDuration && end > duration + 0.005) errors.push(prefix + "End 不能超过视频时长。");
        if (typeof item.action !== "string" || !item.action.trim()) errors.push("Annotation #" + (index + 1) + " 缺少 Action。");
        if (!String(item.text || "").trim()) errors.push(prefix + "Text 不能为空。");
      });
    }
    return errors;
  }

  function normalizeJsonFilename(filename) {
    let safeName = String(filename || "").trim() || "fitinteract_annotation.json";
    safeName = safeName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
    if (!safeName.toLowerCase().endsWith(".json")) safeName += ".json";
    return safeName;
  }

  function downloadJson(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = normalizeJsonFilename(filename);
    link.style.display = "none";
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  }

  namespace.buildAnnotationData = buildAnnotationData;
  namespace.validateAnnotationData = validateAnnotationData;
  namespace.normalizeJsonFilename = normalizeJsonFilename;
  namespace.downloadJson = downloadJson;
})(window.FitInteract = window.FitInteract || {});
