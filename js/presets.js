(function (namespace) {
  "use strict";

  const STORAGE_KEYS = Object.freeze({
    settings: "fitinteract_settings_v1",
    queryPresets: "fitinteract_query_presets_v1",
    textPresets: "fitinteract_text_presets_v1",
    videoRoots: "fitinteract_video_roots_v1",
    videoPathHistory: "fitinteract_video_path_history_v1",
    draft: "fitinteract_draft_v1"
  });

  const DEFAULTS = Object.freeze({
    queryPresets: [
      {
        id: "query-squat-coach",
        name: "深蹲动作指导",
        value: "我要做一组深蹲，帮我看看动作，哪里不对就及时提醒我。"
      }
    ],
    textPresets: [
      {
        id: "text-knee-alignment",
        name: "膝盖内扣提醒",
        value: "注意膝盖有些内扣，让膝盖朝脚尖方向移动。"
      }
    ],
    videoRoots: [
      {
        id: "root-sprint",
        name: "SPRINT",
        value: "dataset/SPRINT/long_context_clips/"
      },
      {
        id: "root-qevd",
        name: "QEVD",
        value: "dataset/QEVD-FIT-COACH/videos/"
      }
    ]
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  class StorageService {
    constructor(onError) {
      this.onError = typeof onError === "function" ? onError : function () {};
    }

    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? clone(fallback) : JSON.parse(raw);
      } catch (error) {
        this.onError("无法读取浏览器本地数据，已使用默认值。", error);
        return clone(fallback);
      }
    }

    write(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        this.onError("无法保存到浏览器 LocalStorage。", error);
        return false;
      }
    }

    remove(key) {
      try {
        localStorage.removeItem(key);
        return true;
      } catch (error) {
        this.onError("无法清除浏览器本地数据。", error);
        return false;
      }
    }
  }

  class PresetCollection {
    constructor(storage, storageKey, defaults, prefix) {
      this.storage = storage;
      this.storageKey = storageKey;
      this.prefix = prefix;
      this.items = this.normalize(storage.read(storageKey, defaults));
      this.persist();
    }

    normalize(items) {
      if (!Array.isArray(items)) return [];
      return items
        .filter((item) => item && typeof item.name === "string" && typeof item.value === "string")
        .map((item) => ({
          id: typeof item.id === "string" && item.id ? item.id : createId(this.prefix),
          name: item.name.trim(),
          value: item.value
        }))
        .filter((item) => item.name && item.value.trim());
    }

    all() {
      return clone(this.items);
    }

    find(id) {
      return this.items.find((item) => item.id === id) || null;
    }

    add(name, value) {
      const cleanName = String(name || "").trim();
      const cleanValue = String(value || "").trim();
      if (!cleanName || !cleanValue) throw new Error("模板名称和内容都不能为空。");
      if (this.items.some((item) => item.name.toLowerCase() === cleanName.toLowerCase())) {
        throw new Error("已存在同名模板，请改用“更新模板”。");
      }
      const item = { id: createId(this.prefix), name: cleanName, value: cleanValue };
      this.items.push(item);
      this.persist();
      return clone(item);
    }

    update(id, name, value) {
      const item = this.find(id);
      if (!item) throw new Error("请先选择要更新的模板。");
      const cleanName = String(name || "").trim();
      const cleanValue = String(value || "").trim();
      if (!cleanName || !cleanValue) throw new Error("模板名称和内容都不能为空。");
      if (this.items.some((candidate) => candidate.id !== id && candidate.name.toLowerCase() === cleanName.toLowerCase())) {
        throw new Error("已存在同名模板。");
      }
      item.name = cleanName;
      item.value = cleanValue;
      this.persist();
      return clone(item);
    }

    delete(id) {
      const index = this.items.findIndex((item) => item.id === id);
      if (index === -1) throw new Error("请先选择要删除的模板。");
      const removed = this.items.splice(index, 1)[0];
      this.persist();
      return clone(removed);
    }

    persist() {
      this.storage.write(this.storageKey, this.items);
    }
  }

  function populatePresetSelect(select, items, placeholder) {
    const previous = select.value;
    select.textContent = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = placeholder;
    select.appendChild(emptyOption);
    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    });
    if (items.some((item) => item.id === previous)) select.value = previous;
  }

  namespace.STORAGE_KEYS = STORAGE_KEYS;
  namespace.PRESET_DEFAULTS = DEFAULTS;
  namespace.StorageService = StorageService;
  namespace.PresetCollection = PresetCollection;
  namespace.populatePresetSelect = populatePresetSelect;
})(window.FitInteract = window.FitInteract || {});
