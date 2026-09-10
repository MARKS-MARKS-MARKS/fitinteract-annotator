(function (namespace) {
  "use strict";

  function roundTime(value) {
    return namespace.roundTime ? namespace.roundTime(value) : Number(Number(value).toFixed(2));
  }

  function cloneQueries(items) {
    return items.map((item) => ({
      start_time_sec: roundTime(item.start_time_sec),
      text: String(item.text || "")
    }));
  }

  function normalizeQueries(value) {
    const legacy = typeof value === "string";
    const source = legacy
      ? (value.trim() ? [{ start_time_sec: 0, text: value }] : [])
      : (Array.isArray(value) ? value : []);
    const queries = source
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        start_time_sec: roundTime(item.start_time_sec),
        text: String(item.text || "").trim()
      }))
      .filter((item) => Number.isFinite(item.start_time_sec) && item.start_time_sec >= 0 && item.text)
      .sort((left, right) => left.start_time_sec - right.start_time_sec);
    return { queries: queries, legacy: legacy };
  }

  class QueryManager {
    constructor(elements, callbacks) {
      this.elements = elements;
      this.callbacks = callbacks || {};
      this.queries = [];
      this.editingIndex = null;
      this.selectedIndex = null;
      this.bindEvents();
      this.render();
    }

    bindEvents() {
      this.elements.list.addEventListener("click", (event) => {
        const item = event.target.closest(".query-item");
        if (!item) return;
        const index = Number(item.dataset.index);
        if (!Number.isInteger(index) || !this.queries[index]) return;
        this.selectedIndex = index;
        this.render();
        const actionButton = event.target.closest("button[data-action]");
        if (!actionButton) return;
        if (actionButton.dataset.action === "locate") this.emit("onLocate", this.queries[index]);
        if (actionButton.dataset.action === "edit") this.beginEdit(index);
        if (actionButton.dataset.action === "delete") this.requestDelete(index);
      });
    }

    emit(name, value) {
      if (typeof this.callbacks[name] === "function") this.callbacks[name](value);
    }

    validate(start, text, duration) {
      const errors = [];
      const startValue = Number(start);
      if (start === null || start === "" || !Number.isFinite(startValue)) errors.push("Query Start 不能为空。");
      if (Number.isFinite(startValue) && startValue < 0) errors.push("Query Start 不能小于 0。");
      if (Number.isFinite(duration) && duration > 0 && Number.isFinite(startValue) && startValue > duration + 0.005) {
        errors.push("Query Start 不能超过视频时长。");
      }
      if (!String(text || "").trim()) errors.push("Query Text 不能为空。");
      return errors;
    }

    save(start, text, duration) {
      const errors = this.validate(start, text, duration);
      if (errors.length) return { ok: false, errors: errors };
      const query = { start_time_sec: roundTime(start), text: String(text).trim() };
      const wasEditing = this.editingIndex !== null;
      if (wasEditing) this.queries[this.editingIndex] = query;
      else this.queries.push(query);
      this.queries.sort((left, right) => left.start_time_sec - right.start_time_sec);
      this.editingIndex = null;
      this.selectedIndex = this.queries.indexOf(query);
      this.render();
      this.emit("onChange", this.getAll());
      this.emit("onEditState", null);
      return { ok: true, query: query, updated: wasEditing };
    }

    beginEdit(index) {
      const query = this.queries[index];
      if (!query) return;
      this.editingIndex = index;
      this.selectedIndex = index;
      this.render();
      this.emit("onEdit", cloneQueries([query])[0]);
      this.emit("onEditState", query);
    }

    cancelEdit() {
      this.editingIndex = null;
      this.emit("onEditState", null);
      this.render();
    }

    requestDelete(index) {
      const query = this.queries[index];
      if (!query) return;
      if (!window.confirm("确定删除 Query #" + (index + 1) + "（" + query.start_time_sec.toFixed(2) + " s）吗？")) return;
      this.queries.splice(index, 1);
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

    replaceAll(value) {
      const normalized = normalizeQueries(value);
      this.queries = normalized.queries;
      this.editingIndex = null;
      this.selectedIndex = null;
      this.render();
      this.emit("onChange", this.getAll());
      this.emit("onEditState", null);
      return normalized;
    }

    clear() {
      this.queries = [];
      this.editingIndex = null;
      this.selectedIndex = null;
      this.render();
      this.emit("onChange", this.getAll());
      this.emit("onEditState", null);
    }

    getAll() {
      return cloneQueries(this.queries);
    }

    isEditing() {
      return this.editingIndex !== null;
    }

    render() {
      this.elements.title.textContent = "Queries (" + this.queries.length + ")";
      this.elements.list.textContent = "";
      if (!this.queries.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state compact-empty-state";
        empty.textContent = "尚未添加 Query instance";
        this.elements.list.appendChild(empty);
        return;
      }
      this.queries.forEach((query, index) => {
        const item = document.createElement("article");
        item.className = "query-item" + (index === this.selectedIndex ? " selected" : "");
        item.dataset.index = String(index);
        const header = document.createElement("div");
        header.className = "query-item-header";
        const number = document.createElement("span");
        number.className = "query-index";
        number.textContent = "#" + (index + 1) + (index === this.editingIndex ? " · 编辑中" : "");
        const time = document.createElement("span");
        time.className = "query-time";
        time.textContent = query.start_time_sec.toFixed(2) + " s";
        header.append(number, time);
        const text = document.createElement("p");
        text.className = "query-instance-text";
        text.textContent = query.text;
        const actions = document.createElement("div");
        actions.className = "query-buttons";
        actions.append(
          this.createButton("定位", "locate", "button small secondary"),
          this.createButton("编辑", "edit", "button small secondary"),
          this.createButton("删除", "delete", "button small danger-ghost")
        );
        item.append(header, text, actions);
        this.elements.list.appendChild(item);
      });
    }

    createButton(label, action, className) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.dataset.action = action;
      button.textContent = label;
      return button;
    }
  }

  namespace.normalizeQueries = normalizeQueries;
  namespace.QueryManager = QueryManager;
})(window.FitInteract = window.FitInteract || {});
