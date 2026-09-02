(function (namespace) {
  "use strict";

  class OnlineAnnotationService {
    constructor() {
      this.client = namespace.Cloud.getClient();
    }

    async loadForTask(taskId) {
      const response = await this.client
        .from("annotations")
        .select("id,task_id,payload,status,created_at,updated_at,submitted_at")
        .eq("task_id", taskId)
        .maybeSingle();
      if (response.error) throw new Error("云端标注加载失败：" + response.error.message);
      return response.data;
    }

    async save(taskId, payload, submit) {
      const response = await this.client.rpc("save_annotation_payload", {
        p_task_id: taskId,
        p_payload: payload,
        p_submit: Boolean(submit)
      });
      if (response.error) {
        throw new Error((submit ? "提交失败：" : "草稿保存失败：") + response.error.message);
      }
      return response.data;
    }
  }

  namespace.OnlineAnnotationService = OnlineAnnotationService;
})(window.FitInteract = window.FitInteract || {});
