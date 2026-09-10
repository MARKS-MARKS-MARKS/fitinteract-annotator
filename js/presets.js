(function (namespace) {
  "use strict";

  const STORAGE_KEYS = Object.freeze({
    settings: "fitinteract_settings_v1",
    queryPresets: "fitinteract_query_presets_v1",
    textPresets: "fitinteract_text_presets_v1",
    videoRoots: "fitinteract_video_roots_v1",
    videoPathHistory: "fitinteract_video_path_history_v1",
    draft: "fitinteract_draft_v1",
    presetSchemaVersion: "fitinteract_presets_schema_version",
    presetMigrationBackup: "fitinteract_presets_migration_backup_v1",
    draftMigrationBackup: "fitinteract_draft_query_migration_backup_v1"
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

    readRaw(key) {
      try {
        return localStorage.getItem(key);
      } catch (error) {
        this.onError("无法读取浏览器本地原始数据。", error);
        return null;
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
      const storedItems = storage.read(storageKey, null);
      this.items = this.mergeItems(Array.isArray(storedItems) ? storedItems : [], defaults);
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

    mergeItems(currentItems, incomingItems) {
      const current = this.normalize(currentItems);
      const incoming = this.normalize(incomingItems);
      const merged = current.slice();
      incoming.forEach((candidate) => {
        const normalizedName = candidate.name.trim().toLocaleLowerCase();
        const normalizedValue = candidate.value.trim();
        const duplicate = merged.some((item) =>
          item.id === candidate.id ||
          (item.name.trim().toLocaleLowerCase() === normalizedName && item.value.trim() === normalizedValue)
        );
        if (!duplicate) merged.push(candidate);
      });
      return merged;
    }

    merge(items) {
      const before = this.items.length;
      const incomingCount = Array.isArray(items) ? items.length : 0;
      this.items = this.mergeItems(this.items, items);
      this.persist();
      return { added: this.items.length - before, skipped: Math.max(0, incomingCount - (this.items.length - before)) };
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

  function protectPresetStorage(storage) {
    const version = Number(storage.read(STORAGE_KEYS.presetSchemaVersion, 0)) || 0;
    if (version >= 2) return { backupCreated: false, version: version };

    let backupCreated = false;
    let backupReady = Boolean(storage.readRaw(STORAGE_KEYS.presetMigrationBackup));
    if (!backupReady) {
      const trackedKeys = [
        STORAGE_KEYS.queryPresets,
        STORAGE_KEYS.textPresets,
        STORAGE_KEYS.videoRoots,
        STORAGE_KEYS.settings,
        STORAGE_KEYS.videoPathHistory,
        STORAGE_KEYS.draft
      ];
      const rawStorage = {};
      trackedKeys.forEach((key) => { rawStorage[key] = storage.readRaw(key); });
      backupCreated = storage.write(STORAGE_KEYS.presetMigrationBackup, {
        format: "FitInteractPresetMigrationBackup",
        version: 1,
        created_at: new Date().toISOString(),
        source_schema_version: version,
        query_presets: storage.read(STORAGE_KEYS.queryPresets, []),
        text_presets: storage.read(STORAGE_KEYS.textPresets, []),
        video_roots: storage.read(STORAGE_KEYS.videoRoots, []),
        settings: storage.read(STORAGE_KEYS.settings, {}),
        raw_storage: rawStorage
      });
      backupReady = Boolean(storage.readRaw(STORAGE_KEYS.presetMigrationBackup));
    }

    if (!backupReady) return { backupCreated: false, version: version, safe: false };

    const draft = storage.read(STORAGE_KEYS.draft, null);
    if (draft && draft.data && typeof draft.data.query === "string" && !storage.readRaw(STORAGE_KEYS.draftMigrationBackup)) {
      storage.write(STORAGE_KEYS.draftMigrationBackup, {
        format: "FitInteractLegacyDraftBackup",
        version: 1,
        created_at: new Date().toISOString(),
        draft: draft,
        raw: storage.readRaw(STORAGE_KEYS.draft)
      });
    }
    storage.write(STORAGE_KEYS.presetSchemaVersion, 2);
    return { backupCreated: backupCreated, version: 2, safe: true };
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
  namespace.protectPresetStorage = protectPresetStorage;
  namespace.populatePresetSelect = populatePresetSelect;
})(window.FitInteract = window.FitInteract || {});
