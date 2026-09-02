(function (namespace) {
  "use strict";

  function one(value) {
    return Array.isArray(value) ? value[0] || null : value || null;
  }

  function safeCsvCell(value) {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function downloadText(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    try { link.click(); }
    finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  class AdminExportService {
    constructor(client) {
      this.client = client;
      this.cache = null;
    }

    async loadSubmitted() {
      const rows = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const response = await this.client.from("annotations").select(
          "task_id,payload,status,updated_at," +
          "task:annotation_tasks!inner(id,video_id,annotator_id,status," +
          "video:videos!inner(id,dataset,category,storage_path,original_filename)," +
          "annotator:profiles!annotation_tasks_annotator_id_fkey(annotator_code,display_name))"
        ).in("status", ["submitted", "reviewed"]).range(from, from + pageSize - 1);
        if (response.error) throw new Error("导出数据加载失败：" + response.error.message);
        rows.push(...(response.data || []));
        if (!response.data || response.data.length < pageSize) break;
        from += pageSize;
      }
      this.cache = rows.map((row) => {
        const task = one(row.task) || {};
        return { ...row, task: task, video: one(task.video) || {}, annotator: one(task.annotator) || {} };
      }).sort((a, b) => {
        const left = [a.video.dataset || "", a.video.storage_path || "", a.annotator.annotator_code || ""].join("\u0000");
        const right = [b.video.dataset || "", b.video.storage_path || "", b.annotator.annotator_code || ""].join("\u0000");
        return left.localeCompare(right);
      });
      return this.cache;
    }

    async exportJson() {
      const rows = await this.loadSubmitted();
      downloadText(JSON.stringify(rows.map((row) => row.payload), null, 2), "all_annotations.json", "application/json");
      return rows.length;
    }

    async exportManifest() {
      const rows = this.cache || await this.loadSubmitted();
      const headers = ["task_id", "video_id", "dataset", "category", "annotator_code", "annotator_name", "status", "updated_at"];
      const lines = [headers.map(safeCsvCell).join(",")];
      rows.forEach((row) => {
        lines.push([
          row.task_id,
          row.video.id || row.task.video_id,
          row.video.dataset,
          row.video.category,
          row.annotator.annotator_code,
          row.annotator.display_name,
          row.status,
          row.updated_at
        ].map(safeCsvCell).join(","));
      });
      downloadText("\uFEFF" + lines.join("\r\n"), "annotation_manifest.csv", "text/csv");
      return rows.length;
    }
  }

  namespace.AdminExportService = AdminExportService;
})(window.FitInteract = window.FitInteract || {});
