(function (namespace) {
  "use strict";

  const PAGE_SIZE = 50;

  function one(value) {
    return Array.isArray(value) ? value[0] || null : value || null;
  }

  function formatDate(value) {
    if (!value) return "--";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    }).format(new Date(value));
  }

  class OnlineTaskController {
    constructor(app) {
      this.app = app;
      this.client = namespace.Cloud.getClient();
      this.annotations = new namespace.OnlineAnnotationService();
      this.templates = new namespace.OnlineTemplateService();
      this.profile = null;
      this.tasks = [];
      this.currentTask = null;
      this.page = 0;
      this.total = 0;
      this.statusFilter = "all";
      this.datasetFilter = "all";
      this.autosaveTimer = null;
      this.saving = false;
      this.pendingSave = false;
      this.opening = false;
      this.signedUrlTimer = null;
      this.elements = {
        panel: document.getElementById("online-task-panel"),
        list: document.getElementById("online-task-list"),
        status: document.getElementById("online-task-status-filter"),
        dataset: document.getElementById("online-dataset-filter"),
        pageLabel: document.getElementById("online-task-page"),
        pagePrevious: document.getElementById("online-page-previous"),
        pageNext: document.getElementById("online-page-next"),
        currentPosition: document.getElementById("online-current-position"),
        previousTask: document.getElementById("online-previous-task"),
        nextTask: document.getElementById("online-next-task"),
        nextIncomplete: document.getElementById("online-next-incomplete"),
        saveDraft: document.getElementById("online-save-draft"),
        submit: document.getElementById("online-submit"),
        saveState: document.getElementById("online-save-state"),
        completedWarning: document.getElementById("online-completed-warning"),
        summary: document.getElementById("online-task-summary"),
        datasetValue: document.getElementById("online-task-dataset"),
        categoryValue: document.getElementById("online-task-category"),
        filenameValue: document.getElementById("online-task-filename"),
        statusValue: document.getElementById("online-task-status"),
        idValue: document.getElementById("online-task-id"),
        progress: document.getElementById("online-progress"),
        profile: document.getElementById("online-profile"),
        privacy: document.querySelector(".privacy-notice")
      };
    }

    async initialize() {
      this.app.enterOnlineMode();
      this.setPanelMessage("正在验证登录状态…");
      const identity = await namespace.Auth.requireProfile(["annotator", "admin"]);
      if (!identity) {
        window.location.replace("./login.html?next=index.html%3Fmode%3Donline");
        return;
      }
      this.profile = identity.profile;
      this.app.setOnlineProfile(identity.profile);
      this.elements.profile.textContent = (identity.profile.annotator_code || "--") + " / " +
        (identity.profile.display_name || identity.user.email || "未命名用户");
      this.elements.privacy.textContent = "Online Collaborative Mode：任务视频从项目私有 Supabase Storage 加载，标注结果将保存到项目数据库；数据不会发送到其他第三方服务。";
      this.bindEvents();
      this.app.setOnlineDirtyHandler(() => this.scheduleAutosave());
      this.setPanelMessage("正在加载统一模板和任务…");
      await Promise.all([this.templates.load(), this.loadDatasetOptions(), this.refreshProgress()]);
      await this.loadTasks();
    }

    bindEvents() {
      this.elements.status.addEventListener("change", () => {
        this.statusFilter = this.elements.status.value;
        this.page = 0;
        this.loadTasks();
      });
      this.elements.dataset.addEventListener("change", () => {
        this.datasetFilter = this.elements.dataset.value;
        this.page = 0;
        this.loadTasks();
      });
      this.elements.pagePrevious.addEventListener("click", () => {
        if (this.page > 0) { this.page -= 1; this.loadTasks(); }
      });
      this.elements.pageNext.addEventListener("click", () => {
        if ((this.page + 1) * PAGE_SIZE < this.total) { this.page += 1; this.loadTasks(); }
      });
      this.elements.previousTask.addEventListener("click", () => this.openRelative(-1));
      this.elements.nextTask.addEventListener("click", () => this.openRelative(1));
      this.elements.nextIncomplete.addEventListener("click", () => this.openNextIncomplete());
      this.elements.saveDraft.addEventListener("click", () => this.save(false));
      this.elements.submit.addEventListener("click", () => this.save(true));
      this.elements.list.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-task-id]");
        if (button) this.openTask(button.dataset.taskId);
      });
    }

    async loadDatasetOptions() {
      const response = await this.client.from("videos").select("dataset").order("dataset").limit(1000);
      if (response.error) throw new Error("Dataset 列表加载失败：" + response.error.message);
      const datasets = Array.from(new Set((response.data || []).map((item) => item.dataset).filter(Boolean)));
      this.elements.dataset.innerHTML = '<option value="all">全部 Dataset</option>';
      datasets.forEach((dataset) => {
        const option = document.createElement("option");
        option.value = dataset;
        option.textContent = dataset;
        this.elements.dataset.appendChild(option);
      });
    }

    async refreshProgress() {
      const [all, completed] = await Promise.all([
        this.client.from("annotation_tasks").select("id", { count: "exact", head: true }).eq("annotator_id", this.profile.id),
        this.client.from("annotation_tasks").select("id", { count: "exact", head: true })
          .eq("annotator_id", this.profile.id).in("status", ["completed", "reviewed"])
      ]);
      if (all.error || completed.error) throw new Error("进度加载失败：" + ((all.error || completed.error).message));
      this.elements.progress.textContent = (completed.count || 0) + " / " + (all.count || 0) + " Completed";
    }

    async loadTasks(preferredTaskId) {
      this.setPanelMessage("Loading tasks…");
      let query = this.client.from("annotation_tasks").select(
        "id,video_id,annotator_id,status,assigned_at,started_at,completed_at,reviewed_at," +
        "video:videos!inner(id,dataset,category,original_filename,storage_path,duration_seconds,status)," +
        "annotation:annotations(id,payload,status,updated_at,submitted_at)",
        { count: "exact" }
      ).eq("annotator_id", this.profile.id)
        .order("assigned_at", { ascending: true })
        .range(this.page * PAGE_SIZE, this.page * PAGE_SIZE + PAGE_SIZE - 1);
      if (this.statusFilter !== "all") query = query.eq("status", this.statusFilter);
      if (this.datasetFilter !== "all") query = query.eq("video.dataset", this.datasetFilter);
      const response = await query;
      if (response.error) {
        this.setPanelMessage("Task fetch failed: " + response.error.message, true);
        return;
      }
      this.tasks = (response.data || []).map((task) => ({
        ...task,
        video: one(task.video),
        annotation: one(task.annotation)
      }));
      this.total = response.count || 0;
      this.renderTasks();
      const targetId = preferredTaskId || (this.currentTask && this.currentTask.id);
      if (targetId && this.tasks.some((task) => task.id === targetId)) {
        await this.openTask(targetId);
      } else if (this.tasks.length) {
        await this.openTask(this.tasks[0].id);
      }
    }

    renderTasks() {
      this.elements.list.textContent = "";
      if (!this.tasks.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "当前筛选条件下没有任务";
        this.elements.list.appendChild(empty);
      }
      this.tasks.forEach((task) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "online-task-item" + (this.currentTask && task.id === this.currentTask.id ? " active" : "");
        button.dataset.taskId = task.id;
        const title = document.createElement("strong");
        title.textContent = task.video ? task.video.original_filename : task.video_id;
        const meta = document.createElement("span");
        meta.textContent = (task.video ? task.video.dataset + " / " + (task.video.category || "未分类") : "视频不可见") +
          " · " + task.status + " · " + formatDate(task.completed_at || task.started_at || task.assigned_at);
        button.append(title, meta);
        this.elements.list.appendChild(button);
      });
      const first = this.total ? this.page * PAGE_SIZE + 1 : 0;
      const last = Math.min((this.page + 1) * PAGE_SIZE, this.total);
      this.elements.pageLabel.textContent = first + "–" + last + " / " + this.total;
      this.elements.pagePrevious.disabled = this.page === 0;
      this.elements.pageNext.disabled = (this.page + 1) * PAGE_SIZE >= this.total;
      this.setPanelMessage("");
    }

    async openTask(taskId) {
      if (this.opening) return;
      const task = this.tasks.find((item) => item.id === taskId);
      if (!task || !task.video) return;
      this.opening = true;
      window.clearTimeout(this.signedUrlTimer);
      this.setSaveState("Loading video…", "loading");
      this.disableActions(true);
      try {
        if (this.currentTask && this.currentTask.id !== task.id && this.app.isDirty()) {
          const saved = await this.save(false);
          if (!saved) throw new Error("当前任务草稿保存失败，已取消切换任务。");
        }
        window.clearTimeout(this.autosaveTimer);
        if (task.status === "assigned") {
          const started = await this.client.rpc("start_annotation_task", { p_task_id: task.id });
          if (started.error) throw new Error("任务启动失败：" + started.error.message);
          task.status = "in_progress";
          task.started_at = task.started_at || new Date().toISOString();
        }
        const signedUrl = await this.createSignedUrl(task);
        if (!task.annotation) task.annotation = await this.annotations.loadForTask(task.id);
        this.currentTask = task;
        this.app.loadOnlineTask(task, signedUrl, task.annotation ? task.annotation.payload : null);
        this.scheduleSignedUrlRefresh(task.id);
        this.renderCurrentTask();
        this.renderTasks();
        this.setSaveState(task.annotation ? "Loaded cloud " + task.annotation.status : "尚未保存云端草稿", "idle");
      } catch (error) {
        this.app.showMessage(error.message || "任务加载失败。", "error", true);
        this.setSaveState("加载失败", "error");
      } finally {
        this.opening = false;
        this.disableActions(false);
      }
    }

    async createSignedUrl(task) {
      const signed = await this.client.storage
        .from(namespace.Cloud.getVideoBucket())
        .createSignedUrl(task.video.storage_path, namespace.Cloud.getSignedUrlExpiresIn());
      if (signed.error || !signed.data || !signed.data.signedUrl) {
        throw new Error("Signed URL failed: " + (signed.error ? signed.error.message : "未返回地址"));
      }
      return signed.data.signedUrl;
    }

    scheduleSignedUrlRefresh(taskId) {
      window.clearTimeout(this.signedUrlTimer);
      const delaySeconds = Math.max(30, namespace.Cloud.getSignedUrlExpiresIn() - 60);
      this.signedUrlTimer = window.setTimeout(async () => {
        if (!this.currentTask || this.currentTask.id !== taskId) return;
        try {
          const signedUrl = await this.createSignedUrl(this.currentTask);
          this.app.refreshOnlineVideoUrl(signedUrl);
          this.scheduleSignedUrlRefresh(taskId);
        } catch (error) {
          this.app.showMessage("视频访问地址续签失败，请重新打开当前任务：" + error.message, "error", true);
        }
      }, delaySeconds * 1000);
    }

    renderCurrentTask() {
      const task = this.currentTask;
      const video = task.video;
      this.elements.summary.classList.remove("hidden");
      this.elements.datasetValue.textContent = video.dataset;
      this.elements.categoryValue.textContent = video.category || "--";
      this.elements.filenameValue.textContent = video.original_filename;
      this.elements.statusValue.textContent = task.status;
      this.elements.idValue.textContent = task.id;
      const index = this.tasks.findIndex((item) => item.id === task.id);
      this.elements.currentPosition.textContent = index >= 0
        ? "Current: " + (this.page * PAGE_SIZE + index + 1) + " / " + this.total
        : "Current task";
      const completed = task.status === "completed" || task.status === "reviewed";
      this.elements.completedWarning.classList.toggle("hidden", !completed);
      this.elements.submit.textContent = completed ? "重新提交更新" : "提交完成";
    }

    openRelative(offset) {
      if (!this.currentTask) return;
      const index = this.tasks.findIndex((task) => task.id === this.currentTask.id);
      const next = this.tasks[index + offset];
      if (next) this.openTask(next.id);
    }

    openNextIncomplete() {
      const start = this.currentTask ? this.tasks.findIndex((item) => item.id === this.currentTask.id) + 1 : 0;
      const ordered = this.tasks.slice(start).concat(this.tasks.slice(0, start));
      const next = ordered.find((task) => task.status === "assigned" || task.status === "in_progress");
      if (next) return this.openTask(next.id);
      this.app.showMessage("当前页没有其他未完成任务。", "info");
      return Promise.resolve(false);
    }

    scheduleAutosave() {
      if (!this.currentTask) return;
      if (this.saving) {
        this.pendingSave = true;
        this.setSaveState("Unsaved changes", "idle");
        return;
      }
      window.clearTimeout(this.autosaveTimer);
      this.setSaveState("Unsaved changes", "idle");
      this.autosaveTimer = window.setTimeout(() => this.save(false, true), 2200);
    }

    async save(submit, automatic) {
      if (!this.currentTask || this.saving) return false;
      window.clearTimeout(this.autosaveTimer);
      const payload = this.app.getCurrentData();
      if (submit) {
        const errors = namespace.validateAnnotationData(payload);
        if (errors.length) {
          this.app.showMessage("提交前校验未通过：\n" + errors.map((item) => "• " + item).join("\n"), "error", true);
          return false;
        }
      }
      this.saving = true;
      this.pendingSave = false;
      this.disableActions(true);
      this.setSaveState(submit ? "Submitting…" : "Saving…", "loading");
      try {
        const result = await this.annotations.save(this.currentTask.id, payload, submit);
        this.currentTask.annotation = result && result.annotation ? result.annotation : {
          payload: payload,
          status: submit || this.currentTask.status === "completed" ? "submitted" : "draft"
        };
        if (submit) {
          this.currentTask.status = "completed";
          this.currentTask.completed_at = new Date().toISOString();
          this.app.showMessage("✓ 标注已提交完成。", "success");
          this.setSaveState("Submitted", "success");
          await Promise.all([this.refreshProgress(), this.loadTasks(this.currentTask.id)]);
          window.setTimeout(() => this.openNextIncomplete(), 0);
        } else {
          this.setSaveState("Saved", "success");
          if (!automatic) this.app.showMessage("云端草稿已保存。", "success");
        }
        if (!this.pendingSave) this.app.markOnlineSaved();
        this.renderCurrentTask();
        return true;
      } catch (error) {
        this.setSaveState("Error", "error");
        this.app.showMessage(error.message || "云端保存失败。", "error", true);
        return false;
      } finally {
        this.saving = false;
        this.disableActions(false);
        if (this.pendingSave) {
          this.pendingSave = false;
          this.scheduleAutosave();
        }
      }
    }

    setPanelMessage(message, isError) {
      const status = document.getElementById("online-task-loading");
      status.textContent = message;
      status.classList.toggle("error-text", Boolean(isError));
      status.classList.toggle("hidden", !message);
    }

    setSaveState(message, state) {
      this.elements.saveState.textContent = message;
      this.elements.saveState.dataset.state = state || "idle";
    }

    disableActions(disabled) {
      this.elements.saveDraft.disabled = disabled;
      this.elements.submit.disabled = disabled;
      this.elements.nextIncomplete.disabled = disabled;
    }
  }

  namespace.OnlineTaskController = OnlineTaskController;
})(window.FitInteract = window.FitInteract || {});
