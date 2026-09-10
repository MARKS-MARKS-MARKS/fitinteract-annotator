(function (namespace) {
  "use strict";

  const DEFAULT_ACTIONS = Object.freeze([
    "[feedback]"
  ]);

  function normalizeAnnotationAction(value) {
    if (value === undefined || value === null) return DEFAULT_ACTIONS[0];
    return typeof value === "string" ? value.trim() : "";
  }

  function roundTime(value) {
    return Number(Number(value).toFixed(2));
  }

  function cloneAnnotations(items) {
    return items.map((item) => ({
      time_window_sec: {
        start: roundTime(item.time_window_sec.start),
        end: roundTime(item.time_window_sec.end)
      },
      action: normalizeAnnotationAction(item.action),
      text: item.text
    }));
  }

  class AnnotationManager {
    constructor(elements, callbacks) {
      this.elements = elements;
      this.callbacks = callbacks || {};
      this.annotations = [];
      this.editingIndex = null;
      this.selectedIndex = null;
      this.bindEvents();
      this.render();
    }

    bindEvents() {
      this.elements.list.addEventListener("click", (event) => {
        const item = event.target.closest(".annotation-item");
        if (!item) return;
        const index = Number(item.dataset.index);
        if (!Number.isInteger(index) || !this.annotations[index]) return;
        this.selectedIndex = index;
        this.render();

        const actionButton = event.target.closest("button[data-action]");
        if (!actionButton) return;
        const action = actionButton.dataset.action;
        if (action === "play") this.emit("onPlay", this.annotations[index]);
        if (action === "edit") this.beginEdit(index);
        if (action === "delete") this.requestDelete(index);
      });
    }

    emit(name, value) {
      if (typeof this.callbacks[name] === "function") this.callbacks[name](value);
    }

    validate(start, end, text, duration, action) {
      const errors = [];
      const startValue = Number(start);
      const endValue = Number(end);
      if (start === null || start === "" || !Number.isFinite(startValue)) errors.push("Start 不能为空。");
      if (end === null || end === "" || !Number.isFinite(endValue)) errors.push("End 不能为空。");
      if (Number.isFinite(startValue) && startValue < 0) errors.push("Start 不能小于 0。");
      if (Number.isFinite(endValue) && Number.isFinite(startValue) && endValue <= startValue) {
        errors.push("End 必须大于 Start。");
      }
      if (Number.isFinite(duration) && duration > 0 && Number.isFinite(endValue) && endValue > duration + 0.005) {
        errors.push("End 不能超过视频时长。");
      }
      if (typeof action !== "string" || !action.trim()) errors.push("Action 不能为空。");
      if (!String(text || "").trim()) errors.push("Response / Text 不能为空。");
      return errors;
    }

    save(start, end, text, duration, action) {
      const errors = this.validate(start, end, text, duration, action);
      if (errors.length) return { ok: false, errors: errors };

      const annotation = {
        time_window_sec: {
          start: roundTime(start),
          end: roundTime(end)
        },
        action: String(action).trim(),
        text: String(text).trim()
      };

      if (this.editingIndex === null) {
        this.annotations.push(annotation);
      } else {
        this.annotations[this.editingIndex] = annotation;
      }

      this.annotations.sort((a, b) => a.time_window_sec.start - b.time_window_sec.start);
      this.editingIndex = null;
      this.selectedIndex = this.annotations.indexOf(annotation);
      this.render();
      this.emit("onChange", this.getAll());
      this.emit("onEditState", null);
      return { ok: true, annotation: annotation };
    }

    beginEdit(index) {
      const annotation = this.annotations[index];
      if (!annotation) return;
      this.editingIndex = index;
      this.selectedIndex = index;
      this.render();
      this.emit("onEdit", cloneAnnotations([annotation])[0]);
      this.emit("onEditState", annotation);
    }

    cancelEdit() {
      this.editingIndex = null;
      this.emit("onEditState", null);
      this.render();
    }

    requestDelete(index) {
      const annotation = this.annotations[index];
      if (!annotation) return;
      const label = annotation.time_window_sec.start.toFixed(2) + " → " + annotation.time_window_sec.end.toFixed(2) + " s";
      if (!window.confirm("确定删除 annotation " + label + " 吗？")) return;
      this.annotations.splice(index, 1);
      if (this.editingIndex === index) {
        this.editingIndex = null;
        this.emit("onEditState", null);
      } else if (this.editingIndex !== null && this.editingIndex > index) {
        this.editingIndex -= 1;
      }
      this.selectedIndex = null;
      this.render();
      this.emit("onChange", this.getAll());
    }

    deleteSelected() {
      if (this.selectedIndex === null) return false;
      this.requestDelete(this.selectedIndex);
      return true;
    }

    replaceAll(items) {
      const safeItems = Array.isArray(items) ? items : [];
      this.annotations = safeItems
        .filter((item) => item && item.time_window_sec)
        .map((item) => ({
          time_window_sec: {
            start: roundTime(item.time_window_sec.start),
            end: roundTime(item.time_window_sec.end)
          },
          action: normalizeAnnotationAction(item.action),
          text: String(item.text || "")
        }))
        .filter((item) => Number.isFinite(item.time_window_sec.start) && Number.isFinite(item.time_window_sec.end))
        .sort((a, b) => a.time_window_sec.start - b.time_window_sec.start);
      this.editingIndex = null;
      this.selectedIndex = null;
      this.render();
      this.emit("onChange", this.getAll());
      this.emit("onEditState", null);
    }

    clear() {
      this.annotations = [];
      this.editingIndex = null;
      this.selectedIndex = null;
      this.render();
      this.emit("onChange", this.getAll());
      this.emit("onEditState", null);
    }

    getAll() {
      return cloneAnnotations(this.annotations);
    }

    isEditing() {
      return this.editingIndex !== null;
    }

    render() {
      this.elements.title.textContent = "Annotations (" + this.annotations.length + ")";
      this.elements.list.textContent = "";
      if (!this.annotations.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "尚未添加 annotation";
        this.elements.list.appendChild(empty);
        return;
      }

      this.annotations.forEach((annotation, index) => {
        const item = document.createElement("article");
        item.className = "annotation-item" + (index === this.selectedIndex ? " selected" : "");
        item.dataset.index = String(index);
        item.tabIndex = 0;
        item.setAttribute("aria-label", "Annotation " + (index + 1));

        const header = document.createElement("div");
        header.className = "annotation-item-header";
        const number = document.createElement("span");
        number.className = "annotation-index";
        number.textContent = "#" + (index + 1) + (index === this.editingIndex ? " · 编辑中" : "");
        const time = document.createElement("span");
        time.className = "annotation-time";
        time.textContent = annotation.time_window_sec.start.toFixed(2) + " → " + annotation.time_window_sec.end.toFixed(2) + " s";
        header.append(number, time);

        const text = document.createElement("p");
        text.className = "annotation-text";
        text.textContent = annotation.text;

        const action = document.createElement("span");
        action.className = "annotation-action-label";
        action.textContent = annotation.action;

        const actions = document.createElement("div");
        actions.className = "annotation-buttons";
        actions.append(
          this.createActionButton("播放", "play", "button small secondary"),
          this.createActionButton("编辑", "edit", "button small secondary"),
          this.createActionButton("删除", "delete", "button small danger-ghost")
        );
        item.append(header, action, text, actions);
        this.elements.list.appendChild(item);
      });
    }

    createActionButton(label, action, className) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.dataset.action = action;
      button.textContent = label;
      return button;
    }
  }

  namespace.roundTime = roundTime;
  namespace.ANNOTATION_ACTIONS = DEFAULT_ACTIONS;
  namespace.normalizeAnnotationAction = normalizeAnnotationAction;
  namespace.AnnotationManager = AnnotationManager;
})(window.FitInteract = window.FitInteract || {});
