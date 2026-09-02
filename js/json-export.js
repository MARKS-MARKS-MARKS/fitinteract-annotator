(function (namespace) {
  "use strict";

  function buildAnnotationData(videoPath, query, annotations) {
    return {
      video_path: String(videoPath || "").trim(),
      query: String(query || "").trim(),
      annotation: (Array.isArray(annotations) ? annotations : []).map((item) => ({
        time_window_sec: {
          start: namespace.roundTime(item.time_window_sec.start),
          end: namespace.roundTime(item.time_window_sec.end)
        },
        text: String(item.text || "").trim()
      }))
    };
  }

  function validateAnnotationData(data) {
    const errors = [];
    if (!data.video_path) errors.push("Video Path 不能为空。");
    if (!data.query) errors.push("Query 不能为空。");
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
